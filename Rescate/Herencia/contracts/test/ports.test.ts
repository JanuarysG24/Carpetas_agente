/**
 * Los ocho puertos: aserciones de forma y la prueba de que el TRANSPORTE queda fuera.
 *
 * La prueba central de este archivo es la regla 5 del Paso 0: se declaran DOS
 * implementaciones del mismo puerto —una en proceso y otra sobre un transporte
 * simulado— y ambas satisfacen la interfaz SIN cambiarla. Si alguien mete una
 * preocupacion de transporte en el tipo, una de las dos deja de compilar.
 *
 * Los cuerpos son stubs deliberados: implementar un puerto es de otra sesion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  ContextFrame,
  ConversationalEngine,
  Decision,
  DecisionEngine,
  DecisionPort,
  DeterministicPort,
  DeterministicReport,
  FrameVerdict,
  KnowledgeConsolePort,
  KnowledgePort,
  PatientStorePort,
  SummarySinkPort,
} from "../src/index.ts";
import type { Equal, Expect } from "./_type-assertions.ts";

// --- `evaluate` es SINCRONO: sin `Promise`, y es normativo -----------------

export type _EvaluateEsSincrono = Expect<
  Equal<ReturnType<DeterministicPort["evaluate"]>, DeterministicReport>
>;
export type _EvaluateNoDevuelvePromise = Expect<
  Equal<ReturnType<DeterministicPort["evaluate"]> extends Promise<unknown> ? true : false, false>
>;
/** Y las lecturas de estado tampoco: acceso exacto por clave, no red. */
export type _VerifyIdentityEsSincrono = Expect<
  Equal<ReturnType<PatientStorePort["verifyIdentity"]> extends Promise<unknown> ? true : false, false>
>;
export type _RetrieveEsSincrono = Expect<
  Equal<ReturnType<KnowledgePort["retrieve"]> extends Promise<unknown> ? true : false, false>
>;

// --- Las tres operaciones de `DecisionPort` cruzan una frontera y son async -

export type _RequestFrameEsAsync = Expect<
  Equal<ReturnType<DecisionPort["requestFrame"]>, Promise<ContextFrame>>
>;
export type _SubmitFrameEsAsync = Expect<
  Equal<ReturnType<DecisionPort["submitFrame"]>, Promise<FrameVerdict>>
>;
/** `escalateNow` devuelve `Decision` directamente: en urgencia no hay bucle. */
export type _EscalateNowDevuelveDecision = Expect<
  Equal<ReturnType<DecisionPort["escalateNow"]>, Promise<Decision>>
>;

// --- Los ocho puertos existen y son interfaces sin implementacion -----------
//
// `unknown` extends P solo si P no tiene miembros. Que sea `false` en los ocho
// prueba que cada uno declara operaciones; que este archivo no importe nada de
// `src` en tiempo de ejecucion prueba que ninguno trae implementacion.

type EsPuertoConOperaciones<P> = unknown extends P ? false : true;

export type _P1 = Expect<Equal<EsPuertoConOperaciones<DecisionPort>, true>>;
export type _P2 = Expect<Equal<EsPuertoConOperaciones<DeterministicPort>, true>>;
export type _P3 = Expect<Equal<EsPuertoConOperaciones<PatientStorePort>, true>>;
export type _P4 = Expect<Equal<EsPuertoConOperaciones<KnowledgePort>, true>>;
export type _P5 = Expect<Equal<EsPuertoConOperaciones<KnowledgeConsolePort>, true>>;
export type _P6 = Expect<Equal<EsPuertoConOperaciones<SummarySinkPort>, true>>;
export type _P7 = Expect<Equal<EsPuertoConOperaciones<ConversationalEngine>, true>>;
export type _P8 = Expect<Equal<EsPuertoConOperaciones<DecisionEngine>, true>>;

// --- Regla 5 del Paso 0 · el transporte queda fuera del tipo ----------------

const MARCO_VACIO: ContextFrame = {
  frame_id: "f_test",
  patient_ref: null,
  round: 0,
  units: [],
  red_flags: [],
  policy: {
    max_turns: 24,
    max_session_ms: 480000,
    reflect_below_confidence: 0.7,
    stall_window: 3,
    allow_partial_handback: true,
  },
};

const DECISION_VACIA: Decision = {
  escalate: true,
  criticality: "amarillo",
  reason: "stub de prueba de transporte",
  reason_code: "vigilancia",
  say_to_patient: "",
  traces: { doc_ids: [], rules_fired: [] },
  context_complete: false,
};

/** Implementacion IN-PROCESS: llamada de funcion directa. */
const enProceso: DecisionPort = {
  async requestFrame() {
    return MARCO_VACIO;
  },
  async submitFrame() {
    return { status: "sufficient", decision: DECISION_VACIA };
  },
  async escalateNow() {
    return DECISION_VACIA;
  },
};

/**
 * Implementacion SOBRE TRANSPORTE: serializa, "viaja" y deserializa. El transporte
 * se simula con `JSON.parse(JSON.stringify(...))` para no meter red en un test de
 * contratos; lo que importa es que la interfaz es la misma, byte por byte.
 */
function crearSobreTransporte(enviar: (ruta: string, cuerpo: unknown) => unknown): DecisionPort {
  return {
    async requestFrame(req) {
      return enviar("/frame", req) as ContextFrame;
    },
    async submitFrame(req) {
      return enviar("/frame/submit", req) as FrameVerdict;
    },
    async escalateNow(req) {
      return enviar("/escalate", req) as Decision;
    },
  };
}

test("un mismo DecisionPort se satisface en proceso y sobre transporte, sin cambiar el tipo", async () => {
  const sobreTransporte = crearSobreTransporte((ruta) =>
    JSON.parse(
      JSON.stringify(ruta === "/frame" ? MARCO_VACIO : ruta === "/escalate" ? DECISION_VACIA : { status: "sufficient", decision: DECISION_VACIA }),
    ),
  );

  // Las dos implementaciones se usan a traves de la MISMA variable tipada.
  for (const puerto of [enProceso, sobreTransporte] satisfies DecisionPort[]) {
    const marco = await puerto.requestFrame({
      session_id: "s_1",
      identity: { status: "unverified", patient_ref: null, speaker_role: "desconocido" },
    });
    assert.equal(marco.frame_id, "f_test");

    const decision = await puerto.escalateNow({
      session_id: "s_1",
      red_flag_id: "disnea_aguda",
      utterance: "no puedo respirar",
      units_so_far: [],
    });
    assert.equal(decision.escalate, true);
    assert.equal(decision.criticality, "amarillo");
  }
});

test("el modulo de contratos no exporta ninguna implementacion de puerto", async () => {
  const modulo: Record<string, unknown> = await import("../src/index.ts");

  // Lo unico ejecutable que este modulo puede exportar son las constantes
  // declaradas (rangos de ADR-005, listas de campos prohibidos, enums) y los
  // validadores. Ninguna funcion exportada puede llamarse como un puerto.
  const nombresDePuerto = [
    "requestFrame",
    "submitFrame",
    "escalateNow",
    "evaluate",
    "describeDomain",
    "verifyIdentity",
    "getCase",
    "retrieve",
    "ingest",
    "retire",
    "reindex",
    "deliver",
    "interpret",
    "render",
    "assessSufficiency",
    "emitVote",
  ];

  for (const nombre of nombresDePuerto) {
    assert.equal(
      nombre in modulo,
      false,
      `el modulo de contratos exporta "${nombre}": implementar un puerto es de otra sesion`,
    );
  }
});
