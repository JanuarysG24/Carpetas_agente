/**
 * WO-27 — elegibilidad y cobertura (ADR-009).
 *
 * La invariante que gobierna el archivo entero: `evaluadas + no_evaluadas = total
 * recibido`. Ninguna unidad de la entrada desaparece del reporte. La no
 * evaluabilidad es un RESULTADO, no un hueco — porque para el decisor "se evaluo y
 * esta bien" y "no se pudo evaluar" son cosas distintisimas, y un reporte que solo
 * enumera hallazgos positivos las vuelve indistinguibles: silencio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MotorDeterminista } from "../src/index.ts";
import {
  dominioReal,
  peticion,
  sinNormalizar,
  suspendida,
  unidad,
} from "./fixtures/ayudas.ts";

const motor = () => new MotorDeterminista(dominioReal());
const V = "postop-0.1.0";

test("CONSERVACION: evaluadas + no_evaluadas = total recibido, siempre", () => {
  const casos = [
    [],
    [unidad("fiebre", 38.2)],
    [
      unidad("fiebre", 38.2),
      suspendida("apetito", "no_comprende"),
      sinNormalizar("sueno"),
      unidad("movilidad", "normal"),
      unidad("unidad_que_el_dominio_no_conoce", "loquesea"),
    ],
  ];

  for (const units of casos) {
    const r = motor().evaluate(peticion(units, V));
    assert.equal(
      r.coverage.evaluadas.length + r.coverage.no_evaluadas.length,
      units.length,
      "ADR-009: la no evaluabilidad es resultado, no hueco",
    );
    const vistos = [...r.coverage.evaluadas, ...r.coverage.no_evaluadas.map((n) => n.unit_id)].sort();
    assert.deepEqual(vistos, units.map((u) => u.id).sort());
  }
});

test("una unidad suspendida por no_comprende conserva ESA causa y declara los ejes que dejo ciegos", () => {
  const r = motor().evaluate(peticion([suspendida("apetito", "no_comprende"), unidad("fiebre", 37.0)], V));

  const ausente = r.coverage.no_evaluadas.find((n) => n.unit_id === "apetito");
  assert.ok(ausente);
  assert.equal(
    ausente.causa,
    "no_comprende",
    "la causa ES la informacion: un no_sabe y un no_comprende habilitan lecturas clinicas distintas, " +
      "y solo la conversacional pudo observarlas",
  );
  assert.deepEqual(
    ausente.eje_afectado,
    ["funcionalidad", "interaccion", "integridad"],
    "apetito informa integridad, su ausencia borra un hallazgo (funcionalidad) y ademas impide que " +
      "una composicion llegue a activarse (interaccion)",
  );
});

test("una unidad que no participa de ninguna composicion no deja ciego al eje de interaccion", () => {
  const r = motor().evaluate(peticion([suspendida("movilidad", "no_sabe"), unidad("fiebre", 37.0)], V));

  const ausente = r.coverage.no_evaluadas.find((n) => n.unit_id === "movilidad");
  assert.ok(ausente);
  assert.deepEqual(ausente.eje_afectado, ["funcionalidad"]);
});

test("hidratada_sin_normalizar entra a no_evaluadas con causa sin_normalizar", () => {
  const r = motor().evaluate(peticion([sinNormalizar("aspecto_herida")], V));

  assert.deepEqual(r.coverage.evaluadas, []);
  assert.equal(r.coverage.no_evaluadas[0]?.causa, "sin_normalizar");
  assert.equal(r.coverage.ratio, 0);
});

test("una unidad con state -3 y confidence 0.2 SI entra al calculo", () => {
  const r = motor().evaluate(
    peticion([unidad("fiebre", 38.5, { state: -3, confidence: 0.2 })], V),
  );

  assert.deepEqual(r.coverage.evaluadas, ["fiebre"]);
  assert.equal(
    r.funcionalidad.clases.some((c) => c.clase === "respuesta_sistemica"),
    true,
    "descartar por baja calidad de extraccion seria una decision clinica, y esa autoridad no es del modulo",
  );
});

test("cubierta_condicionada entra al calculo Y queda marcada con sus dependencias", () => {
  const r = motor().evaluate(
    peticion(
      [unidad("sueno", "muy_alterado", { extraction: "cubierta_condicionada", blocked_by: ["dolor_intensidad"] })],
      V,
    ),
  );

  assert.deepEqual(r.coverage.evaluadas, ["sueno"]);
  assert.deepEqual(r.quality.unidades_condicionadas, ["sueno"]);
  assert.ok(r.quality.warnings.some((w) => w.includes("dolor_intensidad")));
});

test("el ratio se deriva de las dos listas y vive en [0,1]", () => {
  const r = motor().evaluate(
    peticion([unidad("fiebre", 37.2), unidad("apetito", "normal"), suspendida("sueno", "rehusa")], V),
  );

  assert.equal(r.coverage.ratio, 2 / 3);
});

test("una unidad cubierta sin valor normalizado va a cobertura, no al fallback", () => {
  const r = motor().evaluate(peticion([unidad("fiebre", null)], V));

  assert.equal(
    r.quality.fallback_rate,
    0,
    "fallback_rate mide TAXONOMIA INCOMPLETA; contaminarlo con 'no llego valor' arruinaria la unica " +
      "metrica de mantenimiento del dominio",
  );
  assert.equal(r.coverage.no_evaluadas[0]?.causa, "sin_normalizar");
  assert.ok(r.quality.warnings.some((w) => w.includes("normalized es null")));
});

test("el orden de llegada de las unidades no altera la cobertura", () => {
  const units = [unidad("fiebre", 38.0), suspendida("apetito", "no_sabe"), unidad("sueno", "normal")];
  const a = motor().evaluate(peticion(units, V));
  const b = motor().evaluate(peticion([...units].reverse(), V));

  assert.deepEqual(a.coverage, b.coverage);
});
