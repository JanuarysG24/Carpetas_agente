/**
 * WO-44 — el ponderador OR. Disyuncion SIN VETO (ADR-013).
 *
 * ============ Por que este archivo no tiene ni un parametro ============
 *
 * Un si actua. El VD tiene poder de disparo unilateral pero NO poder de veto: no
 * existe configuracion en que un voto negativo apague uno positivo, y la forma de
 * garantizarlo es que no haya nada que configurar. **Un ponderador configurable es un
 * ponderador que alguien puede apagar**, y la ausencia de esa rama se protege con
 * prueba: la tabla es un `||`.
 *
 * ======================================================================
 *
 * ADR-018 — la tabla opera SOLO sobre `escalate`. `criticality` no se pondera: se
 * REGISTRA. Quedarse con la lectura mas grave de las dos no es ponderar, es no perder
 * de vista la peor — y por eso no cambia la accion.
 *
 * El camino hacia la alerta es ancho y el camino hacia el silencio es estrecho: para
 * que el sistema calle tienen que coincidir en el silencio los DOS votos, y ademas
 * pasar la cobertura (WO-44 §4, spec §10).
 */

import type { Criticality, DeterministicReport, ReasonCode, Vote } from "@techsphere/contracts";

const ORDEN: readonly Criticality[] = ["verde", "amarillo", "rojo"];

/** La mas grave de las dos lecturas. No es un promedio ni una votacion. */
export function criticidadMasGrave(a: Criticality, b: Criticality): Criticality {
  return ORDEN.indexOf(a) >= ORDEN.indexOf(b) ? a : b;
}

export interface ResultadoPonderacion {
  escalate: boolean;
  criticality: Criticality;
  reason: string;
  reason_code: Extract<ReasonCode, "evaluado" | "vigilancia">;
}

/**
 * LA TABLA OR. Cuatro filas y una sola operacion.
 *
 *   VP si · VD si   -> alertar
 *   VP si · VD no   -> alertar
 *   VP no · VD si   -> alertar   <- la fila que justifica ADR-013 entero
 *   VP no · VD no   -> no alertar
 */
export function ponderar(vp: Vote, vd: Vote): ResultadoPonderacion {
  const escalate = vp.escalate || vd.escalate;
  const criticality = criticidadMasGrave(vp.criticality, vd.criticality);

  // `vigilancia` distingue en el resumen una alerta de SEGUIMIENTO de una de
  // urgencia: el personal alertado no recibe todo con el mismo timbre.
  const reason_code = escalate && criticality === "amarillo" ? "vigilancia" : "evaluado";

  return {
    escalate,
    criticality,
    reason:
      `VP (${vp.criticality}${vp.escalate ? ", escala" : ", no escala"}): ${vp.reason} | ` +
      `VD (${vd.criticality}${vd.escalate ? ", escala" : ", no escala"}): ${vd.reason}`,
    reason_code,
  };
}

// ---------------------------------------------------------------------------
// Cobertura antes del silencio (spec §10)
// ---------------------------------------------------------------------------

export interface LecturaDeCobertura {
  suficiente: boolean;
  no_evaluadas: string[];
  ratio: number;
}

/**
 * Antes de emitir `escalate: false`, se mira que se pudo evaluar.
 *
 * Unidades `required` no evaluadas convierten el caso en INCOMPLETUD, no en silencio.
 * El falso negativo por omision —el error mas caro— queda bloqueado por regla y no
 * por criterio: no depende de que alguien se acuerde de mirar.
 *
 * Solo se exige sobre las `required` del marco: una `opportunistic` no evaluada es lo
 * normal, porque por definicion nunca se pregunta.
 */
export function coberturaSuficiente(
  reporte: DeterministicReport,
  requeridas: readonly string[],
): LecturaDeCobertura {
  const evaluadas = new Set(reporte.coverage.evaluadas);
  const faltan = requeridas.filter((id) => !evaluadas.has(id));
  return { suficiente: faltan.length === 0, no_evaluadas: faltan, ratio: reporte.coverage.ratio };
}
