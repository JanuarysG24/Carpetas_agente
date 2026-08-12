/**
 * Validacion de la costura decision <-> determinista.
 *
 * El nucleo de este archivo es la prohibicion de ADR-007. `DeterministicReport`
 * no admite `alert`, `score`, `risk`, `severity`, `recommendation` ni `diagnosis`,
 * y la comprobacion es RECURSIVA: la invariante 2 de la spec §6.4 extiende la
 * prohibicion a los tipos de hallazgo, asi que un `severity` dentro de un
 * `ClassHit` reintroduciria por la puerta de atras justo lo que el ADR cierra.
 */

import { CAMPOS_PROHIBIDOS_ADR_007 } from "../deterministic.ts";
import { agregar, resultado, type IssueSink, type ValidationResult } from "./issues.ts";
import {
  exigirArreglo,
  exigirArregloDeCadenas,
  exigirBooleano,
  exigirCadena,
  exigirEnum,
  exigirNumero,
  exigirObjeto,
  rechazarClavesDesconocidas,
  rechazarClavesProhibidas,
} from "./primitives.ts";
import { validateUnitResults } from "./conversational.ts";

export const LECTURAS_FUNCIONALIDAD = ["patron_unico", "coexistencia", "sin_hallazgo"] as const;
export const LECTURAS_INTERACCION = [
  "patron_compartido",
  "hallazgos_independientes",
  "sin_hallazgo",
] as const;
export const LECTURAS_INTEGRIDAD = ["integra", "comprometida", "no_determinable"] as const;
export const EJES = ["funcionalidad", "interaccion", "integridad"] as const;
export const VALIDEZ_CLINICA = [
  "sin_validez_clinica_dominio_sintetico",
  "validado_por_experto",
] as const;

const CLAVES_REPORTE = [
  "domain_version",
  "frame_id",
  "funcionalidad",
  "interaccion",
  "integridad",
  "coverage",
  "trace",
  "quality",
] as const;

const CLAVES_REQUEST = ["session_id", "frame_id", "units", "modifiers", "domain_version"] as const;

const REF = "docs/Especificacion-Capa-Determinista.md §6";

/**
 * La prohibicion de ADR-007, aplicada en profundidad sobre cualquier valor.
 * Se exporta porque la prueba negativa la ejerce directamente.
 */
export function rechazarCamposProhibidosADR007(
  sink: IssueSink,
  path: string,
  valor: unknown,
): void {
  rechazarClavesProhibidas(sink, path, valor, CAMPOS_PROHIBIDOS_ADR_007, (clave, ruta) => ({
    message: `El campo ${JSON.stringify(clave)} esta prohibido en la salida determinista (aparece en ${ruta}).`,
    hint:
      clave === "alert"
        ? `Este modulo NO decide alertar: entrega evidencia ponderable y quien la convierte en voto es el decisor, con una tabla de lectura declarada y auditable regla a regla. Emite el hallazgo con su rule_id y deja que el VD lo lea (ADR-007, ${REF}.3).`
        : `Este modulo no pondera ni ordena por gravedad. Un ${clave} aqui devolveria autoridad clinica a un componente que por diseño no la tiene, y lo haria de forma invisible para la auditoria. Si necesitas transportar la fuerza de un hallazgo, hazlo con clases y composiciones declaradas, no con un numero (ADR-006 y ADR-007, ${REF}.3). Añadirlo exige un ADR que revierta ambos explicitamente.`,
  }));
}

// ---------------------------------------------------------------------------
// DeterministicRequest
// ---------------------------------------------------------------------------

