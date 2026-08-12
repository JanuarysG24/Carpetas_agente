/**
 * WO-28 — colapso clasificatorio y clase de fallback. El nucleo.
 *
 * Tres propiedades y ninguna es cosmetica: la DEDUPLICACION (el colapso es un
 * conjunto, no una lista), el CIERRE TOTAL (todo valor sin mapeo cae al fallback y
 * nada lanza) y la CARDINALIDAD como señal de primer orden — patron puro admite
 * explicacion unica, la coexistencia obliga a considerar mecanismos concurrentes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MotorDeterminista } from "../src/index.ts";
import { dominioReal, peticion, semilla, unidad } from "./fixtures/ayudas.ts";

const real = () => new MotorDeterminista(dominioReal());
const sem = () => new MotorDeterminista(semilla());
const V = "postop-0.1.0";
const S = "semilla-pruebas-0.1.0";

// ---------------------------------------------------------------------------
// Colapso y cardinalidad
// ---------------------------------------------------------------------------

test("cardinalidad 0 -> sin_hallazgo: todo dentro de lo esperado no es un hallazgo", () => {
  const r = real().evaluate(
    peticion(
      [
        unidad("fiebre", 36.8),
        unidad("dolor_intensidad", 1),
        unidad("movilidad", "limitada_esperada"),
        unidad("aspecto_herida", "normal"),
        unidad("apetito", "normal"),
        unidad("sueno", "normal"),
      ],
      V,
      { dia_postop: 1 },
    ),
  );

  assert.equal(r.funcionalidad.cardinalidad, 0);
  assert.equal(r.funcionalidad.lectura, "sin_hallazgo");
  assert.deepEqual(r.funcionalidad.clases, []);
  assert.equal(
    r.coverage.evaluadas.length,
    6,
    "las seis se evaluaron: 'no hay hallazgo' no es lo mismo que 'no se miro'",
  );
});

test("cardinalidad 1 -> patron_unico; cardinalidad 2 -> coexistencia", () => {
  const uno = real().evaluate(peticion([unidad("fiebre", 38.4)], V));
  assert.equal(uno.funcionalidad.cardinalidad, 1);
  assert.equal(uno.funcionalidad.lectura, "patron_unico");

  const dos = real().evaluate(
    peticion([unidad("fiebre", 38.4), unidad("dolor_intensidad", 7)], V),
  );
  assert.equal(dos.funcionalidad.cardinalidad, 2);
  assert.equal(dos.funcionalidad.lectura, "coexistencia");
});

test("DEDUPLICACION: dos unidades en la misma clase cuentan UNA vez en la cardinalidad", () => {
  const r = sem().evaluate(peticion([unidad("u_alfa", 8), unidad("u_beta", "b_alto")], S));

  assert.equal(r.funcionalidad.cardinalidad, 1, "el colapso es un conjunto: la multiplicidad se pierde a proposito");
  assert.equal(r.funcionalidad.lectura, "patron_unico");
  assert.deepEqual(
    r.funcionalidad.clases.map((c) => c.rule_id).sort(),
    ["SM-ALF-01", "SM-BET-01"],
    "una entrada por REGLA activada: fundirlas obligaria a elegir cual de los dos rule_id citar, " +
      "y la trazabilidad termino a termino es la razon de existir de esta capa",
  );
  assert.deepEqual(new Set(r.funcionalidad.clases.map((c) => c.clase)), new Set(["c_alfa"]));
});

// ---------------------------------------------------------------------------
// Cierre total
// ---------------------------------------------------------------------------

test("un valor fuera del dominio NO lanza: cae al fallback y eleva fallback_rate", () => {
  const r = real().evaluate(
    peticion([unidad("aspecto_herida", "verde_fosforescente"), unidad("fiebre", 36.9)], V),
  );

  const hit = r.funcionalidad.clases.find((c) => c.fallback);
  assert.ok(hit, "el valor imprevisto tiene que aparecer, no desaparecer");
  assert.equal(hit.clase, "no_clasificable");
  assert.deepEqual(hit.origen_unit_ids, ["aspecto_herida"]);
  assert.deepEqual(hit.origen_valores, ["verde_fosforescente"]);
  assert.equal(r.quality.fallback_rate, 0.5, "1 de 2 valores elegibles cayo al fallback");
  assert.ok(r.quality.warnings.some((w) => w.includes("verde_fosforescente")));
});

test("una unidad que el dominio no conoce NO cae al fallback: es error de cableado (D5)", () => {
  const r = real().evaluate(peticion([unidad("nausea", "mucha"), unidad("fiebre", 38.4)], V));

  assert.deepEqual(r.funcionalidad.clases.filter((c) => c.fallback), []);
  assert.equal(
    r.quality.fallback_rate,
    0,
    "fallback_rate mide si la taxonomia cubre los VALORES que reporta la gente; un unit_id mal escrito " +
      "la haria ver incompleta cuando lo que esta mal es el cable",
  );
  const ausente = r.coverage.no_evaluadas.find((n) => n.unit_id === "nausea");
  assert.equal(ausente?.causa, "unidad_desconocida");
  assert.ok(r.quality.warnings.some((w) => w.includes("error de cableado")));
  assert.equal(r.coverage.evaluadas.length + r.coverage.no_evaluadas.length, 2, "conservacion intacta");
});

test("una magnitud que llega en texto cae al fallback: aqui no se coacciona nada", () => {
  const r = real().evaluate(peticion([unidad("fiebre", "38.5")], V));

  assert.equal(
    r.funcionalidad.clases[0]?.fallback,
    true,
    "coaccionar '38.5' a 38.5 seria interpretar, y este modulo no interpreta. El fallback_rate " +
      "deja ver que la extraccion esta entregando magnitudes en texto, que es informacion util",
  );
});

test("un fallback_rate de 0 con unidades evaluadas significa taxonomia suficiente, no ausencia de datos", () => {
  const r = real().evaluate(peticion([unidad("apetito", "muy_disminuido")], V));
  assert.equal(r.quality.fallback_rate, 0);
  assert.equal(r.coverage.evaluadas.length, 1);
});

// ---------------------------------------------------------------------------
// Cortes, orden y trazas
// ---------------------------------------------------------------------------

test("los cortes se evaluan en orden y gana el primero que aplica", () => {
  const justo = real().evaluate(peticion([unidad("fiebre", 37.9)], V));
  assert.equal(justo.funcionalidad.clases[0]?.clase, "respuesta_sistemica");
  assert.equal(justo.funcionalidad.clases[0]?.rule_id, "FC-FIE-01");

  const debajo = real().evaluate(peticion([unidad("fiebre", 37.8)], V));
  assert.equal(
    debajo.funcionalidad.cardinalidad,
    0,
    "37.8 cae en sin_compromiso, que no tiene eje y por tanto no es hallazgo; el corte de la " +
      "derivacion esta en 37.9 y no en 38.0 porque en 38.0 se pierde uno de los doce",
  );
});

test("toda clase del resultado deja su entrada de traza reconstruible hasta el valor", () => {
  const r = real().evaluate(peticion([unidad("dolor_intensidad", 8)], V));
  const entrada = r.trace.find((t) => t.rule_id === "FC-DOL-01");

  assert.ok(entrada);
  assert.equal(entrada.clase, "funcionalidad_local_alterada");
  assert.deepEqual(entrada.origen_unit_ids, ["dolor_intensidad"]);
  assert.deepEqual(entrada.origen_valores, [8]);
});

// ---------------------------------------------------------------------------
// Modificadores transversales — condicionan que reglas aplican, NO el colapso
// ---------------------------------------------------------------------------

test("una regla condicionada por modificador aplica solo en su tramo", () => {
  const tardio = sem().evaluate(peticion([unidad("u_gamma", "g_presente")], S, { m_fase: 4 }));
  assert.equal(tardio.funcionalidad.clases[0]?.clase, "c_gamma");

  const temprano = sem().evaluate(peticion([unidad("u_gamma", "g_presente")], S, { m_fase: 1 }));
  assert.equal(
    temprano.funcionalidad.clases[0]?.fallback,
    true,
    "en el tramo temprano la regla no aplica y el valor queda sin mapeo: cae al fallback, no a una " +
      "clase distinta. El modificador condiciona QUE reglas aplican, no cambia el colapso del resto",
  );
});

test("un modificador no declarado se ignora y se avisa; no altera el resultado", () => {
  const conRuido = sem().evaluate(
    peticion([unidad("u_alfa", 9)], S, { m_fase: 3, inventado: "x" }),
  );
  const sinRuido = sem().evaluate(peticion([unidad("u_alfa", 9)], S, { m_fase: 3 }));

  assert.deepEqual(conRuido.funcionalidad, sinRuido.funcionalidad);
  assert.ok(conRuido.quality.warnings.some((w) => w.includes("inventado")));
});

test("un modificador declarado que no llega se avisa: ninguna regla condicionada por el aplica", () => {
  const r = sem().evaluate(peticion([unidad("u_gamma", "g_presente")], S));
  assert.ok(r.quality.warnings.some((w) => w.includes("m_fase") && w.includes("no recibido")));
});
