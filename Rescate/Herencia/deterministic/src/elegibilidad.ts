/**
 * WO-27 — quien entra al calculo, y sobre todo quien NO entra y por que.
 *
 * ================== ADR-009: la no evaluabilidad es RESULTADO ==================
 *
 * Para el decisor hay una diferencia enorme entre "se evaluo la fiebre y esta bien"
 * y "no se pudo evaluar la fiebre". Si el reporte solo enumerara hallazgos positivos,
 * las dos situaciones se verian identicas: silencio. Un modulo que calla lo que no
 * pudo mirar induce falsos negativos por omision, que es el error mas caro del
 * sistema — porque la degradacion segura no puede dispararse sobre informacion que
 * nunca llego.
 *
 * De ahi la invariante que WO-27 exige probar: `evaluadas + no_evaluadas = total`.
 * Ninguna unidad de la entrada desaparece del reporte, nunca.
 *
 * ==============================================================================
 *
 * Dos reglas que NO son de este modulo aunque lo parezcan:
 *
 *   - `state` y `confidence` NO filtran. Una unidad extraida con dificultad
 *     (`state: -3`) o con mapeo dudoso (`confidence: 0.2`) entra IGUAL. Su calidad
 *     se reporta y el decisor la pondera; descartarla seria una decision clinica y
 *     esa autoridad no es de esta capa (spec §7.1).
 *   - Se consume `normalized`, JAMAS `raw`. El literal del paciente viaja para la
 *     traza y para el decisor, pero un motor determinista no interpreta lenguaje
 *     natural: es un limite declarado de la capa.
 */

import type { DeterministicAxis, DeterministicCoverage, UnitResult } from "@techsphere/contracts";
import type { Dominio } from "./dominio.ts";

/** Una unidad que SI entra al colapso, con su valor ya extraido de `normalized`. */
export interface UnidadElegible {
  id: string;
  valor: string | number | boolean;
  /** `true` si venia como `cubierta_condicionada`: entra, pero marcada. */
  condicionada: boolean;
}

export interface Elegibilidad {
  elegibles: UnidadElegible[];
  noEvaluadas: DeterministicCoverage["no_evaluadas"];
  /** Ids con `cubierta_condicionada` y dependencias abiertas -> `quality.unidades_condicionadas`. */
  condicionadas: string[];
  warnings: string[];
}

const ORDEN_DE_EJES: readonly DeterministicAxis[] = ["funcionalidad", "interaccion", "integridad"];

/**
 * Orden total y estable sobre las unidades de entrada.
 *
 * No es cosmetica: es lo que hace que permutar el arreglo `units` no cambie el
 * reporte (WO-31 paso 4). Se ordena por id y, ante ids repetidos, por una
 * serializacion estable del contenido — sin ese segundo criterio, dos unidades
 * con el mismo id harian que el resultado dependiera del orden de llegada.
 */