export function validateDeterministicRequest(valor: unknown): ValidationResult {
  const sink: IssueSink = [];
  const req = exigirObjeto(sink, "", valor, "un DeterministicRequest");
  if (!req) return resultado(sink);

  rechazarClavesDesconocidas(
    sink,
    "",
    req,
    CLAVES_REQUEST,
    `La peticion transporta las MISMAS unidades que el decisor recibio en submitFrame, sin re-tipar (${REF}.2).`,
  );

  exigirCadena(sink, "session_id", req["session_id"], {
    noVacia: true,
    hint: `Identifica la sesion en la traza; el modulo se invoca una sola vez por sesion (${REF}.1).`,
  });
  exigirCadena(sink, "frame_id", req["frame_id"], {
    noVacia: true,
    hint: `Debe ser el frame_id del marco que el decisor declaro suficiente (${REF}.1).`,
  });
  exigirCadena(sink, "domain_version", req["domain_version"], {
    noVacia: true,
    hint: `Si no coincide con la taxonomia cargada, el modulo produce error explicito. Es el mismo guardarrail que embedding_model en el RAG (ADR-015).`,
  });

  const modificadores = exigirObjeto(sink, "modifiers", req["modifiers"], "el objeto modifiers");
  if (modificadores) {
    for (const [clave, valorModificador] of Object.entries(modificadores)) {
      if (
        valorModificador !== null &&
        typeof valorModificador !== "string" &&
        typeof valorModificador !== "number" &&
        typeof valorModificador !== "boolean"
      ) {
        agregar(
          sink,
          `modifiers.${clave}`,
          "tipo_invalido",
          `Los modificadores admiten string, number, boolean o null; se recibio ${typeof valorModificador}.`,
          `Un modificador condiciona QUE reglas aplican sin alterar el colapso. Si necesitas estructura anidada, el modelado esta mal: eso es una unidad, no un modificador (${REF}, §7.3).`,
        );
      }
    }
  }

  const unidades = validateUnitResults(req["units"]);
  sink.push(...unidades.issues);

  return resultado(sink);
}

// ---------------------------------------------------------------------------
// DeterministicReport
// ---------------------------------------------------------------------------

export function validateDeterministicReport(valor: unknown): ValidationResult {
  const sink: IssueSink = [];

  // Primero la prohibicion, en profundidad y sobre el objeto crudo: si alguien
  // metio `alert`, importa mas que cualquier otro problema del reporte.
  rechazarCamposProhibidosADR007(sink, "", valor);

  const reporte = exigirObjeto(sink, "", valor, "un DeterministicReport");
  if (!reporte) return resultado(sink);

  rechazarClavesDesconocidas(
    sink,
    "",
    reporte,
    CLAVES_REPORTE,
    `El reporte tiene tres ejes (ADR-006), cobertura (ADR-009), traza y calidad. Nada mas (${REF}.3).`,
  );

  exigirCadena(sink, "domain_version", reporte["domain_version"], {
    noVacia: true,
    hint: `Sin version, dos ejecuciones con taxonomias distintas serian indistinguibles en la auditoria (${REF}.3).`,
  });
  exigirCadena(sink, "frame_id", reporte["frame_id"], {
    noVacia: true,
    hint: `Ancla el reporte al marco que lo produjo (${REF}.3).`,
  });

  validarEjeFuncionalidad(sink, reporte["funcionalidad"]);
  validarEjeInteraccion(sink, reporte["interaccion"]);
  validarEjeIntegridad(sink, reporte["integridad"]);
  validarCobertura(sink, reporte["coverage"]);
  validarTraza(sink, reporte["trace"]);
  validarCalidad(sink, reporte["quality"]);

  return resultado(sink);
}

