/**
 * El motor de estados de la capa CONVERSACIONAL — §9 de la especificacion heredada
 * (no llegada en la copia; implementado contra `contracts/src/conversational.ts`,
 * que es la especificacion efectiva segun Estafeta-Plan-de-Trabajo.md §5.1).
 *
 * Aritmetica pura: sin red, sin reloj, sin modelo. Recibe lo que el modelo YA
 * detecto (`EngineExtraction[]`, `EngineSignal[]`) y decide como se mueve el
 * estado de cada unidad. El modelo detecta; este archivo interpreta.
 *
 * Regla de oro citada en el contrato y que gobierna todo lo de aqui: "si el
 * paciente no lo dijo, no existe". Ninguna funcion de este archivo inventa un
 * `normalized` que no vino de una extraccion real.
 */

import type {
  ConversationalAct,
  CoverageDimension,
  EngineExtraction,
  NormalizedValue,
  UnitCause,
  UnitClosure,
  UnitExtraction,
  UnitSpec,
} from "@techsphere/contracts";
import { STATE_MAX, STATE_MIN } from "@techsphere/contracts";

/** Tabla de §10.2, ejecutable — la misma que valida `@techsphere/contracts`. */
export const CAUSAS_POR_CIERRE: Record<UnitClosure, readonly UnitCause[]> = {
  declarado: ["no_sabe", "no_aplica", "rehusa"],
  degradacion: ["no_comprende", "incoherente", "sin_respuesta"],
  corte: ["interrumpido", "bloqueado_por_urgencia"],
};

export function cierreDeCausa(causa: UnitCause): UnitClosure {
  for (const [cierre, causas] of Object.entries(CAUSAS_POR_CIERRE)) {
    if ((causas as readonly UnitCause[]).includes(causa)) return cierre as UnitClosure;
  }
  throw new Error(`Causa sin cierre declarado: ${causa}. Revisa CAUSAS_POR_CIERRE.`);
}

export function clamp(n: number, min = STATE_MIN, max = STATE_MAX): number {
  return Math.max(min, Math.min(max, n));
}

/** Una unidad tal como vive DENTRO del motor, antes de proyectarse a `UnitResult`. */
export interface UnidadInterna {
  spec: UnitSpec;
  extraction: UnitExtraction;
  state: number;
  state_trace: number[];
  raw: string | null;
  normalized: NormalizedValue;
  confidence: number;
  coverage_met: CoverageDimension[];
  cause?: UnitCause | undefined;
  closure?: UnitClosure | undefined;
  blocked_by?: string[] | undefined;
  turn_refs: number[];
  /** Cuantas veces se le pregunto sin exito. Gobierna cuando se rinde el motor (no la spec: eso seria max_rounds del decisor, prohibido aqui). */
  intentos_sin_exito: number;
  /**
   * Interno, NUNCA cruza a `UnitResult`. `UnitExtraction` no tiene un valor para
   * "todavia no se le pregunto" — sus cuatro valores son estados de CIERRE o de
   * evidencia parcial. Sin esta bandera, una unidad recien creada (`extraction:
   * "suspendida"` por default) seria indistinguible de una que el motor YA cerro
   * por agotamiento, y `elegirActo`/`cerrarPendientesPorCorte` la tratarian como
   * cerrada antes de haberla tocado.
   */
  tocada: boolean;
}

export function unidadVacia(spec: UnitSpec): UnidadInterna {
  return {
    spec,
    extraction: "suspendida",
    state: 0,
    state_trace: [],
    raw: null,
    normalized: null,
    confidence: 0,
    coverage_met: [],
    turn_refs: [],
    intentos_sin_exito: 0,
    tocada: false,
    ...(spec.depends_on && spec.depends_on.length > 0 ? { blocked_by: [...spec.depends_on] } : {}),
  };
}

/** Cerrada de verdad: cubierta (con o sin condicion) o suspendida CON CAUSA. Una unidad recien creada no cuenta, aunque su `extraction` por defecto sea "suspendida". */
export function estaCerrada(u: UnidadInterna): boolean {
  if (u.extraction === "cubierta" || u.extraction === "cubierta_condicionada") return true;
  return u.extraction === "suspendida" && u.tocada;
}

export function coberturaCompleta(spec: UnitSpec, coverageMet: readonly CoverageDimension[]): boolean {
  return spec.coverage.requires.every((d: CoverageDimension) => coverageMet.includes(d));
}

export function unionCobertura(
  actual: readonly CoverageDimension[],
  nueva: readonly CoverageDimension[],
): CoverageDimension[] {
  return [...new Set([...actual, ...nueva])];
}

