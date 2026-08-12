import assert from "node:assert/strict";
import { test } from "node:test";

import type { EngineExtraction, UnitSpec } from "@techsphere/contracts";
import {
  aplicarCausa,
  aplicarExtraccion,
  cierreDeCausa,
  clamp,
  coberturaCompleta,
  elegirActo,
  unidadVacia,
} from "../src/motor-estados.ts";

function specDe(over: Partial<UnitSpec> = {}): UnitSpec {
  return {
    id: "fiebre",
    intent: "Saber si ha tenido fiebre.",
    priority: "required",
    type: "quantity",
    coverage: { requires: ["value", "onset"] },
    lexicon: { values: [], unit: "°C" },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// clamp / cierreDeCausa
// ---------------------------------------------------------------------------

test("clamp acota al rango [-3,3] del motor de estados", () => {
  assert.equal(clamp(10), 3);
  assert.equal(clamp(-10), -3);
  assert.equal(clamp(1), 1);
});

test("cierreDeCausa mapea cada causa a su cierre segun la tabla de contracts §10.2", () => {
  assert.equal(cierreDeCausa("no_sabe"), "declarado");
  assert.equal(cierreDeCausa("no_aplica"), "declarado");
  assert.equal(cierreDeCausa("rehusa"), "declarado");
  assert.equal(cierreDeCausa("no_comprende"), "degradacion");
  assert.equal(cierreDeCausa("incoherente"), "degradacion");
  assert.equal(cierreDeCausa("sin_respuesta"), "degradacion");
  assert.equal(cierreDeCausa("interrumpido"), "corte");
  assert.equal(cierreDeCausa("bloqueado_por_urgencia"), "corte");
});

// ---------------------------------------------------------------------------
// aplicarExtraccion
// ---------------------------------------------------------------------------

test("una extraccion completa y confiada cierra la unidad como cubierta, con state +1", () => {
  const unidad = unidadVacia(specDe());
  const ext: EngineExtraction = {
    unit_id: "fiebre",
    raw: "38.9 desde ayer",
    normalized: 38.9,
    confidence: 0.9,
    coverage_met: ["value", "onset"],
  };
  const r = aplicarExtraccion(unidad, ext, 1, 0.5);
  assert.equal(r.extraction, "cubierta");
  assert.equal(r.closure, "declarado");
  assert.equal(r.normalized, 38.9);
  assert.equal(r.raw, "38.9 desde ayer");
  assert.equal(r.state, 1);
  assert.deepEqual(r.coverage_met.sort(), ["onset", "value"]);
});

test("ADR-024: normalized null NUNCA se convierte en un valor inventado, y no cierra la unidad", () => {
  const unidad = unidadVacia(specDe());
  const ext: EngineExtraction = {
    unit_id: "fiebre",
    raw: "un calorcito",
    normalized: null,
    confidence: 0.9,
    coverage_met: [],
  };
  const r = aplicarExtraccion(unidad, ext, 1, 0.5);
  assert.equal(r.normalized, null);
  assert.equal(r.raw, "un calorcito");
  assert.notEqual(r.extraction, "cubierta");
  assert.equal(r.state, 0, "tocar sin cuantificar no es un fracaso: no degrada el estado");
});

test("cobertura parcial no cierra la unidad: queda hidratada_sin_normalizar", () => {
  const unidad = unidadVacia(specDe());
  const ext: EngineExtraction = {
    unit_id: "fiebre",
    raw: "38.9",
    normalized: 38.9,
    confidence: 0.9,
    coverage_met: ["value"], // falta "onset"
  };
  const r = aplicarExtraccion(unidad, ext, 1, 0.5);
  assert.equal(r.extraction, "hidratada_sin_normalizar");
  assert.equal(coberturaCompleta(r.spec, r.coverage_met), false);
});

test("confianza por debajo del umbral de reflejo no cierra aunque la cobertura este completa", () => {
  const unidad = unidadVacia(specDe());
  const ext: EngineExtraction = {
    unit_id: "fiebre",
    raw: "como treinta y ocho y algo",
    normalized: 38,
    confidence: 0.3,
    coverage_met: ["value", "onset"],
  };
  const r = aplicarExtraccion(unidad, ext, 1, 0.5);
  assert.notEqual(r.extraction, "cubierta");
});

test("una unidad con depends_on abiertos cierra cubierta_condicionada, no cubierta", () => {
  const unidad = unidadVacia(specDe({ depends_on: ["otra"] }));
  const ext: EngineExtraction = {
    unit_id: "fiebre",
    raw: "38.9 desde ayer",
    normalized: 38.9,
    confidence: 0.9,
    coverage_met: ["value", "onset"],
  };
  const r = aplicarExtraccion(unidad, ext, 1, 0.5);
  assert.equal(r.extraction, "cubierta_condicionada");
  assert.equal(r.closure, undefined);
});

// ---------------------------------------------------------------------------
// aplicarCausa
// ---------------------------------------------------------------------------

test('"no_sabe" cierra DECLARADO de inmediato y sube el estado: es una respuesta sana, no un fracaso', () => {
  const unidad = unidadVacia(specDe());
  const r = aplicarCausa(unidad, "no_sabe", 1, 1);
  assert.equal(r.extraction, "suspendida");
  assert.equal(r.closure, "declarado");
  assert.equal(r.cause, "no_sabe");
  assert.equal(r.state, 1);
});

test('"no_comprende" da una segunda oportunidad antes de rendirse', () => {
  let unidad = unidadVacia(specDe());
  unidad = aplicarCausa(unidad, "no_comprende", 1, 1);
  assert.notEqual(unidad.extraction, "suspendida", "el primer no_comprende no cierra la unidad");
  assert.equal(unidad.state, -1);

  unidad = aplicarCausa(unidad, "no_comprende", 2, 1);
  assert.equal(unidad.extraction, "suspendida");
  assert.equal(unidad.closure, "degradacion");
  assert.equal(unidad.state, -3, "un cierre por degradacion es un estado en -3 (comentario del validador de contracts)");
});

// ---------------------------------------------------------------------------
// elegirActo
// ---------------------------------------------------------------------------

test("elegirActo prioriza required sobre desired y nunca pregunta una opportunistic", () => {
  const req = unidadVacia(specDe({ id: "dolor", priority: "required" }));
  const des = unidadVacia(specDe({ id: "sueno", priority: "desired" }));
  const opp = unidadVacia(specDe({ id: "apetito", priority: "opportunistic" }));
  const unidades = new Map([
    ["apetito", opp],
    ["sueno", des],
    ["dolor", req],
  ]);
  const orden = ["apetito", "sueno", "dolor"];
  const acto = elegirActo(unidades, orden, false, false, null);
  assert.equal(acto?.act, "continuar");
  assert.equal(acto?.unit_id, "dolor");
});

test("una bandera roja corta el guion normal: el acto pasa a suspender", () => {
  const req = unidadVacia(specDe({ id: "dolor", priority: "required" }));
  const unidades = new Map([["dolor", req]]);
  const acto = elegirActo(unidades, ["dolor"], true, false, null);
  assert.equal(acto?.act, "suspender");
});

test("una unidad tocada sin cuantificar dispara reflejar antes que seguir con otra", () => {
  const spec = specDe({ id: "fiebre" });
  let unidad = unidadVacia(spec);
  unidad = aplicarExtraccion(unidad, { unit_id: "fiebre", raw: "un calorcito", normalized: null, confidence: 0.9, coverage_met: [] }, 1, 0.5);
  const unidades = new Map([["fiebre", unidad]]);
  const acto = elegirActo(unidades, ["fiebre"], false, false, "fiebre");
  assert.equal(acto?.act, "reflejar");
  assert.equal(acto?.unit_id, "fiebre");
});

test("sin nada pendiente, elegirActo devuelve null (fase F5)", () => {
  const spec = specDe();
  let unidad = unidadVacia(spec);
  unidad = aplicarExtraccion(
    unidad,
    { unit_id: "fiebre", raw: "38.9 desde ayer", normalized: 38.9, confidence: 0.9, coverage_met: ["value", "onset"] },
    1,
    0.5,
  );
  const unidades = new Map([["fiebre", unidad]]);
  const acto = elegirActo(unidades, ["fiebre"], false, false, "fiebre");
  assert.equal(acto, null);
});