function validarEjeFuncionalidad(sink: IssueSink, valor: unknown): void {
  const eje = exigirObjeto(sink, "funcionalidad", valor, "el eje funcionalidad");
  if (!eje) return;
  rechazarClavesDesconocidas(sink, "funcionalidad", eje, ["clases", "cardinalidad", "lectura"], `${REF}.3`);

  const clases = validarClassHits(sink, "funcionalidad.clases", eje["clases"]);

  const cardinalidad = exigirNumero(sink, "funcionalidad.cardinalidad", eje["cardinalidad"], {
    min: 0,
    entero: true,
    hint: `Es |clases|: 1 es patron puro, >1 es coexistencia (${REF}.3).`,
  });
  if (cardinalidad !== undefined && clases !== undefined) {
    const distintas = new Set(clases).size;
    if (cardinalidad !== distintas) {
      agregar(
        sink,
        "funcionalidad.cardinalidad",
        "incoherencia",
        `cardinalidad dice ${cardinalidad} pero en clases hay ${distintas} clase(s) distinta(s).`,
        `La cardinalidad se deriva de las clases presentes, no se declara aparte. Recalculala en el ensamblado del reporte (${REF}.3, §7.2 paso 3).`,
      );
    }
  }

  exigirEnum(sink, "funcionalidad.lectura", eje["lectura"], LECTURAS_FUNCIONALIDAD, `La lectura es una etiqueta enumerada, no prosa: el modulo no redacta (${REF}.3).`);
}

function validarEjeInteraccion(sink: IssueSink, valor: unknown): void {
  const eje = exigirObjeto(sink, "interaccion", valor, "el eje interaccion");
  if (!eje) return;
  rechazarClavesDesconocidas(sink, "interaccion", eje, ["convergentes", "composiciones", "lectura"], `${REF}.3`);

  validarClassHits(sink, "interaccion.convergentes", eje["convergentes"]);

  const composiciones = exigirArreglo(sink, "interaccion.composiciones", eje["composiciones"], {
    hint: `Combinaciones declaradas que se activaron. Vacio es valido (${REF}.3).`,
  });
  if (composiciones) {
    composiciones.forEach((hit, i) => {
      const ruta = `interaccion.composiciones[${i}]`;
      const obj = exigirObjeto(sink, ruta, hit, "un CompositionHit");
      if (!obj) return;
      rechazarClavesDesconocidas(
        sink,
        ruta,
        obj,
        ["rule_id", "clases_requeridas", "clase_producida", "origen_unit_ids"],
        `Invariante 2 de ${REF}.4: ningun hallazgo lleva peso, score ni orden de gravedad.`,
      );
      exigirRuleId(sink, ruta, obj["rule_id"]);
      exigirOrigenUnitIds(sink, ruta, obj["origen_unit_ids"]);
      exigirArregloDeCadenas(sink, `${ruta}.clases_requeridas`, obj["clases_requeridas"], {
        noVacio: true,
        hint: `Una composicion se activa por la presencia del conjunto COMPLETO de clases requeridas; sin conjunto no hay regla (${REF}, §7.4).`,
      });
      exigirCadena(sink, `${ruta}.clase_producida`, obj["clase_producida"], {
        noVacia: true,
        hint: `Es lo que la regla emite: significado que ninguna parte tiene por separado (${REF}, §7.4).`,
      });
    });
  }

  exigirEnum(sink, "interaccion.lectura", eje["lectura"], LECTURAS_INTERACCION, `${REF}.3`);
}

function validarEjeIntegridad(sink: IssueSink, valor: unknown): void {
  const eje = exigirObjeto(sink, "integridad", valor, "el eje integridad");
  if (!eje) return;
  rechazarClavesDesconocidas(sink, "integridad", eje, ["comprometidas", "lectura"], `${REF}.3`);

  const estructuras = exigirArreglo(sink, "integridad.comprometidas", eje["comprometidas"], {
    hint: `Estructuras con compromiso declarado. Vacio es valido y significa integra (${REF}.3).`,
  });
  if (estructuras) {
    estructuras.forEach((hit, i) => {
      const ruta = `integridad.comprometidas[${i}]`;
      const obj = exigirObjeto(sink, ruta, hit, "un StructureHit");
      if (!obj) return;
      rechazarClavesDesconocidas(
        sink,
        ruta,
        obj,
        ["rule_id", "estructura", "clases_contribuyentes", "origen_unit_ids"],
        `Invariante 2 de ${REF}.4: ningun hallazgo lleva peso, score ni orden de gravedad.`,
      );
      exigirRuleId(sink, ruta, obj["rule_id"]);
      exigirOrigenUnitIds(sink, ruta, obj["origen_unit_ids"]);
      exigirCadena(sink, `${ruta}.estructura`, obj["estructura"], {
        noVacia: true,
        hint: `Nodo del arbol taxonomico del dominio cargado (${REF}.4).`,
      });
      exigirArregloDeCadenas(sink, `${ruta}.clases_contribuyentes`, obj["clases_contribuyentes"], {
        noVacio: true,
        hint: `Que clases sostienen la afirmacion. Una integridad comprometida sin clases que la sostengan no es reconstruible (${REF}.4).`,
      });
    });
  }

  exigirEnum(sink, "integridad.lectura", eje["lectura"], LECTURAS_INTEGRIDAD, `${REF}.3`);
}