/**
 * Aplica UNA extraccion del modelo sobre la unidad correspondiente. Muta una
 * copia y la devuelve; no toca el turno global (eso lo hace `conducirTurno`).
 *
 * Reglas de estado (§9, en su version implementable):
 *   - cobertura completa + confianza suficiente -> +1, cierre "declarado".
 *   - `normalized: null` sin causa (toco la unidad sin cuantificarla, ADR-024:
 *     "calorcito", "molestia") -> NO se cierra, NO se inventa valor, estado sin
 *     cambio: es el protocolo de reflejo el que decide el siguiente turno.
 *   - cobertura parcial -> sin cierre, +0 (hubo progreso pero no basta).
 */
export function aplicarExtraccion(
  unidad: UnidadInterna,
  ext: EngineExtraction,
  turno: number,
  reflectBelowConfidence: number,
): UnidadInterna {
  const coverage_met = unionCobertura(unidad.coverage_met, ext.coverage_met);
  const completa = coberturaCompleta(unidad.spec, coverage_met);
  const raw = ext.raw ?? unidad.raw;
  const turn_refs = unidad.turn_refs.includes(turno) ? unidad.turn_refs : [...unidad.turn_refs, turno];

  // ADR-024 / ADR-004: la unidad se TOCO pero no se cuantifico ("calorcito").
  // El literal se guarda; el valor NO se inventa; el estado no se degrada por
  // esto solo -- es informacion, no un fracaso de extraccion.
  if (ext.normalized === null) {
    return {
      ...unidad,
      // "hidratada_sin_normalizar": hay evidencia (el raw) pero ningun valor
      // mapeable — exactamente ADR-024. Distinto de "suspendida" (que es un
      // CIERRE): la unidad sigue abierta, solo que lo dicho no cuantifica.
      extraction: "hidratada_sin_normalizar",
      raw,
      normalized: null,
      confidence: ext.confidence,
      coverage_met,
      turn_refs,
      tocada: true,
    };
  }

  if (completa && ext.confidence >= reflectBelowConfidence) {
    const condicionada = (unidad.blocked_by?.length ?? 0) > 0;
    return {
      ...unidad,
      extraction: condicionada ? "cubierta_condicionada" : "cubierta",
      state: clamp(unidad.state + 1),
      state_trace: [...unidad.state_trace, clamp(unidad.state + 1)],
      raw,
      normalized: ext.normalized,
      confidence: ext.confidence,
      coverage_met,
      ...(condicionada ? {} : { closure: "declarado" as const }),
      turn_refs,
      intentos_sin_exito: 0,
      tocada: true,
    };
  }

  // Cobertura parcial, o confianza por debajo del umbral de reflejo: hay
  // progreso pero no basta para cerrar. `hidratada_sin_normalizar` porque hay
  // evidencia (raw, un valor candidato) sin que el motor la de por buena aun.
  return {
    ...unidad,
    extraction: "hidratada_sin_normalizar",
    raw,
    normalized: ext.normalized,
    confidence: ext.confidence,
    coverage_met,
    turn_refs,
    intentos_sin_exito: unidad.intentos_sin_exito + 1,
    tocada: true,
  };
}

/**
 * Aplica una CAUSA (§10.3 — el vacio como informacion). Distinta de una
 * extraccion: no hay valor, hay un motivo tipificado para no haberlo.
 *
 * `no_sabe` / `no_aplica` / `rehusa` cierran DECLARADO de inmediato: son
 * respuestas limpias y honestas, no fracasos (comentario del validador de
 * contracts: "un cierre declarado es una extraccion EXITOSA").
 *
 * `no_comprende` / `incoherente` / `sin_respuesta` dan una segunda oportunidad
 * -- se reformula o se cambia de perspectiva -- y solo se rinden en
 * DEGRADACION (estado en -3) tras el segundo intento fallido.
 */