export function ordenarUnidades(units: readonly UnitResult[]): UnitResult[] {
  return [...units].sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

export function repartirPorElegibilidad(units: readonly UnitResult[], dominio: Dominio): Elegibilidad {
  const elegibles: UnidadElegible[] = [];
  const noEvaluadas: DeterministicCoverage["no_evaluadas"] = [];
  const condicionadas: string[] = [];
  const warnings: string[] = [];
  const vistas = new Set<string>();

  for (const u of ordenarUnidades(units)) {
    if (vistas.has(u.id)) {
      warnings.push(
        `unidad repetida en la entrada: ${u.id}. Se evalua cada ocurrencia; revisa el ensamblado del marco.`,
      );
    }
    vistas.add(u.id);

    // HALLAZGO D5 — una unidad que el dominio no reconoce es ERROR DE CABLEADO, no
    // hueco de dominio, y no debe colapsar al fallback en silencio. Va a cobertura
    // con causa propia: `fallback_rate` mide si la taxonomia cubre los VALORES que
    // reporta la gente, y un `unit_id` mal escrito la haria ver incompleta cuando lo
    // que esta mal es el cable. Conservacion intacta: la unidad sigue en el reporte.
    if (!dominio.unidadesCanonicas.has(u.id)) {
      warnings.push(
        `unit_id fuera del dominio ${dominio.version}: ${u.id}. Las unidades canonicas son ` +
          `[${[...dominio.unidadesCanonicas].sort().join(", ")}]. Es error de cableado, no hueco de dominio.`,
      );
      noEvaluadas.push({
        unit_id: u.id,
        causa: "unidad_desconocida",
        eje_afectado: ejesAfectados(u.id, dominio),
      });
      continue;
    }

    switch (u.extraction) {
      case "cubierta":
      case "cubierta_condicionada": {
        if (u.extraction === "cubierta_condicionada") {
          condicionadas.push(u.id);
          if ((u.blocked_by ?? []).length > 0) {
            warnings.push(`${u.id} entro condicionada con dependencias abiertas: ${[...(u.blocked_by ?? [])].sort().join(", ")}.`);
          }
        }
        if (u.normalized === null || u.normalized === undefined) {
          // Contradiccion de la entrada: se declara cubierta y no trae valor mapeable.
          // Va a cobertura, no al fallback: `fallback_rate` mide TAXONOMIA INCOMPLETA,
          // y contaminarlo con "no llego valor" arruinaria la unica metrica de
          // mantenimiento del dominio. La ausencia pertenece a `coverage` (ADR-009).
          warnings.push(
            `${u.id} declara extraction=${u.extraction} pero normalized es null: se registra como no evaluada, no como fallback.`,
          );
          noEvaluadas.push({
            unit_id: u.id,
            causa: "sin_normalizar",
            eje_afectado: ejesAfectados(u.id, dominio),
          });
          break;
        }
        // `state` y `confidence` se leen aqui SOLO para no leerlos: no filtran.
        elegibles.push({
          id: u.id,
          valor: u.normalized,
          condicionada: u.extraction === "cubierta_condicionada",
        });
        break;
      }
      case "hidratada_sin_normalizar": {
        noEvaluadas.push({
          unit_id: u.id,
          causa: "sin_normalizar",
          eje_afectado: ejesAfectados(u.id, dominio),
        });
        break;
      }
      case "suspendida": {
        noEvaluadas.push({
          // La causa ES la informacion: un `no_sabe` y un `no_comprende` habilitan
          // lecturas clinicas distintas y solo la conversacional pudo observarlas.
          unit_id: u.id,
          causa: u.cause ?? "sin_causa_declarada",
          eje_afectado: ejesAfectados(u.id, dominio),
        });
        if (u.cause === undefined) {
          warnings.push(`${u.id} llego suspendida sin causa declarada; se registra como sin_causa_declarada.`);
        }
        break;
      }
    }
  }

  return { elegibles, noEvaluadas, condicionadas, warnings };
}

/**
 * Que ejes quedan ciegos cuando esta unidad no se pudo evaluar.
 *
 * Tres aportes, y ninguno es opcional: el eje de FUNCIONALIDAD siempre, porque se
 * pierde el hallazgo por unidad; el eje DECLARADO de la unidad en el dominio, que es
 * lo que la unidad informaba; y el de INTERACCION cuando alguna clase alcanzable por
 * la unidad participa de alguna composicion — porque su ausencia no solo borra un
 * hallazgo, tambien impide que una regla combinada llegue a activarse, y eso es
 * exactamente lo que el decisor necesita saber antes de leer un silencio como calma.
 */
export function ejesAfectados(unitId: string, dominio: Dominio): DeterministicAxis[] {
  const ejes = new Set<DeterministicAxis>(["funcionalidad"]);
  const propio = dominio.ejeDeUnidad.get(unitId);
  if (propio) ejes.add(propio);
  if (dominio.unidadesQueAlimentanComposiciones.has(unitId)) ejes.add("interaccion");
  return ORDEN_DE_EJES.filter((e) => ejes.has(e));
}