function validarClassHits(sink: IssueSink, ruta: string, valor: unknown): string[] | undefined {
  const hits = exigirArreglo(sink, ruta, valor, {
    hint: `Clases presentes. Vacio es valido: "sin_hallazgo" es un resultado, no un vacio (ADR-009).`,
  });
  if (!hits) return undefined;

  const clases: string[] = [];
  hits.forEach((hit, i) => {
    const rutaHit = `${ruta}[${i}]`;
    const obj = exigirObjeto(sink, rutaHit, hit, "un ClassHit");
    if (!obj) return;
    rechazarClavesDesconocidas(
      sink,
      rutaHit,
      obj,
      ["rule_id", "clase", "origen_unit_ids", "origen_valores", "fallback"],
      `Invariante 2 de ${REF}.4: ningun hallazgo lleva peso, score ni orden de gravedad. Y el campo de origen se llama origen_unit_ids en los TRES tipos de hallazgo (correccion X-6).`,
    );
    exigirRuleId(sink, rutaHit, obj["rule_id"]);
    exigirOrigenUnitIds(sink, rutaHit, obj["origen_unit_ids"]);
    const clase = exigirCadena(sink, `${rutaHit}.clase`, obj["clase"], {
      noVacia: true,
      hint: `Identificador de clase del dominio cargado (${REF}.4).`,
    });
    if (clase !== undefined) clases.push(clase);
    exigirArreglo(sink, `${rutaHit}.origen_valores`, obj["origen_valores"], {
      hint: `Los normalized que mapearon a esta clase. Es lo que permite citar regla y evidencia en la misma frase (${REF}.4).`,
    });
    exigirBooleano(sink, `${rutaHit}.fallback`, obj["fallback"], `true si el valor cayo a la clase de fallback en vez de mapear a una declarada; alimenta quality.fallback_rate (${REF}.3).`);
  });

  return clases;
}

function exigirRuleId(sink: IssueSink, ruta: string, valor: unknown): void {
  exigirCadena(sink, `${ruta}.rule_id`, valor, {
    noVacia: true,
    hint: `Invariante 1 de ${REF}.4: los rule_id son la fuente UNICA de Decision.traces.rules_fired. Un hallazgo sin rule_id es un hallazgo no reconstruible, y la trazabilidad es criterio de rubrica, no adorno.`,
  });
}

function exigirOrigenUnitIds(sink: IssueSink, ruta: string, valor: unknown): void {
  exigirArregloDeCadenas(sink, `${ruta}.origen_unit_ids`, valor, {
    noVacio: true,
    hint: `Invariante 3 de ${REF}.4: toda afirmacion del reporte tiene que poder recorrerse hacia atras hasta las unidades que la originaron. El campo se llama origen_unit_ids en los tres tipos de hallazgo, no unit_ids (correccion X-6).`,
  });
}

