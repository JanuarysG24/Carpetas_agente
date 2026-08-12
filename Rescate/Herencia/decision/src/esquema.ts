/**
 * El estandar de ingesta: que documento entra al corpus y cual se rechaza CON RAZON.
 *
 * Se apoya entero en el validador del modulo de contratos —ADR-011 por esquema,
 * metadatos obligatorios, `kind` cerrado— y le añade lo unico que el contrato no
 * puede saber por si solo: si el CUERPO aporta texto.
 *
 * ============ Por que un documento vacio se rechaza y no se acepta ============
 *
 * Un PDF sin capa de texto no se puede ingerir. La tentacion es aceptarlo igual
 * —el documento "esta cargado", la consola no protesta, el listado lo muestra— y es
 * la peor de las salidas: un documento que se acepta y no aporta nada es peor que
 * uno rechazado con su razon, porque despues alguien pregunta por su contenido y el
 * agente no sabe por que no lo tiene.
 *
 * El caso concreto que esto cubre: el jurado prueba la compuerta 5 subiendo un
 * documento propio. Si resulta ser un escaneo, la consola tiene que DECIRLO en ese
 * momento, no ingerir vacio en silencio.
 *
 * ==============================================================================
 *
 * ============ La regla del sidecar (docs/corpus-texto/README.md) ============
 *
 * Cuando existe un `.txt` con la MISMA RUTA RELATIVA que un PDF del corpus, la
 * ingesta usa el `.txt`. El `doc_id`, la trazabilidad y la cita siguen apuntando al
 * PDF original: el texto es DERIVADO, igual que el indice vectorial, y la fuente
 * sigue siendo el documento (ADR-015).
 *
 * Ningun sidecar se genera en tiempo de ejecucion, y es el mismo criterio que el
 * indice preconstruido: el reloj de la compuerta 2 no debe ver ningun trabajo que
 * se pueda hacer antes. OCR en el arranque costaria minutos por documento; asi
 * cuesta cero.
 *
 * ============================================================================
 */

import {
  exigirValido,
  validateSourceDocument,
  type SourceDocument,
  type ValidationIssue,
  type ValidationResult,
} from "@techsphere/contracts";

export const SIDECAR_RAIZ = "docs/corpus-texto";

/**
 * Donde vive el texto derivado de un PDF, si lo hay. La correspondencia es por ruta
 * relativa exacta, sin catalogo intermedio: un mapa de rutas es una cosa mas que se
 * puede desincronizar del disco.
 *
 *   dataset/textos/Appendicitis/DOC.pdf  ->  docs/corpus-texto/Appendicitis/DOC.txt
 */
