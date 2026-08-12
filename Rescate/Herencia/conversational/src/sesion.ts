/**
 * Las cinco funciones que el resto del sistema ya espera (Estafeta-Plan-de-Trabajo.md
 * §5.1, y su uso real en `decision/scripts/muestra-estratificada.mjs`):
 *
 *   cargarMarco · iniciarSesion · conducirTurno · cerrarPendientesPorCorte · unidadesParaEntrega
 *
 * Los nombres se respetan tal cual: hay codigo heredado que ya los importa.
 */

import type {
  ContextFrame,
  ConversationalEngine,
  SessionState,
  SpeakerRole,
  UnitCause,
  UnitResult,
} from "@techsphere/contracts";
import {
  aplicarCausa,
  aplicarExtraccion,
  clamp,
  elegirActo,
  estaCerrada,
  unidadVacia,
  type UnidadInterna,
} from "./motor-estados.ts";

/** Cuantas veces se reintenta una unidad en degradacion antes de rendirse (§9.5, implementable). */
const TOLERANCIA_REINTENTOS_POR_DEFECTO = 1;

export interface EstadoConversacion {
  readonly session_id: string;
  readonly phase: "F1" | "F2" | "F5";
  readonly frame: ContextFrame | null;
  readonly turno: number;
  readonly global_state: number;
  readonly retroactive_cycle: boolean;
  readonly identity: "identificado" | "unverified";
  readonly speaker_role: SpeakerRole;
  readonly unidades: ReadonlyMap<string, UnidadInterna>;
  readonly orden: readonly string[];
  readonly transcript: readonly { turno: number; texto: string; hablante: "paciente" | "agente" }[];
  readonly red_flag: { red_flag_id: string; utterance: string } | null;
  readonly stall_count: number;
  readonly ultima_unidad_tocada: string | null;
  readonly ultimo_acto: { act: string; unit_id: string | null; hint?: string } | null;
}

/** Crea la sesion vacia. Sin marco todavia: eso lo trae `cargarMarco`. */
export function iniciarSesion(session_id: string): EstadoConversacion {
  return {
    session_id,
    phase: "F1",
    frame: null,
    turno: 0,
    global_state: 0,
    retroactive_cycle: false,
    identity: "identificado",
    speaker_role: "paciente",
    unidades: new Map(),
    orden: [],
    transcript: [],
    red_flag: null,
    stall_count: 0,
    ultima_unidad_tocada: null,
    ultimo_acto: null,
  };
}

/**
 * Hidrata el estado con un `ContextFrame`. Sirve TANTO para el marco inicial
 * (`round: 0`, todas las unidades nuevas) COMO para un `frame_delta` (`round > 0`,
 * solo las unidades reabiertas): es el mismo tipo a proposito (comentario de
 * `ContextFrame` en el contrato). Las unidades ya cerradas que no vienen en el
 * delta NO se tocan.
 */
export function cargarMarco(estado: EstadoConversacion, frame: ContextFrame): EstadoConversacion {
  const unidades = new Map(estado.unidades);
  const orden = [...estado.orden];

  for (const spec of frame.units) {
    const previa = unidades.get(spec.id);
    if (!previa || frame.round > 0) {
      // marco inicial, o reapertura explicita por frame_delta: unidad fresca.
      unidades.set(spec.id, unidadVacia(spec));
    } else {
      unidades.set(spec.id, { ...previa, spec });
    }
    if (!orden.includes(spec.id)) orden.push(spec.id);
  }

  return {
    ...estado,
    phase: "F2",
    frame,
    unidades,
    orden,
    // un frame_delta reabre el ciclo de estancamiento: cuenta limpia por ronda.
    stall_count: frame.round > 0 ? 0 : estado.stall_count,
  };
}

function frameHealth(unidades: ReadonlyMap<string, UnidadInterna>): number | null {
  const abiertas = [...unidades.values()].filter((u) => u.spec.priority === "required" && !estaCerrada(u));
  if (abiertas.length === 0) return null;
  return Math.min(...abiertas.map((u) => u.state));
}

function sessionState(estado: EstadoConversacion): SessionState {
  return {
    global: estado.global_state,
    frame_health: frameHealth(estado.unidades),
    retroactive_cycle: estado.retroactive_cycle,
    identity: estado.identity,
  };
}

function todoPendienteResuelto(unidades: ReadonlyMap<string, UnidadInterna>): boolean {
  return [...unidades.values()].filter((u) => u.spec.priority === "required").every(estaCerrada);
}

export interface ResultadoTurno {
  estado: EstadoConversacion;
  /** Lo que el agente dice a continuacion. `null` cuando la fase ya es F5. */
  say: string | null;
  acto: { act: string; unit_id: string | null; hint?: string } | null;
}

/**
 * Conduce UN turno: interpreta el enunciado del paciente, mueve el motor de
 * estados y redacta la siguiente intervencion del agente.
 *
 * `motor` implementa el puerto `ConversationalEngine` (interpret + render). La
 * conversacional NUNCA decide sola: `interpret` detecta, este archivo interpreta
 * el detectado contra el estado, y `render` pone en palabras un acto YA elegido.
 */
