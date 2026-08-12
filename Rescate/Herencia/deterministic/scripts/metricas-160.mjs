/**
 * WO-33 — arnes de metricas. Corre las 160 trayectorias por el motor y escribe el
 * JSON que alimenta el README de metricas del reto (RF-13).
 *
 *   node scripts/metricas-160.mjs
 *
 * No es parte del camino evaluable: mide, escribe y termina. La latencia se toma
 * DESDE FUERA con el decorador `DeterministaMedido`, para no meterle un reloj a la
 * funcion pura solo para poder demostrar que es pura.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cargarDominioDesdeArchivo, DeterministaMedido, MotorDeterminista } from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_DOMINIO = resolve(AQUI, "../../docs/dominio/dominio-postop-v0.1.json");
const RUTA_CASOS = resolve(AQUI, "../test/fixtures/trayectorias-160.json");
const SALIDA = resolve(AQUI, "../salidas/metricas-determinista.json");

const dominio = cargarDominioDesdeArchivo(RUTA_DOMINIO);
const motor = new DeterministaMedido(new MotorDeterminista(dominio));
const { casos } = JSON.parse(readFileSync(RUTA_CASOS, "utf8"));

const unidad = (id, normalized) => ({
  id,
  extraction: "cubierta",
  state: 3,
  state_trace: [0, 3],
  raw: null,
  normalized,
  confidence: 1,
  coverage_met: ["value"],
  turn_refs: [1],
});

let co02 = 0;
let rojos = 0;
let aciertos = 0;

for (const c of casos) {
  const reporte = motor.evaluate({
    session_id: `ses-${c.paciente_id}`,
    frame_id: c.trayectoria_id,
    units: [
      unidad("fiebre", c.fiebre_c),
      unidad("dolor_intensidad", c.dolor_nrs),
      unidad("movilidad", c.movilidad),
      unidad("aspecto_herida", c.herida),
      unidad("apetito", c.apetito),
      unidad("sueno", c.sueno),
    ],
    modifiers: { dia_postop: c.dia_postop },
    domain_version: dominio.version,
  });

  const disparo = reporte.trace.some((t) => t.rule_id === "CO-02");
  if (disparo) co02 += 1;
  if (c.label_ground_truth === "rojo") rojos += 1;
  if (disparo === (c.label_ground_truth === "rojo")) aciertos += 1;
}

const agregado = motor.agregado();
const informe = {
  _declaracion:
    "Metricas del MODULO, no del paciente. Corrida sobre valores normalizados directos del dataset " +
    "sintetico del reto: mide el motor aislado de la extraccion. Sin validez clinica.",
  generado: new Date().toISOString(),
  ...agregado,
  reparto_del_denominador: {
    n_casos: casos.length,
    rojos_en_el_dataset: rojos,
    casos_con_CO_02: co02,
    coincidencias_CO_02_vs_etiqueta: aciertos,
  },
  desglose: motor.desglose(),
};

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(informe, null, 2) + "\n", "utf8");

console.log(`n=${agregado.n_invocaciones} invocaciones sobre ${dominio.version}`);
console.log(`latencia  media ${agregado.latencia_ms.media.toFixed(3)} ms · p50 ${agregado.latencia_ms.p50.toFixed(3)} ms · max ${agregado.latencia_ms.max.toFixed(3)} ms`);
console.log(`fallback  media ${agregado.fallback_rate.media.toFixed(3)} · max ${agregado.fallback_rate.max.toFixed(3)}`);
console.log(`cobertura media ${agregado.coverage_ratio.media.toFixed(3)} · min ${agregado.coverage_ratio.min.toFixed(3)}`);
console.log(`CO-02 disparo en ${co02} de ${casos.length}; rojos etiquetados: ${rojos}; coincidencias: ${aciertos}/${casos.length}`);
console.log(`tokens y costo: no aplican — este modulo no invoca ningun modelo`);
console.log(`-> ${SALIDA}`);