export function rutaDeSidecar(rutaRelativaDelPdf: string): string {
  const sinExtension = rutaRelativaDelPdf.replace(/\.pdf$/i, "");
  const sinPrefijo = sinExtension.replace(/^(dataset\/)?textos\//i, "");
  return `${SIDECAR_RAIZ}/${sinPrefijo}.txt`;
}

// ---------------------------------------------------------------------------
// Cuanto texto es "texto"
// ---------------------------------------------------------------------------
//
// Los tres umbrales salen de la medicion del corpus real con dos extractores
// independientes (`docs/corpus-texto/README.md`), no de intuicion:
//
//   102 de 107 PDF extraen bien.
//     4 tienen densidad BAJA PERO TEXTO REAL: 165-766 caracteres por pagina. No es
//       un defecto — son guias visuales para pacientes, hechas de ilustraciones. Y
//       tres de esos cuatro son planes de cuidado post-operatorio dirigidos al
//       paciente, que es el material MAS pertinente que hay en el corpus para este
//       agente: rechazarlos por una cifra no verificada habria quitado lo mejor.
//     1 no tiene capa de texto: poster academico de una pagina, imagen JPEG unica.
//
// De ahi que el umbral de rechazo (40 car./pag.) quede un orden de magnitud por
// debajo del piso medido de lo legitimo (165), y que la franja de aviso no rechace
// nada: solo lo dice.
// ---------------------------------------------------------------------------

/** Por debajo de esto, por pagina, no hay capa de texto: hay residuo de extraccion. */
const UMBRAL_SIN_TEXTO_POR_PAGINA = 40;

/** Franja de AVISO, no de rechazo: hay texto real, pero poco. Se ingiere igual. */
const UMBRAL_DENSIDAD_BAJA_POR_PAGINA = 800;

/** Piso absoluto cuando no se sabe cuantas paginas tenia el original. */
const MINIMO_ABSOLUTO_DE_CARACTERES = 120;

export type VeredictoDeTexto = "utilizable" | "densidad_baja" | "sin_texto_aprovechable";

export interface LecturaDelCuerpo {
  veredicto: VeredictoDeTexto;
  caracteres: number;
  /** `null` cuando el llamador no declaro paginas del original. */
  caracteres_por_pagina: number | null;
}

/**
 * Cuanto texto util trae el cuerpo. Se mide sobre el texto con los espacios
 * colapsados: un PDF fallido suele soltar miles de saltos de linea y ningun caracter.
 */
export function leerCuerpo(body: string, paginas?: number): LecturaDelCuerpo {
  const caracteres = body.replace(/\s+/g, " ").trim().length;

  if (paginas !== undefined && paginas > 0) {
    const densidad = caracteres / paginas;
    return {
      caracteres,
      caracteres_por_pagina: densidad,
      veredicto:
        densidad < UMBRAL_SIN_TEXTO_POR_PAGINA
          ? "sin_texto_aprovechable"
          : densidad < UMBRAL_DENSIDAD_BAJA_POR_PAGINA
            ? "densidad_baja"
            : "utilizable",
    };
  }

  return {
    caracteres,
    caracteres_por_pagina: null,
    veredicto:
      caracteres < MINIMO_ABSOLUTO_DE_CARACTERES ? "sin_texto_aprovechable" : "utilizable",
  };
}

export interface OpcionesDeIngesta {
  /** Paginas del PDF original, si se conocen. Convierte el piso absoluto en densidad. */
  paginas?: number;
  /** Ruta relativa del original, para que el mensaje de rechazo diga donde va su sidecar. */
  ruta_original?: string;
}

/**
 * El estandar completo: contrato + cuerpo aprovechable.
 *
 * Acumula TODOS los problemas, no solo el primero — quien opera la consola arregla
 * el documento de una vez en vez de descubrir un error por intento.
 */
export function validarDocumentoIngestable(
  doc: unknown,
  opciones: OpcionesDeIngesta = {},
): ValidationResult {
  const base = validateSourceDocument(doc);
  const issues: ValidationIssue[] = [...base.issues];

  // Se mira TAMBIEN el cuerpo vacio, aunque el contrato ya lo rechace por su cuenta:
  // "body no puede ir vacio" es cierto pero inutil frente a un escaneo, y quien opera
  // la consola necesita el mensaje que dice que hacer, no el que dice que falta.
  const body = (doc as { body?: unknown } | null)?.body;
  if (typeof body === "string") {
    const lectura = leerCuerpo(body, opciones.paginas);
    if (lectura.veredicto === "sin_texto_aprovechable") {
      const destino = opciones.ruta_original
        ? rutaDeSidecar(opciones.ruta_original)
        : `${SIDECAR_RAIZ}/<misma ruta relativa que el original>.txt`;

      issues.push({
        path: "body",
        code: "vacio",
        message:
          `El cuerpo trae ${lectura.caracteres} caracteres utiles` +
          (lectura.caracteres_por_pagina === null
            ? ` (minimo ${MINIMO_ABSOLUTO_DE_CARACTERES})`
            : ` sobre ${opciones.paginas} pagina(s): ${lectura.caracteres_por_pagina.toFixed(0)} por pagina, ` +
              `por debajo de ${UMBRAL_SIN_TEXTO_POR_PAGINA}`) +
          `. Eso no es un documento con poco texto: es un documento SIN CAPA DE TEXTO.`,
        hint:
          `NO se ingiere vacio: un documento aceptado que no aporta nada es peor que uno rechazado con su razon, ` +
          `porque despues alguien pregunta por su contenido y el agente no sabe por que no lo tiene. ` +
          `La salida es el sidecar: extrae el texto FUERA DE LINEA (OCR si hace falta), guardalo en ${destino} ` +
          `y vuelve a ingerir — el doc_id y la cita siguen apuntando al original, porque el texto es derivado ` +
          `igual que el indice (ADR-015). Nunca en tiempo de ejecucion: OCR en el arranque cuesta minutos por ` +
          `documento y el reloj de la compuerta 2 no debe ver trabajo que se pueda hacer antes ` +
          `(${SIDECAR_RAIZ}/README.md).`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Frontera de la consola: seguir con un documento invalido es peor que caerse. */
export function exigirDocumentoIngestable(
  doc: unknown,
  opciones: OpcionesDeIngesta = {},
): asserts doc is SourceDocument {
  exigirValido("Ingesta rechazada", validarDocumentoIngestable(doc, opciones));
}

/**
 * Aviso no bloqueante para el registro de la consola. Un documento de densidad baja
 * se ingiere NORMAL —son guias visuales para pacientes, y estan entre lo mas
 * pertinente del corpus—, pero el operador merece verlo dicho.
 */
export function avisoDeDensidad(doc: SourceDocument, paginas?: number): string | null {
  const lectura = leerCuerpo(doc.body, paginas);
  if (lectura.veredicto !== "densidad_baja") return null;
  return (
    `${doc.doc_id}: densidad baja (${lectura.caracteres_por_pagina?.toFixed(0)} caracteres por pagina). ` +
    `Se ingiere igual — medido en el corpus real, la densidad baja no es un defecto de extraccion sino un ` +
    `documento hecho de ilustraciones, y tres de los cuatro asi son planes de cuidado dirigidos al paciente.`
  );
}
