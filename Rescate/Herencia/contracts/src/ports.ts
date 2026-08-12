/**
 * Los ocho puertos del sistema. INTERFACES SIN IMPLEMENTACION.
 *
 * ================== El transporte queda FUERA del tipo ==================
 *
 * Ningun puerto de este archivo menciona HTTP, JSON, sockets, colas ni proceso.
 * En el mismo proceso, un puerto es una llamada de funcion; separados, es HTTP con
 * el mismo esquema. Una implementacion in-process y una HTTP deben satisfacer la
 * MISMA interfaz sin cambiarla — si alguna vez hace falta tocar el puerto para
 * cambiar de transporte, el puerto estaba mal.
 *
 * Corolario que se ve en las firmas: `DeterministicPort.evaluate` es SINCRONO y
 * sin `Promise`. No es un descuido ni una optimizacion: es una funcion PURA —sin
 * red, sin reloj, sin estado— y prometer asincronia sugeriria lo contrario.
 *
 * =======================================================================
 *
 * Ninguna implementacion vive aqui. Cada capa implementa su puerto en su propia
 * sesion de construccion; este modulo solo garantiza que todas hablen la misma forma.
 */

import type {
  ContextFrame,
  CoverageDimension,
  Decision,
  FrameVerdict,
  IdentityStatus,
  NormalizedValue,
  SessionState,
  SpeakerRole,
  UnitCause,
  UnitResult,
  UnitSpec,
  BudgetSpent,
} from "./conversational.ts";
import type {
  DeterministicReport,
  DeterministicRequest,
  DomainManifest,
} from "./deterministic.ts";
import type {
  DocumentListEntry,
  IngestReceipt,
  KnowledgeStatus,
  ReindexReport,
  RetrievalQuery,
  RetrievedChunk,
  SourceDocument,
} from "./knowledge.ts";
import type { IdentityClaim, IdentityVerdict, PatientCase } from "./patient.ts";
import type {
  CallSummary,
  DeliveryReceipt,
  SummaryDestination,
  Vote,
} from "./summary.ts";

// ---------------------------------------------------------------------------
// 1. DecisionPort — costura conversacional <-> decision (spec conversacional §15.1)
// ---------------------------------------------------------------------------

/** F1 — la identidad tal como la conversacional la resolvio en F0. */
export interface FrameRequest {
  session_id: string;
  identity: {
    status: IdentityStatus;
    /** `null` cuando `status` es `unverified`. */
    patient_ref: string | null;
    claimed_name?: string;
    speaker_role: SpeakerRole;
  };
}

/** F3 — el marco hidratado que vuelve al decisor. */
export interface FrameSubmission {
  session_id: string;
  frame_id: string;
  round: number;
  units: UnitResult[];
  session_state: SessionState;
  /**
   * Resumen LITERAL, no interpretado. Viaja junto a las unidades porque el decisor
   * puede necesitar algo que el marco no previo: es la valvula de ADR-004 a nivel
   * de conversacion completa, no solo de unidad.
   */
  transcript_digest: string;
  budget_spent: BudgetSpent;
}

/** Interrupcion prioritaria — corta el bucle desde cualquier punto (§14). */
export interface EscalationRequest {
  session_id: string;
  red_flag_id: string;
  /** El enunciado literal que disparo la red flag. Viaja sin interpretar. */
  utterance: string;
  units_so_far: UnitResult[];
}

/**
 * El contrato de la segunda costura. Lo implementa la capa de DECISION y lo
 * consume la capa CONVERSACIONAL.
 *
 * El bucle de suficiencia vive entero aqui: `submitFrame` devuelve `need_more`
 * con un `frame_delta` y el ciclo se repite. La conversacional nunca decide que
 * el contexto es suficiente — esa es suficiencia global y es del decisor (ADR-003).
 */
export interface DecisionPort {
  /** F1 — identidad resuelta -> catalogo de unidades a hidratar. */
  requestFrame(req: FrameRequest): Promise<ContextFrame>;

  /** F3 — marco hidratado + estados -> veredicto de suficiencia global. */
  submitFrame(req: FrameSubmission): Promise<FrameVerdict>;

  /**
   * Urgencia. Devuelve `Decision` DIRECTAMENTE, sin veredicto de suficiencia:
   * en urgencia no hay bucle, no se invoca la determinista y no se espera al marco.
   */
  escalateNow(req: EscalationRequest): Promise<Decision>;
}

// ---------------------------------------------------------------------------
// 2. DeterministicPort — costura decision <-> determinista (spec determinista §6.2)
// ---------------------------------------------------------------------------

