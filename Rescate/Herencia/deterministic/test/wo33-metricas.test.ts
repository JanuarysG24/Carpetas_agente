/**
 * WO-33 — metricas del modulo.
 *
 * Dos cosas que hay que decir explicitamente y no por omision:
 *
 *   TOKENS Y COSTO NO APLICAN. Este modulo no invoca ningun modelo. Si la seccion
 *   apareciera vacia, se leeria como un dato que falta en vez de como una propiedad
 *   del diseño, y es justo al reves: la ausencia ES el argumento.
 *
 *   TODO PORCENTAJE VA CON SU DENOMINADOR (hallazgo B3). Un reparto sin decir sobre
 *   que total esta calculado casi cuesta una compuerta una vez; no se repite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { DeterministaMedido, MotorDeterminista } from "../src/index.ts";
import { dominioReal, peticion, sinNormalizar, unidad } from "./fixtures/ayudas.ts";

const V = "postop-0.1.0";

function medido(): DeterministaMedido {
  return new DeterministaMedido(new MotorDeterminista(dominioReal()));
}

test("el decorador mide sin cambiar el reporte ni el puerto", () => {
  const desnudo = new MotorDeterminista(dominioReal());
  const conMetricas = medido();
  const req = peticion([unidad("fiebre", 38.5), unidad("apetito", "muy_disminuido")], V);

  assert.equal(JSON.stringify(conMetricas.evaluate(req)), JSON.stringify(desnudo.evaluate(req)));
  assert.deepEqual(conMetricas.describeDomain(), desnudo.describeDomain());
});

test("la latencia se mide por invocacion y es de orden milisegundos", () => {
  const motor = medido();
  for (let i = 0; i < 20; i++) {
    motor.evaluate(peticion([unidad("fiebre", 38.5), unidad("sueno", "muy_alterado")], V));
  }

  const agregado = motor.agregado();
  assert.equal(agregado.n_invocaciones, 20, "el denominador viaja siempre");
  assert.ok(agregado.latencia_ms.media >= 0);
  assert.ok(
    agregado.latencia_ms.p50 < 50,
    `p50 = ${agregado.latencia_ms.p50} ms. El contraste con los ~12,5 s de una sola llamada de ` +
      `suficiencia al modelo es el argumento de la arquitectura de dos votos, y por eso se mide`,
  );
});

test("tokens y costo se declaran explicitamente como no aplicables", () => {
  const agregado = medido().agregado();

  assert.equal(agregado.tokens, null);
  assert.equal(agregado.costo, null);
  assert.match(agregado.nota, /no invoca ningun modelo/);
});

test("fallback_rate y coverage_ratio se agregan con su version de dominio", () => {
  const motor = medido();
  motor.evaluate(peticion([unidad("aspecto_herida", "valor_imprevisto")], V));
  motor.evaluate(peticion([unidad("fiebre", 37.0), sinNormalizar("apetito")], V));

  const agregado = motor.agregado();
  assert.equal(agregado.domain_version, V, "las series solo son comparables dentro de la misma version");
  assert.equal(agregado.fallback_rate.max, 1);
  assert.equal(agregado.coverage_ratio.min, 0.5);
  assert.equal(agregado.n_invocaciones, 2);
});

test("cada muestra dice cuantas unidades entraron y cuantas no: el reparto lleva denominador", () => {
  const motor = medido();
  motor.evaluate(
    peticion([unidad("fiebre", 38.2), sinNormalizar("apetito"), sinNormalizar("sueno")], V),
  );

  const muestra = motor.desglose()[0]!;
  assert.equal(muestra.unidades_evaluadas, 1);
  assert.equal(muestra.unidades_no_evaluadas, 2);
  assert.equal(muestra.coverage_ratio, 1 / 3);
  assert.equal(muestra.domain_version, V);
  assert.ok(muestra.reglas_disparadas >= 1);
});
