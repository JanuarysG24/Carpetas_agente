/**
 * Eje de INTEGRIDAD SISTEMICA — lo que se afirma DEL CASO COMPLETO (spec §6.4).
 *
 * ================== Que es una "estructura" en este dominio ==================
 *
 * El `StructureHit` pide un nodo del arbol taxonomico. El arbol que este dominio
 * declara es `eje → unidades`, asi que los nodos estructurales son los tres ejes de
 * ADR-006, y una estructura esta comprometida cuando alguna de sus unidades colapso
 * a una clase de ese eje.
 *
 * No se toma la unidad como nodo, y es deliberado: un `StructureHit` por unidad
 * repetiria uno a uno los hallazgos de `funcionalidad.clases` y el eje de integridad
 * no diria nada nuevo. El nodo tiene que ser mas grueso que el hallazgo para que la
 * afirmacion sea del CASO y no de la parte. Es exactamente la lectura de la
 * derivacion: apetito y sueño no son sintomas locales — cuando ceden a la vez, lo
 * que cedio no es una parte, es el organismo sosteniendo el cuadro.
 *
 * La clase de fallback NO contribuye. Un valor que la taxonomia no supo mapear no
 * afirma compromiso estructural de nada: afirma que el dominio esta incompleto, y
 * eso ya viaja en `quality.fallback_rate`. Contarlo aqui convertiria una laguna del
 * modulo en un hallazgo sobre el paciente, que es la peor confusion posible.
 *
 * =============================================================================
 */

import type { ClassHit, CompositionHit, StructureHit } from "@techsphere/contracts";
import { EJES_DOMINIO, type Dominio, type EjeDominio } from "./dominio.ts";

export function evaluarIntegridad(
  hits: readonly ClassHit[],
  composiciones: readonly CompositionHit[],
  dominio: Dominio,
): StructureHit[] {
  const porEje = new Map<EjeDominio, { clases: Set<string>; unidades: Set<string> }>();

  // Las clases compuestas cuentan como contribuyentes, con el eje que el catalogo
  // les declara. `integridad_comprometida` es literalmente la afirmacion de que el
  // organismo cedio en mas de una funcion a la vez, y omitirla dejaria la estructura
  // sostenida solo por sus partes.
  //
  // OJO CON EL CASO QUE NO SALE GRATIS. En `integridad` las unidades de la compuesta
  // (apetito, sueño) ya estaban en el Set por sus partes, asi que el resultado no
  // cambia y la decision no se nota. En `interaccion` SI se nota:
  // `convergencia_sistemica` declara ese eje y arrastra `["apetito","fiebre","sueno"]`,
  // mientras que el dominio pone una sola unidad ahi, `fiebre`. La union CRUZA LA
  // FRONTERA DEL EJE, y es deliberado: `origen_unit_ids` es PROCEDENCIA de la
  // evidencia, no pertenencia (spec §6.4, hallazgo D10). Recortar a `fiebre` dejaria
  // la afirmacion citando una evidencia que no basta para producirla.
  // Fijado en `wo30-reporte.test.ts`; la pertenencia declarada vive en `dominio.ejes`.
  const contribuyentes: Array<{ clase: string; unidades: readonly string[] }> = [
    ...hits.map((h) => ({ clase: h.clase, unidades: h.origen_unit_ids })),
    ...composiciones.map((c) => ({ clase: c.clase_producida, unidades: c.origen_unit_ids })),
  ];

  for (const hit of contribuyentes) {
    const declarada = dominio.clases.get(hit.clase);
    if (!declarada || declarada.eje === null) continue;
    let acumulado = porEje.get(declarada.eje);
    if (!acumulado) {
      acumulado = { clases: new Set(), unidades: new Set() };
      porEje.set(declarada.eje, acumulado);
    }
    acumulado.clases.add(hit.clase);
    for (const u of hit.unidades) acumulado.unidades.add(u);
  }

  return EJES_DOMINIO.filter((eje) => porEje.has(eje)).map((eje) => {
    const acumulado = porEje.get(eje)!;
    return {
      rule_id: `ST-${eje}`,
      estructura: eje,
      clases_contribuyentes: [...acumulado.clases].sort(),
      origen_unit_ids: [...acumulado.unidades].sort(),
    };
  });
}
