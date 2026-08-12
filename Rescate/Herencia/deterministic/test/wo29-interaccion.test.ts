/**
 * WO-29 — convergencia de clase y composiciones. El eje de INTERACCION.
 *
 * Lo que se prueba aqui es el argumento entero de la capa determinista, y esta
 * medido: ninguna variable sola discrimina —dia >=7 arrastra 68 falsos positivos,
 * herida 30, dolor 20— pero su COMPOSICION separa limpio. Lo que importa no es el
 * hallazgo aislado sino la combinacion, y esa combinacion se declara en el dominio,
 * no se descubre en runtime (ADR-008: el Motor B descubre, el Motor A ejecuta).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MotorDeterminista } from "../src/index.ts";
import { dominioReal, peticion, semilla, suspendida, unidad } from "./fixtures/ayudas.ts";

const real = () => new MotorDeterminista(dominioReal());
const sem = () => new MotorDeterminista(semilla());
const V = "postop-0.1.0";
const S = "semilla-pruebas-0.1.0";

// ---------------------------------------------------------------------------
// Convergencia de clase (Motor A §5.2)
// ---------------------------------------------------------------------------

test("una clase presente en dos unidades es convergente; en una sola, no", () => {
  const dos = real().evaluate(
    peticion([unidad("apetito", "muy_disminuido"), unidad("sueno", "muy_alterado")], V),
  );
  const convergente = dos.interaccion.convergentes.find((c) => c.clase === "integridad_cedida");
  assert.ok(convergente, "integridad_cedida atraviesa apetito y sueño: eso es un patron compartido");
  assert.deepEqual(convergente.origen_unit_ids, ["apetito", "sueno"]);
  assert.equal(convergente.rule_id, "CV-integridad_cedida");

  const una = real().evaluate(peticion([unidad("apetito", "muy_disminuido"), unidad("fiebre", 36.9)], V));
  assert.deepEqual(
    una.interaccion.convergentes,
    [],
    "una clase local, propia de una sola unidad, no es un patron",
  );
});

test("con una sola unidad elegible NO se declara patron compartido", () => {
  const r = real().evaluate(peticion([unidad("apetito", "muy_disminuido")], V));

  assert.equal(
    r.interaccion.lectura,
    "hallazgos_independientes",
    "declarar convergencia sobre una sola instancia seria enunciar como patron lo que es un caso unico",
  );
  assert.deepEqual(r.interaccion.convergentes, []);
});

test("dos unidades sin clases comunes dan hallazgos_independientes, no vacio", () => {
  const r = real().evaluate(peticion([unidad("fiebre", 38.5), unidad("dolor_intensidad", 8)], V));

  assert.deepEqual(r.interaccion.convergentes, []);
  assert.deepEqual(r.interaccion.composiciones, []);
  assert.equal(
    r.interaccion.lectura,
    "hallazgos_independientes",
    "la ausencia de patron compartido se ENUNCIA afirmativamente; representarla por omision la haria " +
      "indistinguible de no haber mirado",
  );
});

test("sin ninguna clase, la lectura del eje es sin_hallazgo y no hallazgos_independientes", () => {
  const r = real().evaluate(peticion([unidad("fiebre", 36.5), unidad("apetito", "normal")], V));
  assert.equal(r.interaccion.lectura, "sin_hallazgo");
});

test("dos valores sin mapeo NO son un patron compartido: el fallback no converge", () => {
  const r = real().evaluate(
    peticion([unidad("apetito", "raro_uno"), unidad("sueno", "raro_dos")], V),
  );

  assert.deepEqual(
    r.interaccion.convergentes,
    [],
    "un no_clasificable compartido dice algo de la taxonomia, no del paciente, y ya se dice en fallback_rate",
  );
  assert.equal(r.quality.fallback_rate, 1);
});

// ---------------------------------------------------------------------------
// Composiciones (spec §7.4)
// ---------------------------------------------------------------------------

test("CO-01 se activa solo con el conjunto COMPLETO: apetito Y sueño cedidos", () => {
  const completo = real().evaluate(
    peticion([unidad("apetito", "muy_disminuido"), unidad("sueno", "muy_alterado")], V),
  );
  const hit = completo.interaccion.composiciones.find((c) => c.rule_id === "CO-01");
  assert.ok(hit);
  assert.equal(hit.clase_producida, "integridad_comprometida");
  assert.deepEqual(hit.origen_unit_ids, ["apetito", "sueno"]);

  const aMedias = real().evaluate(
    peticion([unidad("apetito", "muy_disminuido"), unidad("sueno", "levemente_alterado")], V),
  );
  assert.deepEqual(
    aMedias.interaccion.composiciones,
    [],
    "necesaria pero no suficiente: apetito solo esta en los 12 rojos y tambien en no-rojos",
  );
});

test("CO-02 encadena sobre la clase que produce CO-01, y su rule_id llega a la traza", () => {
  const r = real().evaluate(
    peticion(
      [
        unidad("apetito", "muy_disminuido"),
        unidad("sueno", "muy_alterado"),
        unidad("fiebre", 38.2),
      ],
      V,
      { dia_postop: 7 },
    ),
  );

  assert.deepEqual(
    r.interaccion.composiciones.map((c) => c.rule_id),
    ["CO-01", "CO-02"],
    "las composiciones se evaluan en orden de declaracion, en una sola pasada",
  );
  const co02 = r.interaccion.composiciones[1]!;
  assert.equal(co02.clase_producida, "convergencia_sistemica");
  assert.deepEqual(
    co02.origen_unit_ids,
    ["apetito", "fiebre", "sueno"],
    "el origen arrastra las unidades de la composicion anterior: la cadena es reconstruible entera",
  );
  assert.ok(r.trace.some((t) => t.rule_id === "CO-02" && t.clase === "convergencia_sistemica"));
  assert.equal(r.interaccion.lectura, "patron_compartido");
});

test("sin fiebre no hay convergencia sistemica: integridad cedida sola no basta", () => {
  const r = real().evaluate(
    peticion(
      [unidad("apetito", "muy_disminuido"), unidad("sueno", "muy_alterado"), unidad("fiebre", 37.4)],
      V,
      { dia_postop: 3 },
    ),
  );

  assert.deepEqual(r.interaccion.composiciones.map((c) => c.rule_id), ["CO-01"]);
  assert.equal(
    r.interaccion.composiciones.some((c) => c.rule_id === "CO-02"),
    false,
    "es el tramo ambiguo: los cinco complicacion_real amarillos estan aqui, y el VD no debe resolverlo",
  );
});

test("una unidad suspendida impide la composicion que dependia de ella, y la cobertura lo dice", () => {
  const r = real().evaluate(
    peticion(
      [unidad("apetito", "muy_disminuido"), suspendida("sueno", "rehusa"), unidad("fiebre", 38.6)],
      V,
    ),
  );

  assert.deepEqual(r.interaccion.composiciones, []);
  const ausente = r.coverage.no_evaluadas.find((n) => n.unit_id === "sueno");
  assert.ok(ausente?.eje_afectado.includes("interaccion"), "el eje de interaccion quedo ciego, y hay que decirlo");
});

test("la MISMA clase exigida dos veces se cubre con dos unidades DISTINTAS", () => {
  const dos = sem().evaluate(peticion([unidad("u_alfa", 9), unidad("u_beta", "b_alto")], S));
  assert.deepEqual(dos.interaccion.composiciones.map((c) => c.rule_id), ["SM-CO-01"]);

  const una = sem().evaluate(peticion([unidad("u_alfa", 9)], S));
  assert.deepEqual(
    una.interaccion.composiciones,
    [],
    "sin la exigencia de distincion, una regla de convergencia se convertiria en silencio en una de presencia",
  );
});

test("las unidades de origen admisibles restringen de donde salen las clases", () => {
  // c_alfa esta en u_alfa y u_beta; SM-CO-01 solo admite esas dos. Con u_alfa
  // repetida en clase pero cubierta por una sola unidad, la regla no se activa.
  const r = sem().evaluate(peticion([unidad("u_alfa", 9), unidad("u_delta", "d_cedido")], S));
  assert.deepEqual(r.interaccion.composiciones, []);
});

test("la cadena completa de la semilla: SM-CO-01 habilita SM-CO-02", () => {
  const r = sem().evaluate(
    peticion([unidad("u_alfa", 9), unidad("u_beta", "b_alto"), unidad("u_delta", "d_cedido")], S),
  );

  assert.deepEqual(r.interaccion.composiciones.map((c) => c.clase_producida), [
    "k_alfa_doble",
    "k_cierre",
  ]);
  assert.deepEqual(r.interaccion.composiciones[1]?.origen_unit_ids, ["u_alfa", "u_beta", "u_delta"]);
});

test("ninguna composicion lleva peso, score ni orden de gravedad: es Motor A puro", () => {
  const r = real().evaluate(
    peticion(
      [unidad("apetito", "muy_disminuido"), unidad("sueno", "muy_alterado"), unidad("fiebre", 39)],
      V,
    ),
  );

  for (const c of r.interaccion.composiciones) {
    assert.deepEqual(
      Object.keys(c).sort(),
      ["clase_producida", "clases_requeridas", "origen_unit_ids", "rule_id"],
      "una matriz de influencia ponderada seria Motor B: va en calibracion offline y en runtime " +
        "romperia la trazabilidad termino a termino (ADR-008)",
    );
  }
});
