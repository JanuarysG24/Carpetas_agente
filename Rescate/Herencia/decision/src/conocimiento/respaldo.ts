/**
 * Sobre que unidades NO hubo respaldo documental.
 *
 * ============ Es el espejo de `coverage.no_evaluadas` ============
 *
 * La determinista declara que no pudo mirar; esto declara sobre que no se pudo
 * citar. La simetria no es estetica: sin ella, un `doc_ids` corto es indistinguible
 * de una recuperacion que fue bien, y aparece el incentivo de citar cualquier cosa
 * con tal de que la traza no se vea vacia — que es exactamente lo que el piso de
 * relevancia del indice se niega a hacer.
 *
 * Un sistema que declara sobre que no pudo citar es mas fuerte que uno que cita
 * cualquier cosa.
 *
 * ==================================================================
 */

import type { RetrievedChunk } from "@techsphere/contracts";

export interface HuecoDeEvidencia {
  unit_id: string;
  motivo: string;
}

export interface ConsultaPorUnidad {
  unit_id: string;
  /** Lo que devolvio `retrieve` para esa unidad. Vacio si nada supero el piso. */
  resultados: readonly RetrievedChunk[];
  /** `false` cuando la unidad ni siquiera se consulto (no estaba en el marco, o fallo el indice). */
  consultada?: boolean;
}

/**
 * Destila los huecos a partir de lo que de verdad devolvio el indice. No infiere ni
 * adivina: si una unidad se consulto y no volvio nada por encima del piso, eso es un
 * hecho del sistema y se declara con esas palabras.
 */
export function huecosDeEvidencia(consultas: readonly ConsultaPorUnidad[]): HuecoDeEvidencia[] {
  const huecos: HuecoDeEvidencia[] = [];
  for (const c of consultas) {
    if (c.consultada === false) {
      huecos.push({
        unit_id: c.unit_id,
        motivo: "no se consulto al indice para esta unidad",
      });
      continue;
    }
    if (c.resultados.length === 0) {
      huecos.push({
        unit_id: c.unit_id,
        motivo: "sin fragmentos por encima del piso de relevancia; el corpus no sostiene una cita para esta unidad",
      });
    }
  }
  return huecos;
}
