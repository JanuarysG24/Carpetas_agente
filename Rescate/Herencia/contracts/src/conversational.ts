/**
 * Costura CONVERSACIONAL <-> DECISION.
 *
 * Instancia `docs/Especificacion-Capa-Conversacional.md` §8.2 y §15.1.
 * Aqui solo viven tipos: ninguna capa importa logica de otra a traves de este archivo.
 *
 * El transporte queda FUERA del tipo. Una implementacion en proceso y una HTTP
 * satisfacen las mismas formas sin cambiarlas.
 */

// ---------------------------------------------------------------------------
// Identidad — spec conversacional §7.2 y §7.4
// ---------------------------------------------------------------------------

/**
 * Estado de identidad tal como CRUZA la costura.
 *
 * Ojo con la asimetria: `verifyIdentity` (spec de decision §4) responde
 * `identificado | ambiguo | no_encontrado`, que son veredictos de una consulta.
 * Lo que viaja al decisor es el resultado de la FASE completa: o se identifico,
 * o la fase se agoto (`unverified`). `ambiguo` y `no_encontrado` son estados
 * intermedios de F0 y no cruzan.
 */
export type IdentityStatus = "identificado" | "unverified";

/** §7.4 — el cuidador OBSERVA pero no SIENTE; el decisor debe poder ponderarlo. */
export type SpeakerRole = "paciente" | "cuidador" | "desconocido";

// ---------------------------------------------------------------------------
// El marco contextual — spec §8.2
// ---------------------------------------------------------------------------

/** §8.2 — `opportunistic` NUNCA se pregunta: solo se hidrata si el paciente la toca. */
export type UnitPriority = "required" | "desired" | "opportunistic";

export type UnitType = "boolean" | "scale" | "categorical" | "quantity" | "free";

/** §8.2 — las dimensiones que hacen a una unidad "suficientemente descrita" (enlace 2). */
export type CoverageDimension = "value" | "onset" | "trend" | "magnitude";

/**
 * §8.2, enlace 3 (ADR-002) — vocabulario canonico del decisor + regionalismos esperados.
 * Es el corazon de la aproximacion funcional: el decisor declara COMO quiere recibir
 * el dato, la conversacional decide como preguntarlo.
 */
export interface UnitLexicon {
  /** Vocabulario canonico. Puede ir vacio si el valor es numerico libre. */
  values: string[];
  /** Regionalismo esperado -> termino canonico. PRODUCE `normalized`. */
  synonyms?: Record<string, string[]>;
  /**
   * Expresiones que TOCAN la unidad pero NO la cuantifican (correccion del 8-ago).
   *
   * ============ Por que no pueden ir en `synonyms` ============
   *
   * "calorcito", "molestia", "poquito" hablan de la unidad y no dicen su valor.
   * Meterlas en `synonyms` las mapearia a un canonico, que es exactamente el error:
   * traducir "molestia" a 2 o "fuerte" a 8 inventa un valor que el paciente no dijo,
   * en el campo que el decisor lee como interpretado.
   *
   * Lo que producen es lo contrario de un valor: `normalized: null` con el `raw`
   * intacto (ADR-004) y el protocolo de reflejo disparado. Es ADR-024 — la ausencia
   * tiene representacion propia— y por eso necesita una lista propia y no un rincon
   * de `synonyms`.
   *
   * Salen medidas del corpus, no inventadas: 12 apariciones de "calorcito"
   * acompañando lecturas de 37,4-37,6 °C.
   *
   * ============================================================
   */
  requires_precision?: string[];
  /** "°C", "dias", "1-10". */
  unit?: string;
}

/**
 * §8.2 — una unidad de extraccion del catalogo.
 *
 * `intent` es prosa dirigida a la CONVERSACIONAL, no al paciente: dice QUE se
 * necesita saber, nunca como preguntarlo ni que significa clinicamente. Un marco
 * que dijera "si la temperatura supera 38.5 marcar infeccion" habria roto la
 * frontera: eso es criterio clinico y vive entero del lado del decisor.
 */
