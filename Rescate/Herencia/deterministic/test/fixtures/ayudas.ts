/**
 * Utilidades compartidas por las pruebas. Nada de logica de dominio aqui: solo
 * construir entradas bien formadas para no repetir catorce campos en cada test.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeterministicRequest, UnitResult } from "@techsphere/contracts";
import { cargarDominio, cargarDominioDesdeArchivo, type Dominio } from "../../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

export const RUTA_SEMILLA = resolve(AQUI, "dominio-semilla-pruebas.json");
export const RUTA_DOMINIO_REAL = resolve(AQUI, "../../../docs/dominio/dominio-postop-v0.1.json");
export const RUTA_TRAYECTORIAS = resolve(AQUI, "trayectorias-160.json");

export function semilla(): Dominio {
  return cargarDominioDesdeArchivo(RUTA_SEMILLA);
}

export function dominioReal(): Dominio {
  return cargarDominioDesdeArchivo(RUTA_DOMINIO_REAL);
}

export function crudoSemilla(): Record<string, unknown> {
  return JSON.parse(readFileSync(RUTA_SEMILLA, "utf8")) as Record<string, unknown>;
}

/** Carga un dominio manipulado en memoria. Para las pruebas de validacion. */
export function cargarCrudo(crudo: unknown): Dominio {
  return cargarDominio(crudo, "checksum-de-prueba");
}

export interface Trayectoria {
  trayectoria_id: string;
  paciente_id: string;
  dia_postop: number;
  arquetipo_trayectoria: string;
  dolor_nrs: number;
  fiebre_c: number;
  movilidad: string;
  herida: string;
  apetito: string;
  sueno: string;
  label_ground_truth: "verde" | "amarillo" | "rojo";
}

export function trayectorias(): Trayectoria[] {
  const archivo = JSON.parse(readFileSync(RUTA_TRAYECTORIAS, "utf8")) as { casos: Trayectoria[] };
  return archivo.casos;
}

/**
 * Una unidad `cubierta` con valores de extraccion deliberadamente MEDIOCRES:
 * `state` bajo y `confidence` baja entran igual al calculo, y que el default de
 * las pruebas sea ese es intencional — si alguna vez el modulo empezara a filtrar
 * por calidad, media bateria se caeria de golpe.
 */
export function unidad(
  id: string,
  normalized: string | number | boolean | null,
  extra: Partial<UnitResult> = {},
): UnitResult {
  return {
    id,
    extraction: "cubierta",
    state: -3,
    state_trace: [0, -1, -2, -3],
    raw: `literal de ${id}`,
    normalized,
    confidence: 0.2,
    coverage_met: ["value"],
    turn_refs: [1],
    ...extra,
  };
}

export function suspendida(id: string, cause: NonNullable<UnitResult["cause"]>): UnitResult {
  // Sin `closure`: el contrato exige que cierre y causa sean coherentes entre si
  // (§10.2), y esa tabla es de la conversacional. Aqui interesa la causa, que es lo
  // unico que este modulo hereda.
  return unidad(id, null, { extraction: "suspendida", cause, raw: null });
}

export function sinNormalizar(id: string): UnitResult {
  return unidad(id, null, { extraction: "hidratada_sin_normalizar" });
}

export function peticion(
  units: UnitResult[],
  domain_version: string,
  modifiers: DeterministicRequest["modifiers"] = {},
): DeterministicRequest {
  return {
    session_id: "ses-prueba",
    frame_id: "frame-prueba-0",
    units,
    modifiers,
    domain_version,
  };
}

/** Las seis unidades del dominio real, con los nombres de columna del dataset ya mapeados. */
export function unidadesDeTrayectoria(t: Trayectoria): UnitResult[] {
  return [
    unidad("fiebre", t.fiebre_c),
    unidad("dolor_intensidad", t.dolor_nrs),
    unidad("movilidad", t.movilidad),
    unidad("aspecto_herida", t.herida),
    unidad("apetito", t.apetito),
    unidad("sueno", t.sueno),
  ];
}