/**
 * Lo implementa la capa DETERMINISTA y lo consume la capa de DECISION, una sola
 * vez por sesion, despues de resolver `sufficient` y antes de construir la `Decision`.
 *
 * Ninguna de las dos operaciones devuelve `Promise`, y es normativo: `evaluate` es
 * una funcion pura y sincrona —sin red, sin reloj, sin estado— y `describeDomain`
 * lee el dominio ya cargado. Mismo input, mismo output, sin excepcion.
 */
export interface DeterministicPort {
  /** Evaluacion estructural. Funcion PURA y SINCRONA. */
  evaluate(req: DeterministicRequest): DeterministicReport;

  /** Introspeccion del dominio cargado. Para auditoria y para el README de metricas. */
  describeDomain(): DomainManifest;
}

// ---------------------------------------------------------------------------
// 3. PatientStorePort — dos vistas, dos consumidores (spec de decision §4)
// ---------------------------------------------------------------------------

/**
 * PRIVILEGIO MINIMO POR VISTA, y la separacion no es documental: WO-37 exige que
 * el modulo que expone `verifyIdentity` NO exporte `getCase`, verificable por la
 * superficie del paquete y no por convencion.
 *
 * `verifyIdentity` devuelve un veredicto y una referencia OPACA, nunca datos: la
 * conversacional no puede filtrar lo que no recibe.
 */
export interface PatientStorePort {
  /** Vista de IDENTIDAD — la unica visible a la capa conversacional (F0). */
  verifyIdentity(claim: IdentityClaim): IdentityVerdict;

  /** Vista de CASO — exclusiva de la capa de decision. */
  getCase(patient_ref: string): PatientCase;
}

// ---------------------------------------------------------------------------
// 4-5. KnowledgePort y KnowledgeConsolePort (spec de decision §8.3)
// ---------------------------------------------------------------------------

/**
 * Runtime — lo consume el VP. SOLO LECTURA.
 *
 * ADR-019: el rol `interviewer` NO recibe contexto recuperado. Este puerto entra
 * unicamente en el camino de decision. En CPU el costo dominante es el prefill, y
 * separar el camino corto del largo es lo que hace viable un modelo local en
 * tiempo real. Si alguna vez la capa conversacional importa este puerto, ADR-019
 * esta roto.
 */
export interface KnowledgePort {
  retrieve(q: RetrievalQuery): RetrievedChunk[];
}

/**
 * Administracion — lo consume el operador via consola. NUNCA lo toca el runtime.
 *
 * Es la compuerta G5 del reto: `ingest` y `retire` se reflejan en `retrieve` de
 * inmediato, sin reinicio. Subir un documento y que el agente lo use; retirarlo y
 * que lo olvide. Toda operacion queda registrada: una decision solo es auditable
 * si se sabe que conocimiento estaba vigente cuando se tomo.
 */
export interface KnowledgeConsolePort {
  ingest(doc: SourceDocument): IngestReceipt;

  /** Sale del indice YA; el documento fuente queda archivado para auditoria. */
  retire(doc_id: string): void;

  list(): DocumentListEntry[];

  /** ADR-015 — operacion de primera clase, no contingencia: el indice es derivado. */
  reindex(embedding_model: string): ReindexReport;

  status(): KnowledgeStatus;
}

// ---------------------------------------------------------------------------
// 6. SummarySinkPort — entrega del resumen (spec de decision §8b.2)
// ---------------------------------------------------------------------------

/**
 * `session_archive` recibe TODO resumen; `alert_channel` lo recibe cuando
 * `escalate: true`. A la falla de entrega, registro — nunca silencio: el resumen
 * jamas se pierde por un destino caido.
 */
export interface SummarySinkPort {
  deliver(summary: CallSummary, destinations: SummaryDestination[]): DeliveryReceipt;
}

// ---------------------------------------------------------------------------
// 7. ConversationalEngine — el modelo en rol `interviewer` (WO-18, ADR-002)
// ---------------------------------------------------------------------------

/**
 * §9.6 — los seis actos de la tabla de transiciones del motor. El acto lo elige el
 * MOTOR a partir del estado de la unidad activa, nunca el modelo.
 */
export type ConversationalAct =
  /**
   * NO es de la tabla §9.6: es la compuerta P1 de §11.1 (correccion C5, 9-ago).
   * El reflejo es un acto de habla distinto —se devuelve lo entendido para que el
   * paciente lo confirme o lo corrija— y es el INSTRUMENTO DE MEDICION de i3 (§9.1).
   * Sin el en esta union, la unica forma de redactarlo seria disfrazarlo de otro acto,
   * y el ledger no podria distinguir un reflejo de una pregunta.
   */
  | "reflejar"
  | "profundizar"
  | "continuar"
  | "mantener"
  | "reformular"
  | "cambiar_perspectiva"
  | "suspender";