export interface UnitSpec {
  id: string;
  intent: string;
  priority: UnitPriority;
  type: UnitType;
  /** Enlace 2: que dimensiones debe tener la unidad para considerarse descrita. */
  coverage: { requires: CoverageDimension[] };
  lexicon?: UnitLexicon;
  /** Enlace 6: grafo de dependencias. Cada id debe existir en el mismo marco. */
  depends_on?: string[];
  /** Unidad compuesta: emerge de otras y no se cierra mientras ellas no cierren. */
  composes?: string[];
}

/** §14 — patrones de superficie que disparan la interrupcion prioritaria (enlace 7). */
export interface RedFlagSpec {
  id: string;
  patterns: string[];
}

/**
 * §16 — red de seguridad, NO criterio de cierre. El cierre lo decide el estado
 * del motor (§9); el presupuesto solo garantiza que la sesion termine.
 *
 * CORRECCION X-4 (7-ago): `max_rounds` NO vive aqui y no debe agregarse. El bucle
 * de rondas lo gobierna el decisor (ADR-003), y agotarlo produce una decision con
 * `context_complete: false`, que es un acto del decisor. Corolario: la conversacional
 * tampoco debe saber en que ronda va — conocerlo le permitiria modular su insistencia
 * segun el presupuesto del decisor, y eso es filtrar criterio de suficiencia global
 * a una capa que por diseño no lo tiene.
 */
export interface FramePolicy {
  max_turns: number;
  max_session_ms: number;
  /** Umbral de reflejo obligatorio (ADR-004). Se compara contra `UnitResult.confidence`. */
  reflect_below_confidence: number;
  /** Turnos consecutivos en negativo para declarar ciclo retroactivo (§9.5). */
  stall_window: number;
  allow_partial_handback: boolean;
}

/**
 * §8.1 — el catalogo de unidades de esta sesion, entregado por el decisor EN RUNTIME
 * y especifico del caso quirurgico. No es un cuestionario: no trae texto para leer
 * en voz alta, trae intencion.
 *
 * `frame_delta` (ver `FrameVerdict`) reutiliza este mismo tipo con `round` incrementado
 * y solo las unidades reabiertas — un segundo esquema se desincronizaria.
 */
export interface ContextFrame {
  frame_id: string;
  /** `null` cuando la identidad quedo `unverified` (§7.2). */
  patient_ref: string | null;
  /** 0 = marco inicial; >0 = frame_delta. */
  round: number;
  units: UnitSpec[];
  red_flags: RedFlagSpec[];
  policy: FramePolicy;
}

// ---------------------------------------------------------------------------
// El marco hidratado — spec §15.1
// ---------------------------------------------------------------------------

/** §10.1 — estado de extraccion de la unidad. Ortogonal al estado numerico. */
export type UnitExtraction =
  | "cubierta"
  | "cubierta_condicionada"
  | "hidratada_sin_normalizar"
  | "suspendida";

/**
 * §10.3 — el vacio como informacion. Distinguir `no_sabe` de `no_comprende` de
 * `sin_respuesta` es clinicamente decisivo y SOLO esta capa puede observarlo:
 * es la unica presente cuando el paciente calla. Colapsarlas en `null` destruye
 * señal irrecuperable.
 */
export type UnitCause =
  | "no_sabe"
  | "no_aplica"
  | "no_comprende"
  | "rehusa"
  | "sin_respuesta"
  | "incoherente"
  | "interrumpido"
  | "bloqueado_por_urgencia";

/**
 * §10.2 — acompaña a `cause` para que el decisor distinga de un vistazo el vacio
 * colaborativo del vacio por degradacion, sin tener que inferirlo de la causa.
 * Un `no_sabe` limpio es un turno SANO, no un fracaso de extraccion.
 */
export type UnitClosure = "declarado" | "degradacion" | "corte";

