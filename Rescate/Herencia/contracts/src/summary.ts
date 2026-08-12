/**
 * El resumen estructurado. Instancia `docs/Especificacion-Capa-Decision.md` §8b (ADR-016).
 *
 * ============ ADR-016: ninguna sesion termina sin `CallSummary` ============
 *
 * La regla de ADR-014 —ningun camino sin `Decision`— se extiende un eslabon:
 * NINGUNA SESION SIN `CallSummary`. Los cuatro cierres (tabla OR, degradacion,
 * urgencia y falla) convergen en el resumen.
 *
 * EL RESUMEN NO SE INFIERE: SE ENSAMBLA. Es una destilacion determinista del
 * ledger de sesion. Esta prohibido pedirle al modelo de lenguaje que "resuma la
 * llamada" como mecanismo canonico: la evidencia ya esta en el ledger, y un
 * resumen inferido podria contradecirla. El unico campo generativo es `narrative`,
 * y es derivado, opcional y JAMAS canonico: si contradice los campos estructurados,
 * valen los campos.
 *
 * ==========================================================================
 */

import type {
  Criticality,
  IdentityStatus,
  NormalizedValue,
  ReasonCode,
} from "./conversational.ts";

/**
 * §8b.1 — un voto. Lo emiten POR IGUAL el VP (modelo en rol `decider`) y el VD
 * (funcion de lectura declarada sobre el `DeterministicReport`).
 *
 * Correccion X-1 (7-ago): los votos dejaron de ser el par de literales
 * `"alertar" | "no_alertar"` para volverse objetos, porque bajo ADR-018 cada voto
 * transporta SU ACCION Y SU LECTURA de criticidad, y ambas viajan como evidencia.
 *
 * La tabla OR de ADR-013 opera SOLO sobre `escalate`. `criticality` no se pondera,
 * se registra. Y el VD tiene poder de disparo unilateral pero NO poder de veto:
 * no existe configuracion que permita a un voto negativo apagar uno positivo.
 */
export interface Vote {
  escalate: boolean;
  criticality: Criticality;
  reason: string;
}

/**
 * §8b.1 — una entrada por unidad del marco.
 *
 * Reutiliza lo que ya viaja en `UnitResult`, sin re-tipar. En particular
 * `normalized` usa la union ANCHA (correccion X-7): estrecharla a `string | null`
 * obligaria al ensamblador a serializar una fiebre (`number`) o una adherencia a
 * medicacion (`boolean`) a texto, y eso es re-tipar — justo lo que ADR-016 le
 * prohibe al ensamblador, que ensambla y no transforma. Ademas romperia la
 * verificacion contra los 160 casos etiquetados: comparar "7" con 7 exige parsear,
 * y parsear es donde viven los errores silenciosos.
 */
export interface SummaryFinding {
  unit_id: string;
  /** Estado final del motor conversacional. Entero en [-3, +3]. Ver ADR-005. */
  state: number;
  /** ADR-004: la evidencia no se destruye. */
  raw: string | null;
  /** MISMA union que `UnitResult.normalized` (correccion X-7). */
  normalized: NormalizedValue;
  /** Causa tipificada si no se extrajo. */
  cause?: string;
}

/** Que rama del flujo produjo la decision. Las tres de ADR-013 y ADR-014. */
export type DecisionBranch = "or" | "degradacion" | "urgencia";

export interface SummaryDecision {
  /** ADR-013 — la accion. Renombrado desde `alert` el 7-ago (correccion X-1). */
  escalate: boolean;
  /** ADR-018 — la lectura de gravedad. */
  criticality: Criticality;
  reason: string;
  reason_code: ReasonCode;
  branch: DecisionBranch;
  /** Cada voto lleva su accion y su lectura. Ausentes en degradacion y urgencia. */
  votes?: { vp?: Vote; vd?: Vote };
  /** `doc_ids` del VP, `rules_fired` del VD, `vd_rule` la regla de lectura aplicada. */
  traces: { doc_ids: string[]; rules_fired: string[]; vd_rule?: string };
}

/**
 * §8b.1 — el resumen estructurado de la llamada.
 *
 * Es AUTOCONTENIDO: un humano que solo reciba este objeto puede auditar la sesion
 * sin acceso al sistema, porque lleva evidencia (`raw`), interpretacion
 * (`normalized`, `state`), decision, trazas y versiones de todo lo que la produjo.
 */
export interface CallSummary {
  session_id: string;
  generated_at: string;
  /** Opaco; nunca datos del paciente (ADR-011). `null` si la identidad quedo sin verificar. */
  patient_ref: string | null;
  identity_status: IdentityStatus;
  frame: {
    /** ADR-012 — se declara, no se disimula. Sin experto clinico, es `inferred`. */
    provenance: "expert" | "inferred";
    rounds: number;
    context_complete: boolean;
  };
  findings: SummaryFinding[];
  decision: SummaryDecision;
  versions: {
    domain_version: string;
    /** Version de la tabla de lectura del voto determinista. */
    vd_version: string;
    embedding_model: string;
  };
  metrics?: { latency_ms: number; tokens: number; cost_estimate: number };
  /**
   * Sobre que unidades NO se pudo citar nada, y por que (correccion del 8-ago).
   *
   * ============ ADR-024 en la trazabilidad documental ============
   *
   * Es el espejo exacto de `DeterministicCoverage.no_evaluadas`, y existe por la
   * misma razon: la no evaluabilidad es un RESULTADO, no un vacio. Ahi se declara
   * que no se pudo mirar; aqui, sobre que no se pudo citar.
   *
   * Sin este campo, la unica forma de decir "no encontre respaldo documental para
   * el apetito" es no decir nada, y entonces un `doc_ids` corto es indistinguible
   * de una recuperacion que fue bien. Peor: crea el incentivo de citar cualquier
   * cosa con tal de que la traza no se vea vacia, que es justo lo que el piso de
   * relevancia del indice se niega a hacer.
   *
   * Un sistema que declara sobre que no pudo citar es mas fuerte que uno que cita
   * cualquier cosa.
   *
   * ==============================================================
   */
  evidence_gaps?: Array<{ unit_id: string; motivo: string }>;
  /** Redaccion del `decider`. Derivada y JAMAS canonica: si contradice, valen los campos. */
  narrative?: string;
}

/**
 * §8b.2 — politica de destinos.
 *
 * `session_archive` recibe TODO resumen: es el registro auditable y la fuente del
 * informe del reto. `alert_channel` recibe el resumen cuando `escalate: true` —
 * el personal alertado no recibe un timbre, recibe el caso.
 */
export type SummaryDestination = "session_archive" | "alert_channel";

/**
 * A la falla de entrega, REGISTRO, nunca silencio. Si `alert_channel` falla, la
 * alerta ya fue emitida por la `Decision` y el resumen persiste en
 * `session_archive` con la falla registrada. El resumen jamas se pierde por un
 * destino caido.
 */
export interface DeliveryReceipt {
  delivered: string[];
  failed: string[];
}