function validarCobertura(sink: IssueSink, valor: unknown): void {
  const cobertura = exigirObjeto(
    sink,
    "coverage",
    valor,
    "el objeto coverage",
    `ADR-009 la hace obligatoria: la no evaluabilidad es RESULTADO, no vacio. Sin ella, el decisor no puede aplicar "cobertura antes del silencio" y el falso negativo por omision —el error mas caro— deja de estar bloqueado por regla (docs/Especificacion-Capa-Decision.md §10).`,
  );
  if (!cobertura) return;

  rechazarClavesDesconocidas(sink, "coverage", cobertura, ["evaluadas", "no_evaluadas", "ratio"], `${REF}.3`);

  const evaluadas = exigirArregloDeCadenas(sink, "coverage.evaluadas", cobertura["evaluadas"], {
    hint: `Unit ids que entraron al calculo. Vacio es valido si ninguna unidad era elegible (§7.1).`,
  });

  const noEvaluadas = exigirArreglo(sink, "coverage.no_evaluadas", cobertura["no_evaluadas"], {
    hint: `Que no se pudo mirar y por que. Vacio es valido; omitirlo no (ADR-009).`,
  });
  if (noEvaluadas) {
    noEvaluadas.forEach((entrada, i) => {
      const ruta = `coverage.no_evaluadas[${i}]`;
      const obj = exigirObjeto(sink, ruta, entrada, "una entrada de no_evaluadas");
      if (!obj) return;
      rechazarClavesDesconocidas(sink, ruta, obj, ["unit_id", "causa", "eje_afectado"], `${REF}.3`);
      exigirCadena(sink, `${ruta}.unit_id`, obj["unit_id"], { noVacia: true, hint: `${REF}.3` });
      exigirCadena(sink, `${ruta}.causa`, obj["causa"], {
        noVacia: true,
        hint: `Heredada de UnitResult.cause, o "sin_normalizar" para las unidades hidratadas sin mapeo (§7.1). La causa es la informacion: un no_sabe y un no_comprende habilitan lecturas clinicas distintas (§10.3 de la conversacional).`,
      });
      const ejes = exigirArreglo(sink, `${ruta}.eje_afectado`, obj["eje_afectado"], {
        noVacio: true,
        hint: `Que eje queda ciego por esta ausencia. Sin eje, el decisor no sabe que parte del reporte es incompleta (ADR-009).`,
      });
      if (ejes) {
        ejes.forEach((eje, j) => {
          exigirEnum(sink, `${ruta}.eje_afectado[${j}]`, eje, EJES, `Los tres ejes de ADR-006.`);
        });
      }
    });
  }

  const ratio = exigirNumero(sink, "coverage.ratio", cobertura["ratio"], {
    min: 0,
    max: 1,
    hint: `evaluadas / total. Vive en [0,1] (${REF}.3).`,
  });

  if (ratio !== undefined && evaluadas !== undefined && noEvaluadas !== undefined) {
    const total = evaluadas.length + noEvaluadas.length;
    const esperado = total === 0 ? 0 : evaluadas.length / total;
    if (Math.abs(ratio - esperado) > 1e-9) {
      agregar(
        sink,
        "coverage.ratio",
        "incoherencia",
        `ratio dice ${ratio} pero evaluadas/total es ${evaluadas.length}/${total} = ${esperado}.`,
        `El ratio se deriva de las dos listas, no se declara aparte. Un ratio inflado le haria creer al decisor que miro mas de lo que miro, y es justo el numero que consulta antes de emitir escalate: false (ADR-009).`,
      );
    }
  }
}