/**
 * Union del valor normalizado. Es ancha a proposito: una fiebre es `number`,
 * una adherencia a medicacion es `boolean`, un aspecto de herida es `string`.
 * `CallSummary.findings[].normalized` usa esta MISMA union (correccion X-7):
 * estrecharla obligaria al ensamblador a serializar, y serializar es transformar,
 * que es justo lo que ADR-016 le prohibe.
 */
export type NormalizedValue = string | number | boolean | null;

/** Rango cerrado del motor de estados (§9.2). Documental: TypeScript no acota enteros. */
export const STATE_MIN = -3;
export const STATE_MAX = 3;
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;

/**
 * §15.1 — una unidad tal como vuelve al decisor.
 *
 * ================== ADR-005: `state` NO es `confidence` ==================
 *
 * Es el punto de confusion mas probable del proyecto. Miden cosas distintas,
 * vienen de mecanismos distintos y AMBAS deben viajar:
 *
 *   | | `state`                          | `confidence`                        |
 *   |-|----------------------------------|-------------------------------------|
 *   |Mide | SALUD DE LA EXTRACCION: que  | FIDELIDAD DEL MAPEO: este texto     |
 *   |     | tan sana fue la conversacion | corresponde a este concepto del     |
 *   |     | que lo produjo               | lexico?                             |
 *   |Naturaleza| Acumulada por unidad    | Instantanea, por acto de normalizacion |
 *   |Origen| Aritmetica determinista (§9)| Capa probabilistica (interpretacion)|
 *   |Rango | entero en [-3, +3]          | real en [0, 1]                      |
 *
 * Son INDEPENDIENTES, y las dos combinaciones cruzadas son reales:
 *   - `confidence: 0.9` con `state: -2` — el paciente termino diciendo algo
 *     clarisimo, pero se contradijo tres veces antes. Dato nitido, fuente inestable.
 *   - `confidence: 0.3` con `state: +3` — conversacion fluida y colaborativa
 *     sobre algo que simplemente no mapea al lexico.
 *
 * Colapsarlas en un solo numero destruye informacion que el decisor necesita
 * para ponderar. Un `exudado_purulento` obtenido en +3 y otro obtenido en -1
 * tras tres correcciones no merecen el mismo peso clinico.
 *
 * ========================================================================
 */
export interface UnitResult {
  id: string;
  extraction: UnitExtraction;
  /** ADR-005 · SALUD DE LA EXTRACCION. Entero en [-3, +3]. NO es `confidence`. */
  state: number;
  /** Trayectoria turno a turno del mismo estado: distingue "salio limpio" de "costo pero se logro". */
  state_trace: number[];
  /** ADR-004 — literal del paciente, SIEMPRE. La evidencia no se destruye. */
  raw: string | null;
  normalized: NormalizedValue;
  /** ADR-005 · FIDELIDAD DEL MAPEO. Real en [0, 1]. NO es `state`. */
  confidence: number;
  /** Dimensiones de `UnitSpec.coverage.requires` efectivamente satisfechas. */
  coverage_met: CoverageDimension[];
  cause?: UnitCause;
  closure?: UnitClosure;
  /** Dependencias sin resolver — acompaña a `extraction: "cubierta_condicionada"`. */
  blocked_by?: string[];
  turn_refs: number[];
}

/** §9.2 y §15.1 — lo que el decisor necesita para leer la sesion, no solo las unidades. */
export interface SessionState {
  /** Acumulador de i2: solidez narrativa. Entero en [-3, +3]. */
  global: number;
  /**
   * `min` sobre las unidades `required` no cerradas (enlace 5). Entero en [-3, +3].
   *
   * `null` = NO HAY LECTURA: ninguna unidad `required` sigue abierta, asi que no hay
   * salud de extraccion que medir. No es un valor intermedio ni un cero prudente.
   *
   * CORRECCION M2 (7-ago). La version anterior devolvia `0` en ese caso y era
   * ambiguo justo donde no puede serlo: `0` tambien significa "todas las requeridas
   * estan exactamente en 0", y el decisor se comporta distinto segun cual sea. La
   * ausencia no se codifica como un valor del dominio de la presencia — es la misma
   * decision que `normalized: null` en vez de copiar el `raw` (ADR-004) y que
   * `unidad_desconocida` en vez de caer al fallback (determinista §5.1).
   */
  frame_health: number | null;
  retroactive_cycle: boolean;
  identity: IdentityStatus;
}

