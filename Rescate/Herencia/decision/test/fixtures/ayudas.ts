/**
 * Fixtures de la capa de decision.
 *
 * Los `unit_id` son los del DOMINIO determinista (`fiebre`, `dolor_intensidad`,
 * `movilidad`, `aspecto_herida`, `apetito`, `sueno`) y NO los nombres de columna del
 * dataset (`fiebre_c`, `dolor_nrs`, `herida`). Un id que no coincide con la funcion
 * de clase no falla: colapsa al fallback EN SILENCIO, que es peor (hallazgo D5).
 */

import type {
  ContextFrame,
  SourceDocument,
  UnitResult,
  UnitSpec,
} from "@techsphere/contracts";

export function unidadSpec(id: string, extra: Partial<UnitSpec> = {}): UnitSpec {
  return {
    id,
    intent: `Saber el estado de ${id} desde la cirugia.`,
    priority: "required",
    type: "quantity",
    coverage: { requires: ["value"] },
    ...extra,
  };
}

export function marco(extra: Partial<ContextFrame> = {}): ContextFrame {
  return {
    frame_id: "frame-prueba-0",
    patient_ref: "ref-opaca-001",
    round: 0,
    units: [
      unidadSpec("fiebre", { coverage: { requires: ["value", "onset"] } }),
      unidadSpec("dolor_intensidad", { type: "scale", coverage: { requires: ["magnitude"] } }),
      unidadSpec("aspecto_herida", { type: "categorical" }),
      unidadSpec("apetito", { priority: "desired" }),
      unidadSpec("sueno", { priority: "opportunistic" }),
    ],
    red_flags: [{ id: "RF-sangrado", patterns: ["sangre", "sangrando"] }],
    policy: {
      max_turns: 8,
      max_session_ms: 300_000,
      reflect_below_confidence: 0.5,
      stall_window: 3,
      allow_partial_handback: true,
    },
    ...extra,
  };
}

/** Una unidad CUBIERTA y normalizada: el caso feliz del que parten las variaciones. */
export function unidadCubierta(id: string, extra: Partial<UnitResult> = {}): UnitResult {
  return {
    id,
    extraction: "cubierta",
    state: 2,
    state_trace: [1, 2],
    raw: "me sentia caliente anoche, 38 y algo",
    normalized: 38.4,
    confidence: 0.9,
    coverage_met: ["value", "onset", "trend", "magnitude"],
    turn_refs: [2],
    ...extra,
  };
}

/**
 * Una unidad tal como la entrega el andamio: hay literal del paciente y no hay
 * valor mapeable. Es la forma exacta que fija la prueba de regresion de ADR-014.
 */
export function unidadSinNormalizar(id: string, extra: Partial<UnitResult> = {}): UnitResult {
  return {
    id,
    extraction: "hidratada_sin_normalizar",
    state: 1,
    state_trace: [1],
    raw: "pues ahi vamos, mas o menos",
    normalized: null,
    confidence: 0.2,
    coverage_met: [],
    turn_refs: [3],
    ...extra,
  };
}

export function documento(extra: Partial<SourceDocument> = {}): SourceDocument {
  return {
    doc_id: "postop-cuidados-generico",
    title: "Cuidados post-operatorios generales",
    kind: "cuidados",
    lang: "es",
    origin: "DATOS SINTETICOS — sin validez clinica. Corpus semilla de desarrollo.",
    effective_date: "2024-01-01",
    // Densidad de una pagina real de instrucciones (>800 caracteres): el fixture del
    // camino feliz no debe caer en la franja de aviso, o la franja deja de significar algo.
    body:
      "DATOS SINTETICOS — sin validez clinica. " +
      "Mantenga la herida limpia y seca durante las primeras cuarenta y ocho horas. " +
      "Lave la zona con agua y jabon suave, seque sin frotar y cubra con un aposito limpio. " +
      "Cambie el aposito una vez al dia, o antes si se moja o se ensucia, y lavese las manos " +
      "antes y despues de tocarlo. " +
      "Consulte si aparece enrojecimiento que crece, salida de material o fiebre sostenida. " +
      "Camine distancias cortas varias veces al dia: la movilidad temprana reduce complicaciones " +
      "respiratorias y trombosis, y no compite con el reposo de la zona intervenida. " +
      "Evite levantar peso durante las dos primeras semanas y suba escaleras despacio, " +
      "apoyandose en la baranda. " +
      "Retome la alimentacion habitual de forma progresiva, empezando por liquidos claros " +
      "y avanzando a blandos segun tolerancia. " +
      "Tome los analgesicos en los horarios indicados y no espere a que el dolor sea intenso " +
      "para tomarlos: controlar el dolor es lo que permite moverse, y moverse es lo que " +
      "acorta la recuperacion.",
    ...extra,
  };
}
