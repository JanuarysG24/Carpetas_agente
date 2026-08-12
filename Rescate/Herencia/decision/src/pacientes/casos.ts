/**
 * VISTA DE CASO — exclusiva de la capa de decision, y su proyeccion hacia el marco.
 *
 * ============ Lo que cruza hacia el marco es una PROYECCION, no el caso ============
 *
 * El caso contiene material clinico: procedimiento, edad, comorbilidades. ADR-019 le
 * prohibe al entrevistador el contexto recuperado y ADR-020 le manda hablar del
 * PROCESO y no del CUADRO. Si el `PatientCase` entrara entero al `ContextFrame`, la
 * prohibicion de ADR-019 quedaria burlada por la puerta de al lado: el modelo no
 * veria el RAG, pero veria la historia del paciente, que es peor.
 *
 * Por eso la seleccion es una FUNCION DECLARADA aqui y no "lo que el orquestador
 * toma". La diferencia se ve el dia en que alguien añade un campo al caso: con la
 * proyeccion explicita, el campo nuevo no aparece en ningun sitio hasta que alguien
 * lo agregue a mano y explique por que; con la seleccion en el orquestador, el campo
 * entra al prompt sin que nadie lo decida.
 *
 * Al marco cruza exactamente esto y nada mas:
 *
 *   `patient_ref`  la referencia opaca
 *   `unit_ids`     que unidades hay que cubrir
 *   `dia_postop`   el modificador transversal que la determinista declara
 *
 * Nada de diagnostico, procedimiento ni antecedentes. Y `dia_postop` llega hasta la
 * determinista POR EL MARCO, no por el prompt.
 *
 * ==================================================================================
 */

import type {
  IdentityClaim,
  IdentityVerdict,
  PatientCase,
  PatientStorePort,
} from "@techsphere/contracts";
import { REGISTROS, type RegistroDePaciente } from "./datos.ts";

/**
 * Las seis unidades del dominio `postop-0.1.0`, no los nombres de columna del
 * dataset (`fiebre_c`, `dolor_nrs`, `herida`). Un id que no coincide con la funcion
 * de clase colapsaba al fallback EN SILENCIO (hallazgo D5).
 *
 * Estan aqui como constante y no leyendo el JSON del dominio para no arrastrar una
 * dependencia de runtime hacia la capa determinista en WO-37 — pero hay una prueba
 * que las contrasta contra `docs/dominio/dominio-postop-v0.1.json`: si el dominio
 * crece, la prueba falla y alguien decide, en vez de que la lista envejezca sola.
 *
 * QUE unidades aplican a QUE procedimiento es criterio clinico y es del director
 * (WO-41/WO-47). Hoy la proyeccion entrega las seis para todos, declarado.
 */
export const UNIDADES_DEL_DOMINIO: readonly string[] = [
  "fiebre",
  "dolor_intensidad",
  "movilidad",
  "aspecto_herida",
  "apetito",
  "sueno",
];

/**
 * Lo unico del caso que puede cruzar hacia el marco. Las claves son un conjunto
 * CERRADO: si esta forma crece, crece en un commit que dice por que.
 */
export interface ProyeccionParaMarco {
  patient_ref: string;
  unit_ids: readonly string[];
  /**
   * Dias transcurridos desde la cirugia. El dominio lo declara como modificador
   * transversal con valores [1, 3, 7, 14]; un valor fuera de esos pierde el tramo
   * con warning declarado y ninguna regla se altera — hoy ningun corte ni
   * composicion esta condicionado por el. Se emite el dia REAL: mapearlo al valor
   * declarado mas cercano seria decidir que un dia 5 es "temprano" o "tardio", y
   * eso es criterio clinico que esta capa no escribe.
   */
  dia_postop: number;
}

/** Dias completos entre la cirugia y el momento de la llamada. Aritmetica, no criterio. */
export function diasDesde(fecha_cirugia: string, ahora: Date): number {
  const cirugia = new Date(`${fecha_cirugia}T00:00:00Z`).getTime();
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  return Math.max(0, Math.round((hoy - cirugia) / 86_400_000));
}

/**
 * La proyeccion. Enumera campo a campo A PROPOSITO: nunca `...caso`, nunca un
 * `delete` sobre una copia. Una lista negra se queda corta el dia que el caso gana
 * un campo; una lista blanca no.
 */
export function proyectarParaMarco(
  caso: PatientCase,
  ahora: Date,
  unidades: readonly string[] = UNIDADES_DEL_DOMINIO,
): ProyeccionParaMarco {
  return {
    patient_ref: caso.patient_ref,
    unit_ids: [...unidades],
    dia_postop: diasDesde(caso.fecha_cirugia, ahora),
  };
}

/** Vista de CASO. Solo la consume la capa de decision; nunca cruza la costura. */
export class VistaDeCaso {
  private readonly porRef: Map<string, RegistroDePaciente>;

  constructor(registros: readonly RegistroDePaciente[] = REGISTROS) {
    this.porRef = new Map(registros.map((r) => [r.patient_ref, r]));
  }

  getCase(patient_ref: string): PatientCase {
    const registro = this.porRef.get(patient_ref);
    if (!registro) {
      // Una referencia que no resuelve es un fallo de plomeria, no un paciente
      // desconocido: `patient_ref` solo lo emite `verifyIdentity`. Se lanza para que
      // el orquestador degrade por ADR-014 en vez de seguir con un caso vacio.
      throw new Error(
        `patient_ref ${JSON.stringify(patient_ref)} no resuelve a ningun caso. ` +
          `Las referencias las emite verifyIdentity y son opacas: si esta llego de otro sitio, ` +
          `alguien construyo una referencia en vez de obtenerla.`,
      );
    }
    return registro.caso;
  }

  /** El unico camino autorizado del caso hacia el marco. */
  proyeccionParaMarco(patient_ref: string, ahora: Date): ProyeccionParaMarco {
    return proyectarParaMarco(this.getCase(patient_ref), ahora);
  }
}

/**
 * Composicion de las dos vistas para satisfacer `PatientStorePort`.
 *
 * Vive del lado PRIVILEGIADO —este archivo, que ya puede leer casos— y no del lado
 * de identidad: componer aqui no le da a nadie un acceso que no tuviera, mientras
 * que componer en `identidad.ts` obligaria a ese modulo a importar este y anularia
 * la separacion que WO-37 exige verificar por la superficie del paquete.
 */
export function componerAlmacen(
  identidad: { verifyIdentity(claim: IdentityClaim): IdentityVerdict },
  casos: VistaDeCaso,
): PatientStorePort {
  return {
    verifyIdentity: (claim) => identidad.verifyIdentity(claim),
    getCase: (patient_ref) => casos.getCase(patient_ref),
  };
}
