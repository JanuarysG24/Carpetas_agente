/**
 * Validacion del corpus. El nucleo es ADR-011: el RAG no contiene pacientes.
 *
 * La comprobacion tiene que RECHAZAR POR ESQUEMA, no por convencion. Un documento
 * con `paciente_id` no es un documento con un campo de mas: es la separacion
 * conocimiento/estado rota, y si pasa la frontera termina en un indice vectorial
 * donde cada operacion de consola pasa a ser una operacion sobre datos personales.
 */

import {
  CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011,
  DOCUMENT_KINDS,
  KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011,
} from "../knowledge.ts";
import { agregar, resultado, type IssueSink, type ValidationResult } from "./issues.ts";
import {
  exigirCadena,
  exigirEnum,
  exigirNumero,
  exigirObjeto,
  rechazarClavesDesconocidas,
  rechazarClavesProhibidas,
} from "./primitives.ts";

const CLAVES_SOURCE_DOCUMENT = [
  "doc_id",
  "title",
  "kind",
  "lang",
  "origin",
  "effective_date",
  "body",
  "chunking",
] as const;

const REF = "docs/Especificacion-Capa-Decision.md §8.2 + ADR-011";

/**
 * La prohibicion de ADR-011, en profundidad. Se exporta porque la prueba negativa
 * la ejerce directamente y porque la consola la necesita antes de indexar.
 */
export function rechazarIdentidadDePacienteADR011(
  sink: IssueSink,
  path: string,
  valor: unknown,
): void {
  rechazarClavesProhibidas(
    sink,
    path,
    valor,
    CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011,
    (clave, ruta) => ({
      message: `El campo ${JSON.stringify(clave)} es identidad o estado de paciente y no puede entrar al corpus (aparece en ${ruta}).`,
      hint: `El RAG contiene CONOCIMIENTO clinico; el paciente vive en PatientStorePort y entra a la decision como marco generado por sesion, nunca como documento recuperable. La recuperacion por similitud es ademas el mecanismo equivocado para datos de paciente: un caso "parecido" no es el caso del paciente al telefono, y mezclarlos habilita exactamente ese error. Quita el campo y, si el dato es del caso, pasalo por PatientStorePort.getCase (${REF}).`,
    }),
  );
}

export function validateSourceDocument(valor: unknown): ValidationResult {
  const sink: IssueSink = [];

  // Primero la prohibicion: importa mas que cualquier otro problema del documento.
  rechazarIdentidadDePacienteADR011(sink, "", valor);

  const doc = exigirObjeto(sink, "", valor, "un SourceDocument");
  if (!doc) return resultado(sink);

  rechazarClavesDesconocidas(
    sink,
    "",
    doc,
    CLAVES_SOURCE_DOCUMENT,
    `El esquema de metadatos NO tiene campo de identidad, y esa ausencia es la que sostiene ADR-011 por construccion. Si necesitas un metadato nuevo, agregalo a la spec §8.2 antes que al objeto (${REF}).`,
  );

  exigirCadena(sink, "doc_id", doc["doc_id"], {
    noVacia: true,
    hint: `Estable: es el que viaja en Decision.traces.doc_ids. El doc_ids de una decision de hace un mes debe resolver al documento que la sustento, aunque haya sido retirado despues (ADR-015).`,
  });

  exigirCadena(sink, "title", doc["title"], { noVacia: true, hint: `Titulo legible para la consola y el listado (${REF}).` });

  // `kind` fuera del enumerado ya se rechaza; este bloque existe para que el
  // mensaje diga POR QUE cuando el valor es un tipo de paciente, en vez de
  // limitarse a "valor invalido".
  const kind = doc["kind"];
  if (typeof kind === "string" && (KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011 as readonly string[]).includes(kind)) {
    agregar(
      sink,
      "kind",
      "campo_prohibido",
      `kind ${JSON.stringify(kind)} es un tipo de paciente, y el corpus no admite tipos de paciente.`,
      `Los cinco kind del corpus son [${DOCUMENT_KINDS.join(" | ")}] y ninguno es de paciente, por esquema (ADR-011). Si lo que quieres cargar es informacion de un paciente concreto, no va al RAG: va a la base de pacientes, cuya unica via de entrada a la decision es PatientStorePort.getCase (${REF}).`,
    );
  } else {
    exigirEnum(
      sink,
      "kind",
      kind,
      DOCUMENT_KINDS,
      `Los cinco tipos del corpus. Ninguno es de paciente, y eso es normativo: agregarlo exige un ADR que revierta ADR-011 explicitamente (${REF}).`,
    );
  }

  exigirCadena(sink, "lang", doc["lang"], {
    noVacia: true,
    hint: `El corpus del reto es español e ingles; declara el idioma real del cuerpo, no el de la interfaz (${REF}).`,
  });

  exigirCadena(sink, "origin", doc["origin"], {
    noVacia: true,
    hint: `Fuente bibliografica o institucional. Es lo que hace que una referencia resista una verificacion contra la fuente real, que es como se evalua el criterio de RAG (${REF}).`,
  });

  exigirCadena(sink, "effective_date", doc["effective_date"], {
    noVacia: true,
    hint: `Vigencia del CONOCIMIENTO, no fecha de carga: un protocolo de 2019 cargado hoy sigue siendo de 2019 (${REF}).`,
  });

  exigirCadena(sink, "body", doc["body"], {
    noVacia: true,
    hint: `Texto plano. La conversion desde PDF u otros formatos es previa a la consola: la consola administra documentos fuente, no archivos (ADR-015).`,
  });

  if (doc["chunking"] !== undefined) {
    const chunking = exigirObjeto(sink, "chunking", doc["chunking"], "el objeto chunking");
    if (chunking) {
      rechazarClavesDesconocidas(sink, "chunking", chunking, ["strategy", "max_tokens"], `${REF}`);
      exigirEnum(
        sink,
        "chunking.strategy",
        chunking["strategy"],
        ["seccion", "parrafo", "fijo"] as const,
        `Si omites chunking entero, se aplica el default por kind (${REF}).`,
      );
      if (chunking["max_tokens"] !== undefined) {
        exigirNumero(sink, "chunking.max_tokens", chunking["max_tokens"], {
          min: 1,
          entero: true,
          hint: `Tamaño maximo del fragmento, en tokens (${REF}).`,
        });
      }
    }
  }

  return resultado(sink);
}