export async function conducirTurno(
  estado: EstadoConversacion,
  textoPaciente: string,
  motor: ConversationalEngine,
  turno: number,
): Promise<ResultadoTurno> {
  if (!estado.frame) {
    throw new Error("conducirTurno: la sesion no tiene marco cargado. Llama cargarMarco primero.");
  }
  const frame = estado.frame;
  const reflectBelow = frame.policy.reflect_below_confidence;
  const tolerancia = TOLERANCIA_REINTENTOS_POR_DEFECTO;

  const transcript = [...estado.transcript, { turno, texto: textoPaciente, hablante: "paciente" as const }];

  const { extractions, signals } = await motor.interpret({
    utterance: textoPaciente,
    units: frame.units,
    state: sessionState(estado),
  });

  let unidades = new Map(estado.unidades);
  let redFlag = estado.red_flag;
  let speakerRole = estado.speaker_role;
  let ultimaUnidadTocada: string | null = null;
  let huboProgreso = false;
  let huboRetroceso = false;

  for (const ext of extractions) {
    const previa = unidades.get(ext.unit_id);
    if (!previa) continue; // el motor no puede inventar unidades fuera del marco (ADR-024 a nivel de costura).
    const nueva = aplicarExtraccion(previa, ext, turno, reflectBelow);
    unidades.set(ext.unit_id, nueva);
    ultimaUnidadTocada = ext.unit_id;
    if (nueva.extraction === "cubierta" || nueva.extraction === "cubierta_condicionada") huboProgreso = true;
    else if (nueva.normalized === null) {
      /* toco sin cuantificar: ni progreso ni retroceso, es informacion (ADR-024). */
    } else if (nueva.state <= previa.state) huboRetroceso = true;
  }

  for (const senal of signals) {
    if (senal.kind === "red_flag") {
      redFlag = { red_flag_id: senal.red_flag_id, utterance: senal.utterance };
    } else if (senal.kind === "speaker_role") {
      speakerRole = senal.role;
    } else if (senal.kind === "cause") {
      const previa = unidades.get(senal.unit_id);
      if (!previa) continue;
      const nueva = aplicarCausa(previa, senal.cause, turno, tolerancia);
      unidades.set(senal.unit_id, nueva);
      ultimaUnidadTocada = senal.unit_id;
      if (nueva.closure === "declarado") huboProgreso = true;
      else huboRetroceso = true;
    }
    // "tema_emergente" queda en el transcript_digest que arma el llamador; esta
    // capa no origina contenido clinico a partir de un tema que el paciente trajo.
  }

  const stallCount = huboProgreso ? 0 : huboRetroceso ? estado.stall_count + 1 : estado.stall_count;
  const retroactiveCycle = stallCount >= frame.policy.stall_window;
  const globalState = huboProgreso
    ? clamp(estado.global_state + 1)
    : huboRetroceso
      ? clamp(estado.global_state - 1)
      : estado.global_state;

  const huboBanderaRoja = redFlag !== null && estado.red_flag === null;
  const decision = elegirActo(unidades, estado.orden, redFlag !== null, retroactiveCycle, ultimaUnidadTocada);

  const terminado = redFlag !== null || decision === null || turno >= frame.policy.max_turns || todoPendienteResuelto(unidades);

  let say: string | null = null;
  if (decision && !terminado) {
    say = await motor.render({
      act: { act: decision.act, unit_id: decision.unit_id, ...(decision.hint !== undefined ? { hint: decision.hint } : {}) },
      state: sessionState(estado),
    });
  } else if (redFlag !== null) {
    say = null; // interrupcion prioritaria: el llamador debe invocar escalateNow, no seguir el guion normal.
  }

  const nuevoEstado: EstadoConversacion = {
    ...estado,
    phase: terminado ? "F5" : "F2",
    turno,
    global_state: globalState,
    retroactive_cycle: retroactiveCycle && !huboBanderaRoja,
    speaker_role: speakerRole,
    unidades,
    transcript: say ? [...transcript, { turno, texto: say, hablante: "agente" as const }] : transcript,
    red_flag: redFlag,
    stall_count: retroactiveCycle ? 0 : stallCount,
    ultima_unidad_tocada: ultimaUnidadTocada,
    ultimo_acto: decision,
  };

  return { estado: nuevoEstado, say, acto: decision };
}

/**
 * §16 — cierre POR CORTE, no por criterio de suficiencia (eso es del decisor).
 * Todo lo que siga pendiente se cierra con `causa` (tipicamente "interrumpido"
 * cuando se acaba el presupuesto, o "bloqueado_por_urgencia" cuando una bandera
 * roja corta el guion). Nunca se salta a "cubierta": nadie produjo ese cierre.
 */
export function cerrarPendientesPorCorte(estado: EstadoConversacion, causa: UnitCause): EstadoConversacion {
  const unidades = new Map(estado.unidades);
  for (const [id, u] of unidades) {
    if (estaCerrada(u)) continue;
    unidades.set(id, {
      ...u,
      extraction: "suspendida",
      cause: causa,
      closure: causa === "interrumpido" || causa === "bloqueado_por_urgencia" ? "corte" : u.closure,
      tocada: true,
    });
  }
  return { ...estado, phase: "F5", unidades };
}

/** El marco hidratado, proyectado a `UnitResult[]` — lo que sube al decisor (§15.1). */
export function unidadesParaEntrega(estado: EstadoConversacion): UnitResult[] {
  return estado.orden
    .map((id) => estado.unidades.get(id))
    .filter((u): u is UnidadInterna => !!u)
    .map((u) => ({
      id: u.spec.id,
      extraction: u.extraction,
      state: u.state,
      state_trace: u.state_trace,
      raw: u.raw,
      normalized: u.normalized,
      confidence: u.confidence,
      coverage_met: u.coverage_met,
      ...(u.cause !== undefined ? { cause: u.cause } : {}),
      ...(u.closure !== undefined ? { closure: u.closure } : {}),
      ...(u.blocked_by !== undefined ? { blocked_by: u.blocked_by } : {}),
      turn_refs: u.turn_refs,
    }));
}

/** Digest literal del transcript (ADR-004 a nivel de conversacion completa, §15.1). */
export function transcriptDigest(estado: EstadoConversacion, maxChars = 600): string {
  return estado.transcript.map((t) => t.texto).join(" | ").slice(0, maxChars);
}
