/**
 * WO-25 — contratos y tipos de la costura decision <-> determinista.
 *
 * El modulo NO redefine nada: importa `UnitResult`, `DeterministicRequest`,
 * `DeterministicReport` y `DeterministicPort` del modulo compartido. Dos esquemas
 * para el mismo objeto se desincronizan, y esa es justo la falla que el proyecto
 * quiere evitar — por eso aqui no hay definiciones, hay comprobaciones de que lo
 * que este paquete produce SATISFACE el esquema de alla.
 *
 * ============ La prueba negativa, y por que esta version es mas fuerte ============
 *
 * El modulo de contratos ya prueba que el TIPO no admite `alert`, `score`, `risk`,
 * `severity`, `recommendation` ni `diagnosis`. Esta prueba cubre lo otro: que
 * ningun reporte REALMENTE PRODUCIDO por el motor los contenga, recorriendo el
 * objeto entero en profundidad. Un tipo se puede eludir con un `as`; un objeto que
 * sale del motor, no.
 *
 * =================================================================================
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPOS_PROHIBIDOS_ADR_007,
  validateDeterministicReport,
  type DeterministicPort,
  type DeterministicReport,
} from "@techsphere/contracts";
import { MotorDeterminista } from "../src/index.ts";
import { dominioReal, peticion, semilla, sinNormalizar, unidad } from "./fixtures/ayudas.ts";

// ---------------------------------------------------------------------------
// El puerto, tal como esta declarado
// ---------------------------------------------------------------------------

test("MotorDeterminista satisface DeterministicPort sin adaptadores", () => {
  const puerto: DeterministicPort = new MotorDeterminista(semilla());
  assert.equal(typeof puerto.evaluate, "function");
  assert.equal(typeof puerto.describeDomain, "function");
});

test("evaluate es SINCRONA: no devuelve Promise, y eso es normativo", () => {
  const motor = new MotorDeterminista(semilla());
  const salida = motor.evaluate(peticion([unidad("u_alfa", 7)], "semilla-pruebas-0.1.0"));

  assert.equal(salida instanceof Promise, false);
  assert.equal(typeof (salida as unknown as { then?: unknown }).then, "undefined");
  // Un puerto asincrono invitaria a meterle red dentro. La aritmetica no espera a nadie.
});

// ---------------------------------------------------------------------------
// Prueba negativa — ADR-006 y ADR-007, sobre la salida real
// ---------------------------------------------------------------------------

function rutasProhibidas(valor: unknown, ruta = ""): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => rutasProhibidas(v, `${ruta}[${i}]`));
  if (typeof valor !== "object" || valor === null) return [];
  const encontradas: string[] = [];
  for (const [clave, v] of Object.entries(valor)) {
    const hijo = ruta === "" ? clave : `${ruta}.${clave}`;
    if ((CAMPOS_PROHIBIDOS_ADR_007 as readonly string[]).includes(clave)) encontradas.push(hijo);
    encontradas.push(...rutasProhibidas(v, hijo));
  }
  return encontradas;
}

test("ningun reporte producido por el motor contiene campos de decision, score ni diagnostico", () => {
  const motor = new MotorDeterminista(dominioReal());
  const casos = [
    [],
    [unidad("fiebre", 39.1), unidad("apetito", "muy_disminuido"), unidad("sueno", "muy_alterado")],
    [unidad("aspecto_herida", "secrecion_purulenta"), unidad("dolor_intensidad", 8)],
    [unidad("fiebre", "treinta y ocho"), sinNormalizar("apetito")],
  ];

  for (const units of casos) {
    const reporte = motor.evaluate(peticion(units, "postop-0.1.0", { dia_postop: 7 }));
    assert.deepEqual(
      rutasProhibidas(reporte),
      [],
      "la ausencia de alert/score/risk/severity/recommendation/diagnosis es NORMATIVA (ADR-006, ADR-007): " +
        "el modulo entrega evidencia ponderable y quien la convierte en voto es el decisor",
    );
  }
});

test("todo reporte producido pasa el validador de esquema del modulo compartido", () => {
  const motor = new MotorDeterminista(dominioReal());
  const reporte: DeterministicReport = motor.evaluate(
    peticion(
      [
        unidad("fiebre", 38.4),
        unidad("apetito", "muy_disminuido"),
        unidad("sueno", "muy_alterado"),
        unidad("aspecto_herida", "eritema_leve"),
        sinNormalizar("movilidad"),
      ],
      "postop-0.1.0",
      { dia_postop: 14 },
    ),
  );

  const res = validateDeterministicReport(reporte);
  assert.deepEqual(
    res.issues,
    [],
    "el reporte tiene que validar contra el esquema que el decisor consume, no contra uno propio",
  );
});

// ---------------------------------------------------------------------------
// Validacion de esquema a la entrada — nunca `undefined` silencioso
// ---------------------------------------------------------------------------

test("una unidad con extraction fuera del enumerado se rechaza con mensaje accionable", () => {
  const motor = new MotorDeterminista(semilla());
  const rota = { ...unidad("u_alfa", 7), extraction: "medio_cubierta" } as never;

  assert.throws(
    () => motor.evaluate(peticion([rota], "semilla-pruebas-0.1.0")),
    (e: Error) => {
      assert.match(e.message, /extraction/);
      assert.match(e.message, /cubierta/);
      return true;
    },
  );
});

test("una peticion sin domain_version se rechaza antes de calcular nada", () => {
  const motor = new MotorDeterminista(semilla());
  const sinVersion = { ...peticion([unidad("u_alfa", 7)], "semilla-pruebas-0.1.0"), domain_version: "" };

  assert.throws(
    () => motor.evaluate(sinVersion),
    (e: Error) => {
      assert.match(e.message, /domain_version/);
      return true;
    },
  );
});

test("un modificador con estructura anidada se rechaza: eso es una unidad, no un modificador", () => {
  const motor = new MotorDeterminista(semilla());
  const req = peticion([unidad("u_alfa", 7)], "semilla-pruebas-0.1.0", {
    m_fase: { anidado: true } as never,
  });

  assert.throws(() => motor.evaluate(req), /modifiers\.m_fase/);
});
