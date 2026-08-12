/**
 * Costura conversacional <-> decision: aserciones A NIVEL DE TIPO.
 *
 * Estas pruebas no comprueban valores, comprueban la FORMA del contrato. Si alguien
 * renombra `escalate` a `alert`, colapsa `criticality`, vuelve `reason_code` opcional
 * o mete `max_rounds` en `policy`, `npm run typecheck` falla antes de que exista
 * una sola linea de implementacion que lo arrastre.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  ContextFrame,
  Criticality,
  Decision,
  FramePolicy,
  FrameVerdict,
  NormalizedValue,
  ReasonCode,
  SessionState,
  UnitResult,
  UnitSpec,
} from "../src/index.ts";
import { CONFIDENCE_MAX, CONFIDENCE_MIN, STATE_MAX, STATE_MIN } from "../src/index.ts";
import type { Equal, Expect, HasNoKey, HasRequiredKey } from "./_type-assertions.ts";
import { EJEMPLO_SPEC_8_3 } from "./fixtures/spec-conversacional-8-3.ts";

// --- ADR-018 · `escalate` y `criticality` son campos independientes ---------

/** El booleano se llama `escalate`. `alert` no existe en `Decision` (correccion X-1). */
export type _DecisionNoUsaAlert = Expect<HasNoKey<Decision, "alert">>;

/** Ambos campos son obligatorios: ninguno se deriva del otro. */
export type _DecisionLlevaEscalate = Expect<HasRequiredKey<Decision, "escalate">>;
export type _DecisionLlevaCriticality = Expect<HasRequiredKey<Decision, "criticality">>;
export type _EscalateEsBooleano = Expect<Equal<Decision["escalate"], boolean>>;
export type _CriticalityEsTernaria = Expect<
  Equal<Decision["criticality"], "verde" | "amarillo" | "rojo">
>;
export type _CriticalityAliasCoincide = Expect<Equal<Criticality, Decision["criticality"]>>;

// --- Correccion X-5 · `reason` y `reason_code` obligatorios -----------------

export type _ReasonObligatorio = Expect<HasRequiredKey<Decision, "reason">>;
export type _ReasonCodeObligatorio = Expect<HasRequiredKey<Decision, "reason_code">>;
export type _ReasonCodeTieneSeisValores = Expect<
  Equal<
    ReasonCode,
    | "evaluado"
    | "vigilancia"
    | "contexto_incompleto"
    | "incongruencia"
    | "falla_tecnica"
    | "urgencia"
  >
>;

// --- Correccion X-4 · `max_rounds` no vive en `policy` ----------------------

export type _PolicySinMaxRounds = Expect<HasNoKey<FramePolicy, "max_rounds">>;
/** Y tampoco se cuela por el marco entero. */
export type _FrameSinMaxRounds = Expect<HasNoKey<ContextFrame, "max_rounds">>;

// --- ADR-005 · `state` y `confidence` son cosas distintas -------------------

export type _UnitResultLlevaState = Expect<HasRequiredKey<UnitResult, "state">>;
export type _UnitResultLlevaConfidence = Expect<HasRequiredKey<UnitResult, "confidence">>;
export type _UnitResultLlevaTrayectoria = Expect<HasRequiredKey<UnitResult, "state_trace">>;
/** Ninguna de las dos es opcional: colapsar o omitir una destruye señal (ADR-005). */
export type _StateNoEsOpcional = Expect<Equal<UnitResult["state"], number>>;
export type _ConfidenceNoEsOpcional = Expect<Equal<UnitResult["confidence"], number>>;

// --- Correccion M2 · la ausencia de lectura no se codifica como un valor ----

/**
 * `frame_health` admite `null` = no hay ninguna `required` abierta que medir.
 * Si alguien lo estrecha a `number`, la ausencia volveria a viajar disfrazada de
 * `0` y el decisor no podria distinguirla de "todas las requeridas estan en 0".
 */
export type _FrameHealthAdmiteAusencia = Expect<
  Equal<SessionState["frame_health"], number | null>
>;
/** `global` es un acumulador y SIEMPRE existe: no comparte la ausencia de `frame_health`. */
export type _GlobalNoAdmiteAusencia = Expect<Equal<SessionState["global"], number>>;

// --- Correccion X-7 · la union normalizada es ancha en los dos lados --------

export type _NormalizedEsAncho = Expect<
  Equal<NormalizedValue, string | number | boolean | null>
>;
export type _UnitResultUsaLaUnionAncha = Expect<
  Equal<UnitResult["normalized"], NormalizedValue>
>;

// --- Campos que el Paso 0 exige explicitamente en `UnitSpec` / `UnitResult` -

export type _UnitSpecLlevaCoverage = Expect<HasRequiredKey<UnitSpec, "coverage">>;
export type _UnitResultLlevaCoverageMet = Expect<HasRequiredKey<UnitResult, "coverage_met">>;

// --- `FrameVerdict` es una union discriminada, no un objeto con opcionales --

export type _VerdictNeedMoreLlevaDelta = Expect<
  Equal<Extract<FrameVerdict, { status: "need_more" }>["frame_delta"], ContextFrame>
>;
export type _VerdictSufficientLlevaDecision = Expect<
  Equal<Extract<FrameVerdict, { status: "sufficient" }>["decision"], Decision>
>;

// --- Comprobaciones en ejecucion -------------------------------------------

test("el ContextFrame de la spec §8.3 conforma el tipo y conserva su forma", () => {
  // Que este archivo compile ya es la prueba de tipo (el fixture usa `satisfies`).
  // Aqui se fija ademas que la transcripcion no se degrade por descuido.
  assert.equal(EJEMPLO_SPEC_8_3.frame_id, "f_9c2a");
  assert.equal(EJEMPLO_SPEC_8_3.round, 0);
  assert.equal(EJEMPLO_SPEC_8_3.units.length, 5);
  assert.equal(EJEMPLO_SPEC_8_3.red_flags.length, 2);

  const compuesta = EJEMPLO_SPEC_8_3.units.find((u) => u.id === "signo_infeccion");
  assert.ok(compuesta, "la unidad compuesta del ejemplo debe existir");
  assert.deepEqual(compuesta.composes, ["aspecto_herida", "fiebre", "dolor_intensidad"]);
});

test("los rangos de ADR-005 estan declarados y no se solapan", () => {
  assert.equal(STATE_MIN, -3);
  assert.equal(STATE_MAX, 3);
  assert.equal(CONFIDENCE_MIN, 0);
  assert.equal(CONFIDENCE_MAX, 1);
  // La confusion que ADR-005 previene: son escalas distintas, no dos vistas de una.
  assert.notEqual(STATE_MAX, CONFIDENCE_MAX);
});
