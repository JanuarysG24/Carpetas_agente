/**
 * Objetos VALIDOS minimos, uno por tipo normativo.
 *
 * Sirven para dos cosas: comprobar que el camino feliz pasa, y —sobre todo— como
 * base a la que se le rompe UN campo por prueba. Romper un campo de un objeto
 * valido aisla el rechazo; construir un objeto malo entero no distingue si fallo
 * por lo que se queria probar o por otra cosa.
 */
import type {
  CallSummary,
  Decision,
  DeterministicReport,
  SourceDocument,
  UnitResult,
} from "../../src/index.ts";

export const UNIT_RESULT_VALIDO: UnitResult = {
  id: "aspecto_herida",
  extraction: "cubierta",
  state: 2,
  state_trace: [0, 1, 2],
  raw: "la tengo como colorada y con una materia amarilla",
  normalized: "exudado_purulento",
  confidence: 0.82,
  coverage_met: ["value"],
  turn_refs: [4, 5],
};

/** Una unidad que no se pudo extraer, y que sin embargo es un turno SANO (§10.2). */
export const UNIT_RESULT_NO_SABE: UnitResult = {
  id: "fiebre",
  extraction: "suspendida",
  state: 1,
  state_trace: [0, 1],
  raw: "no se, no me tome la temperatura",
  normalized: null,
  confidence: 0,
  coverage_met: [],
  cause: "no_sabe",
  closure: "declarado",
  turn_refs: [7],
};

export const DECISION_VALIDA: Decision = {
  escalate: true,
  criticality: "rojo",
  reason: "Exudado purulento en herida quirurgica con fiebre no verificada al dia 7 post-operatorio.",
  reason_code: "evaluado",
  say_to_patient: "Voy a pedir que un profesional la contacte hoy mismo para revisar la herida.",
  traces: { doc_ids: ["doc_ssi_001"], rules_fired: ["R-comp-001"] },
  context_complete: true,
};

export const REPORTE_VALIDO: DeterministicReport = {
  domain_version: "postop-c1-0.1.0",
  frame_id: "f_9c2a",
  funcionalidad: {
    clases: [
      {
        rule_id: "R-clase-001",
        clase: "compromiso_local",
        origen_unit_ids: ["aspecto_herida"],
        origen_valores: ["exudado_purulento"],
        fallback: false,
      },
    ],
    cardinalidad: 1,
    lectura: "patron_unico",
  },
  interaccion: {
    convergentes: [],
    composiciones: [],
    lectura: "hallazgos_independientes",
  },
  integridad: {
    comprometidas: [],
    lectura: "integra",
  },
  coverage: {
    evaluadas: ["aspecto_herida"],
    no_evaluadas: [
      { unit_id: "fiebre", causa: "no_sabe", eje_afectado: ["funcionalidad", "interaccion"] },
    ],
    ratio: 0.5,
  },
  trace: [
    {
      rule_id: "R-clase-001",
      clase: "compromiso_local",
      origen_unit_ids: ["aspecto_herida"],
      origen_valores: ["exudado_purulento"],
    },
  ],
  quality: {
    fallback_rate: 0,
    unidades_condicionadas: [],
    warnings: [],
  },
};

export const DOCUMENTO_VALIDO: SourceDocument = {
  doc_id: "doc_ssi_001",
  title: "Infeccion de sitio operatorio: signos, vigilancia y criterios de derivacion",
  kind: "complicaciones",
  lang: "es",
  origin: "Guia de practica clinica institucional",
  effective_date: "2023-05-01",
  body: "El exudado purulento en la herida quirurgica es un signo de infeccion de sitio operatorio...",
};

export const RESUMEN_VALIDO: CallSummary = {
  session_id: "s_0042",
  generated_at: "2026-08-07T15:04:05.000Z",
  patient_ref: "p_0042",
  identity_status: "identificado",
  frame: { provenance: "inferred", rounds: 2, context_complete: true },
  findings: [
    {
      unit_id: "aspecto_herida",
      state: 2,
      raw: "la tengo como colorada y con una materia amarilla",
      normalized: "exudado_purulento",
    },
    // Un numerico y un booleano, a proposito: son los dos casos que la correccion
    // X-7 protege. Si alguien vuelve a estrechar la union, este fixture no compila.
    { unit_id: "fiebre", state: 1, raw: "creo que tenia 38 y medio", normalized: 38.5 },
    { unit_id: "adherencia_medicacion", state: 3, raw: "si señor, todo completo", normalized: true },
  ],
  decision: {
    escalate: true,
    criticality: "rojo",
    reason: "Exudado purulento con fiebre reportada al dia 7 post-operatorio.",
    reason_code: "evaluado",
    branch: "or",
    votes: {
      vp: { escalate: true, criticality: "rojo", reason: "Signo de infeccion de sitio operatorio." },
      vd: { escalate: true, criticality: "amarillo", reason: "Composicion R-comp-001 activada." },
    },
    traces: { doc_ids: ["doc_ssi_001"], rules_fired: ["R-comp-001"], vd_rule: "VD-2" },
  },
  versions: {
    domain_version: "postop-c1-0.1.0",
    vd_version: "vd-0.1.0",
    embedding_model: "multilingue-liviano-0.1",
  },
};

/** Clona en profundidad para poder romper un campo sin contaminar el fixture. */
export function copiar<T>(valor: T): T {
  return structuredClone(valor);
}