export interface BudgetSpent {
  turns: number;
  ms: number;
}

// ---------------------------------------------------------------------------
// El veredicto y la decision — spec §15.1, ADR-013, ADR-014, ADR-018
// ---------------------------------------------------------------------------

/** ADR-018 — la LECTURA de gravedad. Es lo que se contrasta contra `label_ground_truth`. */
export type Criticality = "verde" | "amarillo" | "rojo";

/**
 * ADR-014 + ADR-018 — por que se decidio lo que se decidio, tipificado.
 * Obligatorio: uno opcional deja media auditoria sin codigo (correccion X-5).
 */
export type ReasonCode =
  /** Camino normal: ambos votos existieron y se ponderaron por la tabla OR. */
  | "evaluado"
  /** Amarillo escalado por seguimiento, no por urgencia (ADR-018). */
  | "vigilancia"
  /** ADR-014 · incompletud contextual. */
  | "contexto_incompleto"
  /** ADR-014 · incoherencia sin resolver. */
  | "incongruencia"
  /** ADR-014 · componente caido. */
  | "falla_tecnica"
  /** ADR-014 · `escalateNow`, red flag. */
  | "urgencia";

/**
 * §15.1 + ADR-018 — la decision terminal del sistema.
 *
 * ============== ADR-018: `escalate` y `criticality` NO se colapsan ==============
 *
 * `escalate` es la ACCION. Es lo unico sobre lo que opera el ponderador OR de
 * ADR-013 (un si actua; el VD dispara pero no veta).
 *
 * `criticality` es la LECTURA de gravedad. NO se pondera: se registra. Es el campo
 * que se contrasta contra el dataset etiquetado, y existe porque colapsarlo perderia
 * el `amarillo` — el 16 % de los casos y el unico tramo donde la decision es interesante.
 *
 * El mapeo por defecto es `rojo` => escalar, `verde` => no escalar, `amarillo` =>
 * escalar con `reason_code: "vigilancia"`. Es un DEFAULT del decisor, no una
 * derivacion del tipo: `escalate` puede ser `true` con `criticality: "verde"`
 * (degradacion por ADR-014) y esa combinacion es valida y esperada.
 *
 * NOMENCLATURA (correccion X-1, 7-ago): el booleano se llamaba `alert`. No lo uses.
 * Teniendo `criticality` al lado, `alert` invita a leerse como sinonimo de
 * `criticality === "rojo"`, que es exactamente la confusion que ADR-018 elimina.
 * `alert` sobrevive unicamente en `alert_channel`, que es un destino de entrega.
 *
 * ==============================================================================
 */
export interface Decision {
  /** ADR-013 — la ACCION. Lo que produce el ponderador OR. */
  escalate: boolean;
  /** ADR-018 — la LECTURA. Campo independiente, jamas derivado de `escalate`. */
  criticality: Criticality;
  /** Explicable y auditable. Siempre presente, nunca vacio. */
  reason: string;
  /** Tipificado y obligatorio (correccion X-5). */
  reason_code: ReasonCode;
  /**
   * Lo que la conversacional debe COMUNICAR. El decisor entrega la sustancia;
   * la conversacional la reformula con tono y regionalismos. El `reason` tecnico
   * no se verbaliza tal cual.
   */
  say_to_patient: string;
  /** `doc_ids` es evidencia del VP; `rules_fired` es evidencia del VD. */
  traces: { doc_ids: string[]; rules_fired: string[] };
  context_complete: boolean;
}

/**
 * §15.1 — el veredicto de suficiencia GLOBAL. Es del decisor y solo del decisor:
 * la conversacional juzga suficiencia local (ADR-003), nunca esta.
 */
export type FrameVerdict =
  | { status: "need_more"; frame_delta: ContextFrame }
  | { status: "sufficient"; decision: Decision };
