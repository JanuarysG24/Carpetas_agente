/**
 * VERIFICACION SOBRE LOS 160 CASOS — el motor aislado de la extraccion.
 *
 * Se alimentan los valores de `trayectorias_postop_silver.xlsx` como entrada YA
 * NORMALIZADA, directamente: sin conversacional, sin modelo, sin extraccion. Lo que
 * se mide es si el motor reproduce la separacion que la derivacion encontro en el
 * dato — `CO-02` marcando exactamente los 12 rojos, sin falsos positivos ni negativos.
 *
 * ================== Por que esto SI se puede correr ==================
 *
 * El hallazgo H17 advierte de no correr los 160 casos con la conversacional en
 * andamio, porque el falso verde atrapa los 12 rojos y parece excelente. Esa
 * advertencia es sobre la TUBERIA COMPLETA. Aqui no hay tuberia: hay aritmetica
 * sobre valores normalizados que se le entregan al motor tal cual. Si el motor no
 * reproduce el resultado, el defecto es del motor y no del dominio.
 *
 * =====================================================================
 *
 * Y lo que este numero NO significa, que va al informe con estas palabras: es
 * calibracion sobre datos SINTETICOS. Una regla con cero error sobre 12 positivos
 * probablemente esta recuperando el generador del dataset, no una verdad clinica
 * (procedencia `inferred`, ADR-012). Ademas este resultado fija el TECHO: la regla
 * opera sobre normalizados, y un paciente minimizador que llama "calorcito" a 38,9
 * hace que la regla, siendo correcta, decida sobre un dato falso. La distancia
 * hasta el techo la marca la calidad de la extraccion, no esta capa.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDeterministicReport } from "@techsphere/contracts";
import { MotorDeterminista } from "../src/index.ts";
import { dominioReal, trayectorias, unidadesDeTrayectoria } from "./fixtures/ayudas.ts";

const V = "postop-0.1.0";

interface Fila {
  id: string;
  etiqueta: "verde" | "amarillo" | "rojo";
  co01: boolean;
  co02: boolean;
  estructuraDeclarada: boolean;
  fallbacks: number;
}

function correr(): Fila[] {
  const motor = new MotorDeterminista(dominioReal());
  return trayectorias().map((t) => {
    const reporte = motor.evaluate({
      session_id: `ses-${t.paciente_id}`,
      frame_id: t.trayectoria_id,
      units: unidadesDeTrayectoria(t),
      modifiers: { dia_postop: t.dia_postop },
      domain_version: V,
    });
    const reglas = new Set(reporte.trace.map((x) => x.rule_id));
    return {
      id: t.trayectoria_id,
      etiqueta: t.label_ground_truth,
      co01: reglas.has("CO-01"),
      co02: reglas.has("CO-02"),
      estructuraDeclarada: reporte.funcionalidad.clases.some((c) => c.clase === "estructura_declarada"),
      fallbacks: reporte.quality.fallback_rate,
    };
  });
}

test("el fixture trae los 160 casos con su etiqueta, y el reparto es el conocido", () => {
  const casos = trayectorias();
  assert.equal(casos.length, 160);

  const reparto = { verde: 0, amarillo: 0, rojo: 0 };
  for (const c of casos) reparto[c.label_ground_truth] += 1;
  assert.deepEqual(
    reparto,
    { verde: 123, amarillo: 25, rojo: 12 },
    "el denominador siempre viaja con el porcentaje (hallazgo B3)",
  );
});

test("CO-02 marca EXACTAMENTE los 12 rojos: 0 falsos positivos y 0 falsos negativos", () => {
  const filas = correr();

  const vp = filas.filter((f) => f.co02 && f.etiqueta === "rojo");
  const fp = filas.filter((f) => f.co02 && f.etiqueta !== "rojo");
  const fn = filas.filter((f) => !f.co02 && f.etiqueta === "rojo");

  assert.equal(vp.length, 12, `verdaderos positivos: ${vp.length}/12`);
  assert.equal(
    fp.length,
    0,
    `falsos positivos: ${fp.length} (${fp.map((f) => `${f.id}:${f.etiqueta}`).join(", ")})`,
  );
  assert.equal(fn.length, 0, `falsos negativos: ${fn.length} (${fn.map((f) => f.id).join(", ")})`);
});

test("el dominio cubre el dataset entero: fallback_rate 0 en los 160", () => {
  const filas = correr();
  const conFallback = filas.filter((f) => f.fallbacks > 0);

  assert.deepEqual(
    conFallback.map((f) => f.id),
    [],
    "un fallback aqui significaria que la funcion de clase no cubre un valor que el dataset produce",
  );
});

test("CO-01 sola no separa: es necesaria y no suficiente, y el dato lo dice", () => {
  const filas = correr();
  const conCO01 = filas.filter((f) => f.co01);
  const rojosConCO01 = conCO01.filter((f) => f.etiqueta === "rojo").length;
  const noRojosConCO01 = conCO01.length - rojosConCO01;

  assert.equal(rojosConCO01, 12, "la integridad comprometida esta en los 12 rojos");
  assert.ok(
    noRojosConCO01 > 0,
    "y tambien en no-rojos: por eso hace falta la composicion sobre ella, no basta con una parte. " +
      `Aqui arrastra ${noRojosConCO01} no-rojos`,
  );
});

test("el amarillo NO se separa, y esta bien que asi sea", () => {
  const filas = correr();
  const amarillos = filas.filter((f) => f.etiqueta === "amarillo");
  const amarillosMarcados = amarillos.filter((f) => f.co02).length;

  assert.equal(
    amarillosMarcados,
    0,
    "si el voto determinista resolviera tambien la zona ambigua, el voto probabilistico seria " +
      "redundante y ADR-013 perderia su fundamento. Que la aritmetica resuelva lo nitido y el modelo " +
      "opine sobre lo dudoso ES el diseño, no una limitacion",
  );
});

test("los 160 reportes validan contra el esquema del modulo compartido", () => {
  const motor = new MotorDeterminista(dominioReal());
  for (const t of trayectorias()) {
    const reporte = motor.evaluate({
      session_id: "ses",
      frame_id: t.trayectoria_id,
      units: unidadesDeTrayectoria(t),
      modifiers: { dia_postop: t.dia_postop },
      domain_version: V,
    });
    const res = validateDeterministicReport(reporte);
    assert.deepEqual(res.issues, [], `${t.trayectoria_id}: ${JSON.stringify(res.issues)}`);
  }
});

test("los 160 son reproducibles byte a byte en una segunda corrida", () => {
  const a = JSON.stringify(correr());
  const b = JSON.stringify(correr());
  assert.equal(a, b);
});