/** El acto ya decidido, listo para redactar. El modelo lo recibe, no lo elige. */
export interface ActIntent {
  act: ConversationalAct;
  /** Unidad sobre la que se actua. `null` en actos que no tienen unidad activa. */
  unit_id: string | null;
  /** Pista del motor para la redaccion: dimension de coverage que falta, angulo nuevo. */
  hint?: string;
}

/** Un valor extraido de un enunciado, antes de que el motor lo convierta en `UnitResult`. */
export interface EngineExtraction {
  unit_id: string;
  /** ADR-004 — el literal, siempre. */
  raw: string;
  normalized: NormalizedValue;
  /** ADR-005 — FIDELIDAD DEL MAPEO, en [0,1]. El `state` lo calcula el motor, no el modelo. */
  confidence: number;
  coverage_met: CoverageDimension[];
}

/**
 * Lo que el modelo DETECTA y el motor interpreta. Cada variante corresponde a algo
 * que las specs ya nombran: red flags (§14), causas tipificadas (§10.3), rol del
 * hablante (§7.4) y temas emergentes del paciente (P2 del arbitraje, §11.1).
 */
export type EngineSignal =
  | { kind: "red_flag"; red_flag_id: string; utterance: string }
  | { kind: "cause"; unit_id: string; cause: UnitCause }
  | { kind: "speaker_role"; role: SpeakerRole }
  | { kind: "tema_emergente"; topic: string };

/**
 * Aisla el motor de lenguaje en rol `interviewer` (ADR-002). El binding concreto
 * —`llama3.2:3b` local sobre Ollama, con decodificacion restringida por esquema
 * (ADR-017)— es CONFIGURACION, no diseño: cambiarlo no debe tocar el motor de
 * estados, el arbitraje ni el contrato.
 *
 * EL MODELO NO ELIGE LA CADENCIA. `interpret` detecta y extrae; `render` pone en
 * palabras un acto YA elegido por el motor. Es verificable: forzando un acto, la
 * redaccion debe respetarlo.
 *
 * ADR-019: `interpret` no recibe contexto recuperado del RAG, y no debe recibirlo.
 */
export interface ConversationalEngine {
  interpret(req: {
    utterance: string;
    /** Solo el catalogo de unidades: el modelo no ve el estado clinico ni el RAG. */
    units: UnitSpec[];
    state: SessionState;
  }): Promise<{ extractions: EngineExtraction[]; signals: EngineSignal[] }>;

  render(req: { act: ActIntent; state: SessionState }): Promise<string>;
}

// ---------------------------------------------------------------------------
// 8. DecisionEngine — el modelo en rol `decider` (WO-36, ADR-002)
// ---------------------------------------------------------------------------

/** Lo que el decisor necesita mirar tanto para juzgar suficiencia como para votar. */
export interface DecisionEngineInput {
  frame: ContextFrame;
  units: UnitResult[];
  session_state: SessionState;
  transcript_digest: string;
}

/**
 * Suficiencia GLOBAL. Es del decisor y solo del decisor (ADR-003): la conversacional
 * juzga si un dato es linguisticamente extraible de esta persona; esto juzga si el
 * cuadro clinico esta completo.
 */
export interface SufficiencyAssessment {
  sufficient: boolean;
  /** Unidades a reabrir en el `frame_delta` cuando `sufficient` es `false`. */
  reopen_unit_ids: string[];
}

/** El voto probabilistico, con la evidencia documental que lo sostiene. */
export interface ProbabilisticVote {
  vote: Vote;
  /** Documentos citados. Alimentan `Decision.traces.doc_ids`. */
  doc_ids: string[];
}

/**
 * Aisla el motor de lenguaje en rol `decider`. Mismo modelo que el `interviewer`
 * (ADR-017): un solo modelo en todo el repositorio hace la compuerta G3 auditable
 * de un vistazo, y esa es la segunda razon —mas dura que la congruencia
 * representacional de ADR-002— por la que no hay dos.
 *
 * Este puerto emite el VP y NADA MAS. El VD es una tabla declarada sobre el
 * `DeterministicReport` y esta PROHIBIDO delegarlo al modelo de lenguaje: si la
 * lectura del reporte fuera probabilistica, el sistema perderia el segundo
 * mecanismo independiente que justifica la disyuncion de ADR-013.
 *
 * Tampoco ensambla el `CallSummary` (ADR-016): el resumen se destila del ledger.
 */
export interface DecisionEngine {
  assessSufficiency(req: DecisionEngineInput): Promise<SufficiencyAssessment>;

  /** VP — el voto probabilistico. La evidencia recuperada entra solo por aqui (ADR-019). */
  emitVote(req: DecisionEngineInput & { evidence: RetrievedChunk[] }): Promise<ProbabilisticVote>;
}
