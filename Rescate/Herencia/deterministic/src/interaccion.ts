/**
 * WO-29 — el eje de INTERACCION: lo que solo existe ENTRE unidades.
 *
 * Dos operaciones distintas, y conviene no confundirlas:
 *
 *   CONVERGENCIA DE CLASE (Motor A §5.2) — una misma clase atraviesa varias
 *   unidades. Sale de la lectura por columna de la matriz unidades × clases, y el
 *   umbral se LEE DEL DOMINIO, no se codifica: un dominio puede exigir mas de dos.
 *
 *   COMPOSICION (Motor A §8, spec §7.4) — una combinacion DECLARADA de clases cuya
 *   presencia conjunta porta significado que ninguna parte tiene por separado. Es
 *   el mecanismo por el que este eje produce lectura sin Motor B en runtime.
 *
 * Nunca "convergencia" a secas: el proyecto tiene dos motores y el termino significa
 * cosas distintas en cada uno. La desambiguacion es deliberada.
 *
 * ================== Motor A puro, y por que importa ==================
 *
 * Las composiciones son reglas declaradas —clases requeridas → clase producida—
 * sin pesos y sin matriz de influencia. Una matriz ponderada seria Motor B, va en
 * calibracion OFFLINE y en runtime romperia la trazabilidad termino a termino
 * (ADR-008). El Motor B descubre; el Motor A ejecuta.
 *
 * =====================================================================
 */

import type { ClassHit, CompositionHit } from "@techsphere/contracts";
import type { Composicion, Dominio } from "./dominio.ts";
import { compararValores } from "./colapso.ts";
import type { ContextoDeModificadores } from "./colapso.ts";

export interface Interaccion {
  convergentes: ClassHit[];
  composiciones: CompositionHit[];
  warnings: string[];
}

export function evaluarInteraccion(
  clasesPorUnidad: Map<string, Set<string>>,
  valorPorUnidad: Map<string, string | number | boolean>,
  dominio: Dominio,
  ctx: ContextoDeModificadores,
): Interaccion {
  const warnings: string[] = [];
  const convergentes = clasesConvergentes(clasesPorUnidad, valorPorUnidad, dominio);
  const composiciones = activarComposiciones(clasesPorUnidad, dominio, ctx, warnings);
  return { convergentes, composiciones, warnings };
}

/**
 * Lectura por columna de la matriz de incidencia. Se excluyen las clases sin eje:
 * dos unidades "dentro de lo esperado" no son un patron compartido, y dos valores
 * que el dominio no supo mapear tampoco — un `no_clasificable` compartido dice algo
 * de la taxonomia, no del paciente, y ya se dice en `quality.fallback_rate`.
 */
function clasesConvergentes(
  clasesPorUnidad: Map<string, Set<string>>,
  valorPorUnidad: Map<string, string | number | boolean>,
  dominio: Dominio,
): ClassHit[] {
  const unidadesPorClase = new Map<string, string[]>();
  for (const unidad of [...clasesPorUnidad.keys()].sort()) {
    for (const clase of clasesPorUnidad.get(unidad)!) {
      const declarada = dominio.clases.get(clase);
      if (!declarada || declarada.eje === null) continue;
      const lista = unidadesPorClase.get(clase) ?? [];
      lista.push(unidad);
      unidadesPorClase.set(clase, lista);
    }
  }

  return [...unidadesPorClase.entries()]
    .filter(([, unidades]) => unidades.length >= dominio.umbralConvergencia)
    .map(([clase, unidades]) => ({
      rule_id: `CV-${clase}`,
      clase,
      origen_unit_ids: [...unidades].sort(),
      origen_valores: unidades
        .map((u) => valorPorUnidad.get(u))
        .filter((v): v is string | number | boolean => v !== undefined)
        .sort(compararValores),
      fallback: false,
    }))
    .sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
}

/**
 * Las composiciones se evaluan EN EL ORDEN DE DECLARACION, en una sola pasada.
 * Una puede exigir la clase que produjo otra anterior —la convergencia sistemica
 * se apoya en la integridad comprometida— y el cargador ya garantizo que ninguna
 * dependencia apunta hacia adelante. Sin ese orden habria que iterar hasta punto
 * fijo, y un motor con punto fijo deja de ser explicable termino a termino.
 */
function activarComposiciones(
  clasesPorUnidad: Map<string, Set<string>>,
  dominio: Dominio,
  ctx: ContextoDeModificadores,
  warnings: string[],
): CompositionHit[] {
  const activas = new Map<string, { rule_id: string; origen_unit_ids: string[] }>();
  const hits: CompositionHit[] = [];

  for (const comp of dominio.composiciones) {
    if (comp.modificador) {
      const vigente = ctx.tramoVigente.get(comp.modificador.id) ?? null;
      if (vigente !== comp.modificador.tramo) continue;
    }

    const compuestasExigidas = comp.clases_requeridas.filter((c) => dominio.clasesCompuestas.has(c));
    const baseExigidas = comp.clases_requeridas.filter((c) => !dominio.clasesCompuestas.has(c));

    const origenCompuesto: string[] = [];
    let faltaCompuesta = false;
    for (const c of compuestasExigidas) {
      const previa = activas.get(c);
      if (!previa) {
        faltaCompuesta = true;
        break;
      }
      origenCompuesto.push(...previa.origen_unit_ids);
    }
    if (faltaCompuesta) continue;

    const candidatas = (comp.unidades_requeridas ?? [...clasesPorUnidad.keys()]).slice().sort();
    const emparejadas = emparejar(baseExigidas, candidatas, clasesPorUnidad);
    if (!emparejadas) continue;

    const origen = [...new Set([...emparejadas, ...origenCompuesto])].sort();
    if (origen.length === 0) {
      warnings.push(`la composicion ${comp.rule_id} se activo sin unidades de origen y se descarta.`);
      continue;
    }

    hits.push({
      rule_id: comp.rule_id,
      clases_requeridas: [...comp.clases_requeridas],
      clase_producida: comp.clase_producida,
      origen_unit_ids: origen,
    });
    activas.set(comp.clase_producida, { rule_id: comp.rule_id, origen_unit_ids: origen });
  }

  return hits;
}

/**
 * Cada ocurrencia de una clase requerida se cubre con una unidad DISTINTA.
 *
 * Es lo que hace que "apetito y sueño en su clase maxima" signifique dos unidades
 * y no una contada dos veces. Sin la exigencia de distincion, una composicion que
 * pide la misma clase dos veces se activaria con una sola unidad, y una regla de
 * convergencia se habria convertido en silencio en una regla de presencia.
 */
function emparejar(
  requeridas: readonly string[],
  candidatas: readonly string[],
  clasesPorUnidad: Map<string, Set<string>>,
): string[] | null {
  const usadas = new Set<string>();
  const elegidas: string[] = [];

  const buscar = (i: number): boolean => {
    if (i === requeridas.length) return true;
    const clase = requeridas[i]!;
    for (const unidad of candidatas) {
      if (usadas.has(unidad)) continue;
      if (!clasesPorUnidad.get(unidad)?.has(clase)) continue;
      usadas.add(unidad);
      elegidas.push(unidad);
      if (buscar(i + 1)) return true;
      usadas.delete(unidad);
      elegidas.pop();
    }
    return false;
  };

  return buscar(0) ? elegidas : null;
}

/** Composiciones declaradas, para el manifiesto y las pruebas. */
export function nombresDeComposiciones(dominio: Dominio): Composicion["nombre"][] {
  return dominio.composiciones.map((c) => c.nombre);
}
