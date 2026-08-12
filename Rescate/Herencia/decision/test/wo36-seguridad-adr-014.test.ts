/**
 * WO-36 — la prueba de regresion que hay que fijar ANTES de que el andamio desaparezca.
 *
 * ================== Por que ahora y no despues ==================
 *
 * Un marco cuyas unidades llegan `hidratada_sin_normalizar` produce SIEMPRE
 * `contexto_incompleto` con `escalate: true`. Eso verifica estructuralmente la
 * propiedad de seguridad de ADR-014 —a la falla, actua humano— CON INDEPENDENCIA DE
 * LA CALIDAD DE LA EXTRACCION, que es justo lo que ningun test posterior podra
 * aislar tan limpio: cuando la conversacional extraiga de verdad, este caso dejara
 * de ser el 100 % de las corridas y habra que fabricarlo a mano.
 *
 * Es una garantia que hoy se tiene gratis y que mañana costaria construir.
 *
 * ================================================================
 *
 * La prueba se escribe como PROPIEDAD, no como caso: se recorren combinaciones de
 * `state`, `confidence`, `raw` y `coverage_met` y se exige la misma conclusion en
 * todas. Un solo ejemplo probaria que el camino funciona; lo que interesa es que no
 * exista NINGUNA combinacion de calidad de extraccion que abra un camino al silencio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDecision, type UnitResult } from "@techsphere/contracts";
import {
  decisionPorContextoIncompleto,
  decisionPorDegradacion,
  hayQueReabrir,
  leerMarco,
} from "../src/index.ts";
import { marco, unidadCubierta, unidadSinNormalizar } from "./fixtures/ayudas.ts";

const REQUERIDAS = ["fiebre", "dolor_intensidad", "aspecto_herida"];

// ---------------------------------------------------------------------------
// La propiedad, sobre todas las variaciones de calidad de extraccion
// ---------------------------------------------------------------------------

test("un marco sin normalizar NUNCA produce silencio, sea cual sea la calidad de la extraccion", () => {
  const estados = [-3, -1, 0, 2, 3];
  const confianzas = [0, 0.2, 0.5, 0.9, 1];
  const literales: Array<string | null> = [null, "", "pues ahi vamos", "38 y algo, creo"];
  const coberturas: UnitResult["coverage_met"][] = [
    [],
    ["value"],
    ["value", "onset", "trend", "magnitude"],
  ];

  let combinaciones = 0;
  const m = marco();

  for (const state of estados) {
    for (const confidence of confianzas) {
      for (const raw of literales) {
        for (const coverage_met of coberturas) {
          const units = REQUERIDAS.map((id) =>
            unidadSinNormalizar(id, { state, confidence, raw, coverage_met, state_trace: [state] }),
          );

          const lectura = leerMarco(m, units);
          assert.equal(lectura.completo, false);
          assert.equal(hayQueReabrir(lectura), true);
          assert.deepEqual(
            lectura.reabribles.map((f) => f.unit_id).sort(),
            [...REQUERIDAS].sort(),
            "las tres required faltan, y el frame_delta tiene que poder nombrarlas una a una",
          );

          const decision = decisionPorContextoIncompleto(lectura, 2);
          assert.equal(decision.escalate, true);
          assert.equal(decision.reason_code, "contexto_incompleto");
          assert.equal(decision.context_complete, false);
          assert.deepEqual(validateDecision(decision).issues, []);

          combinaciones++;
        }
      }
    }
  }

  assert.equal(combinaciones, 300, "la propiedad se ejercita sobre 300 combinaciones, no sobre un caso");
});

test("basta UNA required sin normalizar entre otras perfectas para que no haya silencio", () => {
  const m = marco();
  for (const rota of REQUERIDAS) {
    const units = REQUERIDAS.map((id) =>
      id === rota ? unidadSinNormalizar(id) : unidadCubierta(id),
    );
    const lectura = leerMarco(m, units);

    assert.equal(lectura.completo, false, `con "${rota}" sin normalizar el contexto no esta completo`);
    assert.deepEqual(lectura.reabribles.map((f) => f.unit_id), [rota]);
    assert.equal(decisionPorContextoIncompleto(lectura, 1).escalate, true);
  }
});

test("la razon NOMBRA la unidad que faltaba: el frame_delta es consecuencia del estado, no inferencia", () => {
  const lectura = leerMarco(marco(), [
    unidadCubierta("fiebre"),
    unidadCubierta("dolor_intensidad"),
    unidadSinNormalizar("aspecto_herida", { raw: "esta rarita la herida" }),
  ]);
  const decision = decisionPorContextoIncompleto(lectura, 2);

  assert.match(decision.reason, /aspecto_herida/);
  assert.match(decision.reason, /esta rarita la herida/, "el literal del paciente viaja (ADR-004)");
  assert.ok(
    !decision.say_to_patient.includes("aspecto_herida"),
    "el reason tecnico NO se verbaliza tal cual: la capa entrega sustancia, la voz es de la conversacional",
  );
});

// ---------------------------------------------------------------------------
// Las otras formas de no tener el dato
// ---------------------------------------------------------------------------

test("una unidad ausente del marco hidratado cuenta como falta, no como cubierta", () => {
  const lectura = leerMarco(marco(), [unidadCubierta("fiebre"), unidadCubierta("dolor_intensidad")]);
  assert.deepEqual(lectura.reabribles.map((f) => f.motivo), ["ausente"]);
  assert.equal(lectura.completo, false);
});

test("una required suspendida cierra el bucle pero NO completa el contexto", () => {
  // Insistir sobre un `no_sabe` limpio no produce el dato: produce una conversacion
  // peor. Pero cerrada no es cubierta, y el contexto sigue sin estar completo.
  const lectura = leerMarco(marco(), [
    unidadCubierta("fiebre"),
    unidadCubierta("dolor_intensidad"),
    unidadSinNormalizar("aspecto_herida", {
      extraction: "suspendida",
      cause: "no_sabe",
      closure: "declarado",
    }),
  ]);

  assert.equal(hayQueReabrir(lectura), false, "no se reabre: ya se cerro con causa");
  assert.equal(lectura.completo, false, "y aun asi no hay silencio posible");
  assert.deepEqual(lectura.irrecuperables.map((f) => f.motivo), ["suspendida_sin_valor"]);
  assert.equal(decisionPorContextoIncompleto(lectura, 1).escalate, true);
});

test("una required con valor pero sin las dimensiones declaradas se reabre", () => {
  const lectura = leerMarco(marco(), [
    unidadCubierta("fiebre", { coverage_met: ["value"] }), // el marco pide value + onset
    unidadCubierta("dolor_intensidad"),
    unidadCubierta("aspecto_herida"),
  ]);
  assert.deepEqual(lectura.reabribles.map((f) => f.motivo), ["cobertura_incompleta"]);
  assert.match(lectura.reabribles[0]!.detalle, /onset/);
});

// ---------------------------------------------------------------------------
// Lo que el predicado NO puede hacer (ADR-022)
// ---------------------------------------------------------------------------

test("con todas las required cubiertas el predicado calla: no declara suficiencia", async () => {
  const lectura = leerMarco(marco(), REQUERIDAS.map((id) => unidadCubierta(id)));

  assert.equal(hayQueReabrir(lectura), false);
  assert.equal(lectura.completo, true);
  // Y `completo` es completitud ESTRUCTURAL, no suficiencia clinica.
  //
  // La guarda mira la superficie del MODULO DEL PREDICADO, no la del paquete: en el
  // paquete hay nombres legitimos que contienen la palabra —`coberturaSuficiente`
  // habla de cobertura, no de suficiencia global— y un barrido de subcadena sobre
  // todo el indice produce falsos positivos que acaban ablandando la guarda. Lo que
  // no puede existir es aqui: el atajo va solo hacia `need_more`, jamas hacia
  // `sufficient` (ADR-022).
  const predicado = await import("../src/seguridad/completitud.ts");
  assert.equal(
    Object.keys(predicado).filter((n) => /suficien|sufficien/i.test(n)).length,
    0,
    "un predicado que pudiera cerrar el bucle seria una regla estructural decidiendo un asunto clinico",
  );
  assert.ok(Object.keys(predicado).includes("hayQueReabrir"), "el unico atajo declarado va hacia need_more");
});

test("las desired y opportunistic no bloquean: una opportunistic NUNCA se pregunta", () => {
  const lectura = leerMarco(marco(), REQUERIDAS.map((id) => unidadCubierta(id)));
  assert.equal(lectura.completo, true, "apetito (desired) y sueno (opportunistic) no faltan");
});

test("una cubierta_condicionada no es falta del predicado: es juicio del modelo", () => {
  const lectura = leerMarco(marco(), [
    unidadCubierta("fiebre"),
    unidadCubierta("dolor_intensidad"),
    unidadCubierta("aspecto_herida", {
      extraction: "cubierta_condicionada",
      blocked_by: ["fiebre"],
    }),
  ]);
  assert.equal(hayQueReabrir(lectura), false);
  assert.deepEqual(lectura.condicionadas, ["aspecto_herida"]);
});

// ---------------------------------------------------------------------------
// Las cuatro ramas de ADR-014 producen Decision valida, siempre
// ---------------------------------------------------------------------------

test("las cuatro ramas de degradacion alertan y validan contra el contrato", () => {
  const ramas = ["contexto_incompleto", "incongruencia", "falla_tecnica", "urgencia"] as const;
  for (const reason_code of ramas) {
    const d = decisionPorDegradacion({ reason_code, motivo: `Rama ${reason_code} ejercitada.` });
    assert.equal(d.escalate, true, `la rama ${reason_code} tiene que alertar`);
    assert.equal(d.context_complete, false);
    assert.notEqual(d.reason.trim(), "");
    assert.deepEqual(validateDecision(d).issues, []);
  }
});

test("degradar con criticality verde es valido y esperado: fallamos nosotros, no el paciente", () => {
  const d = decisionPorDegradacion({
    reason_code: "falla_tecnica",
    motivo: "El decisor no respondio en 30 000 ms.",
  });
  assert.equal(d.criticality, "verde");
  assert.equal(d.escalate, true);
  assert.deepEqual(validateDecision(d).issues, []);
});