function validarTraza(sink: IssueSink, valor: unknown): void {
  const traza = exigirArreglo(sink, "trace", valor, {
    hint: `Trazabilidad completa: toda afirmacion reconstruible hasta la entrada. Vacio es valido si no hubo hallazgos; omitirlo no (${REF}.3).`,
  });
  if (!traza) return;

  traza.forEach((entrada, i) => {
    const ruta = `trace[${i}]`;
    const obj = exigirObjeto(sink, ruta, entrada, "una entrada de trace");
    if (!obj) return;
    rechazarClavesDesconocidas(sink, ruta, obj, ["rule_id", "clase", "origen_unit_ids", "origen_valores"], `${REF}.3`);
    exigirRuleId(sink, ruta, obj["rule_id"]);
    exigirOrigenUnitIds(sink, ruta, obj["origen_unit_ids"]);
    exigirCadena(sink, `${ruta}.clase`, obj["clase"], { noVacia: true, hint: `${REF}.3` });
    exigirArreglo(sink, `${ruta}.origen_valores`, obj["origen_valores"], {
      hint: `Los normalized que dispararon la regla (${REF}.3).`,
    });
  });
}

function validarCalidad(sink: IssueSink, valor: unknown): void {
  const calidad = exigirObjeto(sink, "quality", valor, "el objeto quality");
  if (!calidad) return;
  rechazarClavesDesconocidas(
    sink,
    "quality",
    calidad,
    ["fallback_rate", "unidades_condicionadas", "warnings"],
    `quality es la salud del PROPIO MODULO, no la del paciente. La distincion importa: aqui no hay lectura clinica (${REF}.3).`,
  );
  exigirNumero(sink, "quality.fallback_rate", calidad["fallback_rate"], {
    min: 0,
    max: 1,
    hint: `Proporcion de valores caidos a la clase de fallback. Un fallback_rate alto dice que la taxonomia no cubre lo que el paciente reporta (${REF}.3).`,
  });
  exigirArregloDeCadenas(sink, "quality.unidades_condicionadas", calidad["unidades_condicionadas"], {
    hint: `Las cubierta_condicionada que entraron al calculo con dependencias abiertas (§7.1).`,
  });
  exigirArregloDeCadenas(sink, "quality.warnings", calidad["warnings"], {
    hint: `Avisos del modulo sobre su propia ejecucion. Vacio es lo normal (${REF}.3).`,
  });
}

// ---------------------------------------------------------------------------
// DomainManifest
// ---------------------------------------------------------------------------

export function validateDomainManifest(valor: unknown): ValidationResult {
  const sink: IssueSink = [];
  rechazarCamposProhibidosADR007(sink, "", valor);

  const manifiesto = exigirObjeto(sink, "", valor, "un DomainManifest");
  if (!manifiesto) return resultado(sink);

  rechazarClavesDesconocidas(
    sink,
    "",
    manifiesto,
    ["domain_version", "domain_name", "checksum", "clases", "composiciones", "modificadores", "validez_clinica"],
    `${REF}.4`,
  );

  exigirCadena(sink, "domain_version", manifiesto["domain_version"], { noVacia: true, hint: `${REF}.4` });
  exigirCadena(sink, "domain_name", manifiesto["domain_name"], { noVacia: true, hint: `${REF}.4` });
  exigirCadena(sink, "checksum", manifiesto["checksum"], {
    noVacia: true,
    hint: `No es ceremonia: sin huella del archivo de dominio, dos ejecuciones con la misma domain_version y contenido distinto son indistinguibles — que es exactamente el modo de fallo que romperia el determinismo que este modulo promete (${REF}.4).`,
  });
  exigirNumero(sink, "clases", manifiesto["clases"], { min: 0, entero: true, hint: `${REF}.4` });
  exigirNumero(sink, "composiciones", manifiesto["composiciones"], { min: 0, entero: true, hint: `${REF}.4` });
  exigirArregloDeCadenas(sink, "modificadores", manifiesto["modificadores"], { hint: `${REF}.4` });
  exigirEnum(
    sink,
    "validez_clinica",
    manifiesto["validez_clinica"],
    VALIDEZ_CLINICA,
    `ADR-010 lo hace obligatorio y legible fuera de contexto. Sin experto clinico validando la taxonomia, el valor es "sin_validez_clinica_dominio_sintetico" y se declara en el informe: es la misma honestidad estructural de ADR-006 aplicada al dominio.`,
  );

  return resultado(sink);
}
