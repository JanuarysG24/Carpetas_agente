/**
 * WO-31 — ARNES DE PUREZA Y DETERMINISMO.
 *
 * Sin esta orden, "determinista" es una afirmacion y no un hecho. Las siete pruebas
 * de la orden, en el mismo orden en que estan escritas alli:
 *
 *   1. identidad          — misma peticion, mismo reporte, comparado por SERIALIZACION
 *   2. aislamiento        — ni red ni disco ni reloj ni azar dentro de `evaluate`
 *   3. ausencia de estado — dos invocaciones intercaladas no se contaminan
 *   4. orden de entrada   — permutar `units` no cambia el reporte
 *   5. cierre             — un valor fuera del dominio no lanza
 *   6. conservacion       — ninguna unidad de entrada desaparece (ADR-009)
 *   7. bateria del Motor A— clase pura, coexistencia, convergencia, ausencia de
 *                           convergencia y terminal no mapeado
 *
 * La comparacion por serializacion no es pereza: comparar campo a campo dejaria
 * pasar una diferencia en un campo que la prueba no mire, y el compromiso de esta
 * capa es "identico byte a byte", no "identico en lo que se me ocurrio revisar".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { MotorDeterminista } from "../src/index.ts";
import {
  dominioReal,
  peticion,
  semilla,
  sinNormalizar,
  suspendida,
  unidad,
} from "./fixtures/ayudas.ts";

const V = "postop-0.1.0";
const S = "semilla-pruebas-0.1.0";

const CASO_COMPLETO = () => [
  unidad("fiebre", 38.6),
  unidad("dolor_intensidad", 7),
  unidad("movilidad", "incapacitante_nueva"),
  unidad("aspecto_herida", "eritema_leve"),
  unidad("apetito", "muy_disminuido"),
  unidad("sueno", "muy_alterado"),
];

// ---------------------------------------------------------------------------
// 1 — identidad
// ---------------------------------------------------------------------------

test("1/7 identidad: la misma peticion dos veces produce el mismo reporte, byte a byte", () => {
  const motor = new MotorDeterminista(dominioReal());
  const req = peticion(CASO_COMPLETO(), V, { dia_postop: 7 });

  const a = JSON.stringify(motor.evaluate(req));
  const b = JSON.stringify(motor.evaluate(req));

  assert.equal(a, b);
});

test("1/7 bis: dos motores cargados por separado del mismo archivo coinciden", () => {
  const req = peticion(CASO_COMPLETO(), V, { dia_postop: 7 });
  const a = JSON.stringify(new MotorDeterminista(dominioReal()).evaluate(req));
  const b = JSON.stringify(new MotorDeterminista(dominioReal()).evaluate(req));

  assert.equal(a, b, "el reporte es funcion de (taxonomia, unidades, modificadores) y de nada mas");
});

// ---------------------------------------------------------------------------
// 2 — aislamiento
// ---------------------------------------------------------------------------

test("2/7 aislamiento: evaluate no toca red, ni disco, ni reloj, ni azar", () => {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs") as Record<string, unknown>;

  const motor = new MotorDeterminista(dominioReal()); // la carga SI toca disco, y va antes
  const req = peticion(CASO_COMPLETO(), V, { dia_postop: 7 });

  const violaciones: string[] = [];
  const espiar = <T extends object, K extends keyof T>(obj: T, clave: K, etiqueta: string): (() => void) => {
    const original = obj[clave];
    if (typeof original !== "function") return () => undefined;
    obj[clave] = ((...args: unknown[]) => {
      violaciones.push(etiqueta);
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as T[K];
    return () => {
      obj[clave] = original;
    };
  };

  const restaurar = [
    espiar(fs, "readFileSync", "fs.readFileSync"),
    espiar(fs, "readFile", "fs.readFile"),
    espiar(fs, "writeFileSync", "fs.writeFileSync"),
    espiar(fs, "openSync", "fs.openSync"),
    espiar(globalThis as unknown as Record<string, unknown>, "fetch", "fetch"),
    espiar(Math as unknown as Record<string, unknown>, "random", "Math.random"),
    espiar(Date as unknown as Record<string, unknown>, "now", "Date.now"),
  ];

  try {
    motor.evaluate(req);
    motor.describeDomain();
  } finally {
    for (const r of restaurar) r();
  }

  assert.deepEqual(
    violaciones,
    [],
    "un modulo determinista que consultara documentos, mirara el reloj o tirara un dado dejaria de ser " +
      "reproducible, que es la unica propiedad por la que existe (ADR-010, spec §9)",
  );
});

test("2/7 bis: el paquete no declara ninguna dependencia de red ni de modelo (compuerta G3)", async () => {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { dependencies: Record<string, string> };

  assert.deepEqual(
    Object.keys(pkg.dependencies),
    ["@techsphere/contracts"],
    "tokens y costo no aplican a esta capa porque no invoca ningun modelo, y la superficie auditable " +
      "tiene que hacerlo evidente de un vistazo",
  );
});

// ---------------------------------------------------------------------------
// 3 — ausencia de estado
// ---------------------------------------------------------------------------

test("3/7 ausencia de estado: invocaciones intercaladas dan lo mismo que por separado", () => {
  const motor = new MotorDeterminista(dominioReal());
  const rojo = peticion(CASO_COMPLETO(), V, { dia_postop: 14 });
  const verde = peticion([unidad("fiebre", 36.6), unidad("apetito", "normal")], V, { dia_postop: 1 });
  const raro = peticion([unidad("aspecto_herida", "algo_no_previsto")], V);

  const aislados = [rojo, verde, raro].map((r) => JSON.stringify(new MotorDeterminista(dominioReal()).evaluate(r)));

  const intercalados = [
    motor.evaluate(rojo),
    motor.evaluate(verde),
    motor.evaluate(raro),
    motor.evaluate(rojo),
    motor.evaluate(verde),
    motor.evaluate(raro),
  ].map((r) => JSON.stringify(r));

  assert.deepEqual(intercalados.slice(0, 3), aislados);
  assert.deepEqual(intercalados.slice(3), aislados);
});

test("3/7 bis: evaluate no muta la peticion que recibe", () => {
  const motor = new MotorDeterminista(dominioReal());
  const req = peticion(CASO_COMPLETO(), V, { dia_postop: 7 });
  const antes = JSON.stringify(req);

  motor.evaluate(req);

  assert.equal(JSON.stringify(req), antes, "quien llama conserva su objeto intacto: no hay efectos");
});

// ---------------------------------------------------------------------------
// 4 — orden de entrada
// ---------------------------------------------------------------------------

test("4/7 orden de entrada: permutar units no cambia el reporte", () => {
  const motor = new MotorDeterminista(dominioReal());
  const base = [...CASO_COMPLETO(), suspendida("nausea", "no_aplica"), sinNormalizar("animo")];
  const referencia = JSON.stringify(motor.evaluate(peticion(base, V, { dia_postop: 7 })));

  const permutaciones = [
    [...base].reverse(),
    [base[3]!, base[0]!, base[7]!, base[1]!, base[5]!, base[2]!, base[6]!, base[4]!],
    [...base].sort((a, b) => (a.id > b.id ? -1 : 1)),
  ];

  for (const p of permutaciones) {
    assert.equal(
      JSON.stringify(motor.evaluate(peticion(p, V, { dia_postop: 7 }))),
      referencia,
      "todas las listas del reporte se normalizan antes de salir; si dependieran del orden de llegada, " +
        "dos capturas de la misma conversacion producirian auditorias distintas",
    );
  }
});

test("4/7 bis: el orden de las claves de modifiers tampoco importa", () => {
  const motor = new MotorDeterminista(semilla());
  const a = motor.evaluate(peticion([unidad("u_gamma", "g_presente")], S, { m_fase: 3, otro: "x" }));
  const b = motor.evaluate(peticion([unidad("u_gamma", "g_presente")], S, { otro: "x", m_fase: 3 }));

  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// 5 — cierre
// ---------------------------------------------------------------------------

test("5/7 cierre: ningun valor normalizado provoca excepcion", () => {
  const motor = new MotorDeterminista(dominioReal());
  const rarezas: Array<string | number | boolean> = [
    "",
    "   ",
    "SECRECION_PURULENTA",
    "muy_disminuido ",
    -1,
    999,
    0,
    true,
    false,
    "😷",
    "__proto__",
    "constructor",
  ];

  for (const valor of rarezas) {
    const r = motor.evaluate(peticion([unidad("aspecto_herida", valor)], V));
    assert.equal(r.coverage.evaluadas.length, 1, `el valor ${JSON.stringify(valor)} desaparecio`);
    assert.equal(r.quality.fallback_rate, 1, `el valor ${JSON.stringify(valor)} no cayo al fallback`);
  }
});

// ---------------------------------------------------------------------------
// 6 — conservacion
// ---------------------------------------------------------------------------

test("6/7 conservacion: ninguna unidad de entrada desaparece del reporte", () => {
  const motor = new MotorDeterminista(dominioReal());
  const units = [
    ...CASO_COMPLETO(),
    suspendida("animo", "no_sabe"),
    suspendida("respiracion", "interrumpido"),
    sinNormalizar("hidratacion"),
    unidad("desconocida", "valor"),
  ];

  const r = motor.evaluate(peticion(units, V, { dia_postop: 7 }));

  assert.equal(r.coverage.evaluadas.length + r.coverage.no_evaluadas.length, units.length);
  assert.deepEqual(
    [...r.coverage.evaluadas, ...r.coverage.no_evaluadas.map((n) => n.unit_id)].sort(),
    units.map((u) => u.id).sort(),
  );
  for (const n of r.coverage.no_evaluadas) {
    assert.ok(n.causa.length > 0);
    assert.ok(n.eje_afectado.length > 0, "sin eje, el decisor no sabe que parte del reporte es incompleta");
  }
});

// ---------------------------------------------------------------------------
// 7 — bateria del Motor A (Guia §7)
// ---------------------------------------------------------------------------

test("7/7 bateria del Motor A sobre la semilla: los cinco casos del motor clasificatorio", () => {
  const motor = new MotorDeterminista(semilla());

  // (a) instancia de clase pura
  const pura = motor.evaluate(peticion([unidad("u_alfa", 9)], S));
  assert.equal(pura.funcionalidad.cardinalidad, 1);
  assert.equal(pura.funcionalidad.lectura, "patron_unico");

  // (b) coexistencia de mecanismos
  const coexistencia = motor.evaluate(
    peticion([unidad("u_alfa", 9), unidad("u_beta", "b_otro")], S),
  );
  assert.equal(coexistencia.funcionalidad.cardinalidad, 2);
  assert.equal(coexistencia.funcionalidad.lectura, "coexistencia");

  // (c) clase convergente
  const convergente = motor.evaluate(
    peticion([unidad("u_alfa", 9), unidad("u_beta", "b_alto")], S),
  );
  assert.deepEqual(convergente.interaccion.convergentes.map((c) => c.clase), ["c_alfa"]);
  assert.equal(convergente.interaccion.lectura, "patron_compartido");

  // (d) ausencia de convergencia, enunciada
  assert.equal(coexistencia.interaccion.lectura, "hallazgos_independientes");
  assert.deepEqual(coexistencia.interaccion.convergentes, []);

  // (e) terminal no mapeado: fallback, no excepcion
  const noMapeado = motor.evaluate(peticion([unidad("u_beta", "b_inexistente")], S));
  assert.equal(noMapeado.funcionalidad.clases[0]?.fallback, true);
  assert.equal(noMapeado.quality.fallback_rate, 1);
});
