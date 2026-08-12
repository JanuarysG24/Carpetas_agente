/**
 * WO-37 — una llamada que muere en la verificacion de identidad sigue debiendo
 * un `CallSummary`.
 *
 * Es ADR-016 y es el borde que nadie prueba. Si el orquestador cortara antes de
 * crear sesion no habria resumen, y una llamada que no dejo rastro es
 * indistinguible de una llamada que nunca ocurrio.
 *
 * No es un caso de error: es un desenlace, y de los que mas le importan a quien
 * opera el sistema. Alguien contesto ese telefono y no pudo demostrar quien era.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateCallSummary, validateDecision, validateSummaryDelivery } from "@techsphere/contracts";
import { cierrePorIdentidadNoVerificada, type VersionesVigentes } from "../src/index.ts";
import { REGISTROS } from "../src/pacientes/datos.ts";

const VERSIONES: VersionesVigentes = {
  domain_version: "postop-0.1.0",
  vd_version: "vd-tabla-0.1.0",
  embedding_model: "SIMULADO:tfidf-bolsa-de-palabras",
};

function cierre(detalle?: string) {
  return cierrePorIdentidadNoVerificada({
    session_id: "sesion-identidad-fallida-01",
    versions: VERSIONES,
    generated_at: "2026-08-08T15:04:05.000Z",
    ...(detalle === undefined ? {} : { detalle }),
  });
}

test("la llamada deja resumen, y el resumen valida contra el contrato", () => {
  const { summary } = cierre();
  assert.deepEqual(validateCallSummary(summary).issues, []);
  assert.equal(summary.session_id, "sesion-identidad-fallida-01");
});

test("escala, con su reason_code, y la decision valida", () => {
  const { decision } = cierre();
  assert.equal(decision.escalate, true);
  assert.equal(decision.reason_code, "contexto_incompleto");
  assert.equal(decision.context_complete, false);
  assert.deepEqual(validateDecision(decision).issues, []);
});

test("la cobertura va vacia, y eso es informacion: no es que no se hallara nada, es que no se pregunto", () => {
  const { summary } = cierre();
  assert.deepEqual(summary.findings, []);
  assert.equal(summary.frame.rounds, 0);
  assert.equal(summary.frame.context_complete, false);
  assert.deepEqual(summary.decision.traces, { doc_ids: [], rules_fired: [] });
});

test("la identidad queda declarada como unverified y sin referencia", () => {
  const { summary } = cierre();
  assert.equal(summary.identity_status, "unverified");
  assert.equal(summary.patient_ref, null, "nunca hubo referencia: no se identifico a nadie");
});

test("la razon esta NOMBRADA: dice que no hubo marco, ni unidades, ni determinista", () => {
  const { decision } = cierre();
  assert.match(decision.reason, /sin verificar la identidad/);
  assert.match(decision.reason, /No se genero marco/);
  assert.match(decision.reason, /no se invoco la determinista/);
});

test("el detalle opcional se incorpora sin abrir la puerta a divulgar", () => {
  const { decision } = cierre("Tres intentos: dos con fecha que no casa y uno con nombre incompleto.");
  assert.match(decision.reason, /Tres intentos/);

  // La razon es campo de auditoria y no puede volverse el sitio por donde se filtra
  // lo que verifyIdentity se nego a divulgar.
  const serializado = JSON.stringify(decision);
  for (const registro of REGISTROS) {
    assert.ok(!serializado.includes(registro.nombre));
    assert.ok(!serializado.includes(registro.verificadores.documento));
  }
});

test("el resumen llega a los dos destinos, porque escala", () => {
  const { summary, destinos } = cierre();
  assert.deepEqual(destinos, ["session_archive", "alert_channel"]);
  assert.deepEqual(validateSummaryDelivery(summary, destinos).issues, []);
  // El personal alertado no recibe un timbre: recibe el caso.
});

test("las versiones se declaran aunque no se haya consultado nada", () => {
  const { summary } = cierre();
  assert.deepEqual(summary.versions, VERSIONES);
  // Dicen bajo QUE estaba corriendo el sistema, no que consulto. Un resumen
  // autocontenido sin versiones no se puede reproducir un mes despues.
});

test("la rama es degradacion, no la tabla OR: aqui no hubo votos que ponderar", () => {
  const { summary } = cierre();
  assert.equal(summary.decision.branch, "degradacion");
  assert.equal(summary.decision.votes, undefined);
});

test("lo que se le dice al paciente no revela si estaba o no en la base", () => {
  const { decision } = cierre();
  assert.match(decision.say_to_patient, /no logre confirmar sus datos/i);
  for (const palabra of ["base de datos", "registro", "no existe", "no figura"]) {
    assert.ok(
      !decision.say_to_patient.toLowerCase().includes(palabra),
      `"${palabra}" convierte el cierre en el oraculo de pertenencia que verifyIdentity evita`,
    );
  }
});

test("el resumen es reproducible: mismos insumos, mismo resumen", () => {
  assert.deepEqual(cierre("mismo detalle"), cierre("mismo detalle"));
});
