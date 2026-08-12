/**
 * WO-36 · PRUEBA NEGATIVA 2 — una `Decision` sin razon o sin trazas es invalida.
 *
 * La razon verbalizada y la evidencia viajan SIEMPRE juntas: una decision sin razon
 * no es auditable, y la trazabilidad es criterio de rubrica. Esta prueba ejerce el
 * guardarrail desde esta capa, que es quien construye las `Decision`, y no solo
 * desde el modulo de contratos: la validacion tiene que estar donde se emite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDecision, type Decision } from "@techsphere/contracts";
import { decisionPorDegradacion } from "../src/index.ts";

function decisionValida(extra: Partial<Decision> = {}): Decision {
  return {
    escalate: true,
    criticality: "rojo",
    reason: "VP (rojo): eritema creciente con fiebre. | VD (rojo): convergencia sistemica.",
    reason_code: "evaluado",
    say_to_patient: "Lo que me describe hay que revisarlo pronto. Voy a pasar su caso al personal.",
    traces: { doc_ids: ["postop-appendectomy-instructions"], rules_fired: ["CO-02"] },
    context_complete: true,
    ...extra,
  };
}

test("el camino feliz valida", () => {
  assert.deepEqual(validateDecision(decisionValida()).issues, []);
});

test("una Decision con escalate true y sin razon es invalida", () => {
  for (const reason of ["", "   "]) {
    const r = validateDecision(decisionValida({ reason }));
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.path === "reason"));
  }
});

test("reason_code evaluado con trazas VACIAS es valido: hay casos en que de verdad lo estan", () => {
  // Corregido el 8-ago contra el dominio y el corpus reales. Un caso verde limpio
  // produce un reporte determinista SIN ningun hallazgo —y por tanto sin un solo
  // `rule_id`—, y con piso de relevancia una unidad sin respaldo en el corpus
  // devuelve cero fragmentos. Exigir trazas llenas empujaba a inventar un rule_id
  // para pasar el esquema, que es lo que ADR-024 prohibe. Quien declara los huecos
  // ahora es `CallSummary.evidence_gaps`.
  assert.deepEqual(
    validateDecision(decisionValida({ traces: { doc_ids: [], rules_fired: [] } })).issues,
    [],
  );
});

test("pero las claves de traza siguen siendo obligatorias", () => {
  const sinClave = { ...decisionValida(), traces: { doc_ids: ["doc-1"] } };
  const r = validateDecision(sinClave);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === "traces.rules_fired"));
});

test("una Decision sin el objeto traces es invalida", () => {
  const sinTrazas = { ...decisionValida() } as Partial<Decision>;
  delete sinTrazas.traces;
  const r = validateDecision(sinTrazas);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === "traces"));
});

test("urgencia con reglas deterministas es invalida: escalateNow no invoca la determinista", () => {
  const r = validateDecision(
    decisionValida({
      reason_code: "urgencia",
      context_complete: false,
      traces: { doc_ids: [], rules_fired: ["CO-02"] },
    }),
  );
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === "traces.rules_fired"));
});

test("contexto incompleto con escalate false es invalido: el modo de fallo no puede ser el silencio", () => {
  const r = validateDecision(
    decisionValida({ escalate: false, context_complete: false, reason_code: "evaluado" }),
  );
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === "incoherencia" && i.path === "escalate"));
});

test("el campo se llama escalate: `alert` se rechaza con nombre propio", () => {
  const conAlert = { ...decisionValida(), alert: true };
  const r = validateDecision(conAlert);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === "alert" && i.code === "campo_prohibido"));
});

// ---------------------------------------------------------------------------
// Y lo que esta capa construye no puede salir mal formado
// ---------------------------------------------------------------------------

test("el constructor de degradacion no deja emitir una Decision invalida", () => {
  assert.throws(
    () => decisionPorDegradacion({ reason_code: "falla_tecnica", motivo: "   " }),
    /reason/,
    "una razon en blanco tiene que explotar donde se construye, no tres capas mas adelante",
  );
});

test("no existe forma de pedir una degradacion que no alerte", () => {
  // La invariante vive en el cuerpo del constructor y no en el llamador, para que no
  // haya ningun sitio donde se pueda olvidar.
  const d = decisionPorDegradacion({
    reason_code: "incongruencia",
    motivo: "El paciente niega fiebre y reporta 39 grados en el mismo turno.",
    criticality: "amarillo",
  });
  assert.equal(d.escalate, true);
  assert.equal(d.context_complete, false);
  assert.deepEqual(validateDecision(d).issues, []);
});