export function aplicarCausa(
  unidad: UnidadInterna,
  causa: UnitCause,
  turno: number,
  toleranciaReintentos: number,
): UnidadInterna {
  const turn_refs = unidad.turn_refs.includes(turno) ? unidad.turn_refs : [...unidad.turn_refs, turno];
  const cierre = cierreDeCausa(causa);

  if (cierre === "declarado") {
    return {
      ...unidad,
      extraction: "suspendida",
      state: clamp(unidad.state + 1),
      state_trace: [...unidad.state_trace, clamp(unidad.state + 1)],
      cause: causa,
      closure: "declarado",
      turn_refs,
      intentos_sin_exito: 0,
      tocada: true,
    };
  }

  // degradacion: primera vez, se reintenta; agotada la tolerancia, se rinde.
  const intentos = unidad.intentos_sin_exito + 1;
  if (intentos <= toleranciaReintentos) {
    return {
      ...unidad,
      // sigue ABIERTA (no es un cierre): "hidratada_sin_normalizar" marca que
      // hubo un intento sin resultado, sin colisionar con "suspendida" = cerrada.
      extraction: "hidratada_sin_normalizar",
      state: clamp(unidad.state - 1),
      state_trace: [...unidad.state_trace, clamp(unidad.state - 1)],
      turn_refs,
      intentos_sin_exito: intentos,
      tocada: true,
    };
  }
  return {
    ...unidad,
    extraction: "suspendida",
    state: STATE_MIN,
    state_trace: [...unidad.state_trace, STATE_MIN],
    cause: causa,
    closure: "degradacion",
    turn_refs,
    tocada: true,
    intentos_sin_exito: intentos,
  };
}

/** El siguiente acto de la tabla de transiciones (§9.6 + reflejo de §11.1/P1). */
export interface DecisionDeActo {
  act: ConversationalAct;
  unit_id: string | null;
  hint?: string;
}

/**
 * Elige el proximo acto SIN llamar al modelo: el acto lo decide el motor a
 * partir del estado, nunca el modelo (ports.ts, comentario de `ActIntent`).
 *
 * Orden de prioridad:
 *   1. Bandera roja -> `suspender` (interrupcion prioritaria, §14).
 *   2. Ciclo retroactivo (estancamiento) -> `cambiar_perspectiva`.
 *   3. Unidad recien tocada con `normalized: null` (toco, no cuantifico) ->
 *      `reflejar`, con el instrumento de precision si el lexico lo declara.
 *   4. Unidad con cobertura parcial -> `profundizar` en la dimension que falta.
 *   5. Unidad recien cerrada -> `continuar` a la siguiente pendiente.
 *   6. Nada pendiente -> `null` (fase F5).
 */
export function elegirActo(
  unidades: ReadonlyMap<string, UnidadInterna>,
  orden: readonly string[],
  huboBanderaRoja: boolean,
  cicloRetroactivo: boolean,
  ultimaUnidadTocada: string | null,
): DecisionDeActo | null {
  if (huboBanderaRoja) {
    return { act: "suspender", unit_id: ultimaUnidadTocada, hint: "interrupcion prioritaria: bandera roja" };
  }

  const pendientes = orden
    .map((id) => unidades.get(id))
    .filter((u): u is UnidadInterna => !!u)
    .filter((u) => !estaCerrada(u));

  if (ultimaUnidadTocada) {
    const u = unidades.get(ultimaUnidadTocada);
    if (u && !estaCerrada(u)) {
      if (u.normalized === null && u.raw !== null) {
        return {
          act: "reflejar",
          unit_id: u.spec.id,
          hint: u.spec.lexicon?.unit
            ? `pedir precision con instrumento (${u.spec.lexicon.unit})`
            : "pedir precision: lo que dijo el paciente no cuantifica la unidad",
        };
      }
      if (cicloRetroactivo) {
        return { act: "cambiar_perspectiva", unit_id: u.spec.id, hint: "estancamiento: preguntar desde otro angulo" };
      }
      if (u.coverage_met.length > 0 && !coberturaCompleta(u.spec, u.coverage_met)) {
        const falta = u.spec.coverage.requires.find((d: CoverageDimension) => !u.coverage_met.includes(d));
        return { act: "profundizar", unit_id: u.spec.id, hint: `falta cubrir: ${falta}` };
      }
      if (u.intentos_sin_exito > 0) {
        return { act: "reformular", unit_id: u.spec.id, hint: "el paciente no comprendio o no respondio: repreguntar distinto" };
      }
    }
  }

  const RANGO_PRIORIDAD: Record<UnitSpec["priority"], number> = { required: 0, desired: 1, opportunistic: 2 };
  const requeridasPrimero = [...pendientes].sort(
    (a: UnidadInterna, b: UnidadInterna) => RANGO_PRIORIDAD[a.spec.priority] - RANGO_PRIORIDAD[b.spec.priority],
  );

  // Las opportunistic NUNCA se preguntan de forma activa (§8.2).
  const siguiente = requeridasPrimero.find((u) => u.spec.priority !== "opportunistic");
  if (siguiente) {
    return { act: "continuar", unit_id: siguiente.spec.id, hint: siguiente.spec.intent };
  }

  return null;
}
