/**
 * `DecisionEngine` REAL sobre la ruta primaria. El enchufe de WO-47 §1.
 *
 * ============ Que tuvo que cambiar para enchufarlo ============
 *
 * Nada fuera de este archivo. El orquestador recibe `motor: DecisionEngine` por
 * construccion, asi que sustituir el guion por esto es una linea en el cableado.
 * Ni el ponderador, ni la tabla VD, ni los puertos, ni el ensamblador se enteran —
 * que es lo que el aislamiento del modelo prometia desde ADR-002, y es falsable:
 * si hubiera hecho falta tocar cualquiera de ellos, la forma estaba mal.
 *
 * ==============================================================
 *
 * ADR-023 — PREFIJO ESTABLE primero, COLA VOLATIL al final. El prefijo lleva el rol,
 * los criterios y la evidencia recuperada; la cola lleva las unidades de ESTA sesion.
 * El adaptador lo impone por firma y aqui solo hay que respetar de que lado va cada
 * cosa.
 *
 * H4 — el campo de RAZONAMIENTO va declarado PRIMERO en el esquema. Medido en la
 * rebanada: con el veredicto primero, el modelo decide a ciegas y luego justifica lo
 * que ya dijo, y produjo `escalate: false` con `reason: ""` — un falso negativo mudo,
 * que es la falla catastrofica que la rubrica nombra.
 */

import type {
  DecisionEngine,
  DecisionEngineInput,
  ProbabilisticVote,
  RetrievedChunk,
  SufficiencyAssessment,
  ValidationResult,
} from "@techsphere/contracts";
import type { AdaptadorNube } from "./nube.ts";

// ---------------------------------------------------------------------------
// Esquemas y validadores. La garantia la da el validador, no el decodificador (B2).
// ---------------------------------------------------------------------------

const ESQUEMA_SUFICIENCIA = {
  type: "object",
  properties: {
    falta: { type: "string", maxLength: 200 },
    sufficient: { type: "boolean" },
    reopen_unit_ids: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 6 },
  },
  required: ["falta", "sufficient", "reopen_unit_ids"],
} as const;

const ESQUEMA_VOTO = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 20, maxLength: 280 },
    criticality: { type: "string", enum: ["verde", "amarillo", "rojo"] },
    escalate: { type: "boolean" },
    doc_ids: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
  },
  required: ["reason", "criticality", "escalate", "doc_ids"],
} as const;

function problema(path: string, message: string, hint: string): ValidationResult["issues"][number] {
  return { path, code: "tipo_invalido", message, hint };
}

function validarSuficiencia(crudo: unknown): ValidationResult {
  const o = crudo as Record<string, unknown> | null;
  const issues: ValidationResult["issues"] = [];
  if (typeof o?.["sufficient"] !== "boolean") {
    issues.push(problema("sufficient", "No es booleano.", "El veredicto de suficiencia es si o no."));
  }
  if (!Array.isArray(o?.["reopen_unit_ids"])) {
    issues.push(problema("reopen_unit_ids", "No es un arreglo.", "Vacio si no hay que reabrir nada, pero la clave debe existir."));
  }
  return { valid: issues.length === 0, issues };
}

function validarVoto(crudo: unknown): ValidationResult {
  const o = crudo as Record<string, unknown> | null;
  const issues: ValidationResult["issues"] = [];
  if (typeof o?.["reason"] !== "string" || (o["reason"] as string).trim().length < 10) {
    issues.push(
      problema("reason", "Falta la razon o es demasiado corta.", "Toda decision se explica: la razon es campo de auditoria."),
    );
  }
  if (!["verde", "amarillo", "rojo"].includes(String(o?.["criticality"]))) {
    issues.push(problema("criticality", `Llego ${JSON.stringify(o?.["criticality"])}.`, "Es la lectura ternaria de ADR-018."));
  }
  if (typeof o?.["escalate"] !== "boolean") {
    issues.push(problema("escalate", "No es booleano.", "Es la ACCION, y lo unico sobre lo que opera el ponderador."));
  }
  if (!Array.isArray(o?.["doc_ids"])) {
    issues.push(problema("doc_ids", "No es un arreglo.", "Los documentos citados. Vacio es valido; ausente no."));
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------

/**
 * El PREFIJO ESTABLE. Byte a byte identico entre llamadas del mismo rol: aqui no se
 * interpola ni el `session_id` ni la hora ni nada que cambie por turno.
 *
 * Lo que NO dice: ningun umbral clinico. El modelo no recibe "38.5 es fiebre" — si lo
 * recibiera, estaria repitiendo un criterio nuestro en vez de leer la evidencia, y la
 * rebanada ya lo vio anclarse al listado de criterios del prefijo y reportarlo como
 * si fuera el cuadro del paciente (H4).
 */
const PREFIJO_DECISOR = [
  "Eres el decisor clinico de un agente de seguimiento post-operatorio telefonico.",
  "",
  "Tu tarea es leer lo que el paciente reporto y emitir un voto sobre si su caso debe",
  "pasar a una persona del equipo de salud.",
  "",
  "Reglas que no se negocian:",
  "- Si el paciente NIEGA un sintoma, ese sintoma NO esta presente.",
  "- No inventes valores que el paciente no dijo. Un dato ausente es ausente.",
  "- Cita unicamente documentos de la EVIDENCIA que se te entrega, por su doc_id exacto.",
  "- Ante la duda, escalar cuesta la revision de un humano; no escalar puede costar un paciente.",
].join("\n");

const PREFIJO_SUFICIENCIA = [
  "Eres el decisor clinico de un agente de seguimiento post-operatorio telefonico.",
  "",
  "Se te entrega el estado de las unidades de informacion de una llamada. Tu tarea es",
  "decidir si el cuadro esta lo bastante completo para emitir un juicio, o si conviene",
  "volver a preguntar por alguna unidad concreta.",
  "",
  "Completitud estructural no es suficiencia clinica: un marco puede estar completo y",
  "aun asi merecer otra ronda —un dolor alto reportado con mala calidad de extraccion,",
  "una unidad cubierta con dependencias abiertas—. Ese juicio es tuyo.",
].join("\n");

function describirUnidades(req: DecisionEngineInput): string {
  return req.units
    .map((u) => {
      const spec = req.frame.units.find((s) => s.id === u.id);
      const valor = u.normalized === null ? "(sin valor normalizado)" : JSON.stringify(u.normalized);
      return (
        `- ${u.id}: ${valor}` +
        ` | literal: ${u.raw === null ? "(no dijo nada)" : JSON.stringify(u.raw)}` +
        ` | extraccion: ${u.extraction} | salud: ${u.state} | fidelidad: ${u.confidence}` +
        (spec ? ` | se pedia: ${spec.intent}` : "")
      );
    })
    .join("\n");
}

function describirEvidencia(evidence: readonly RetrievedChunk[]): string {
  if (evidence.length === 0) {
    // Se dice que no hay, en vez de omitir el bloque: un prefijo que a veces tiene
    // seccion y a veces no cambia byte a byte y rompe la cache (ADR-023).
    return "(sin evidencia recuperada para este caso)";
  }
  return evidence
    .map((c) => `[${c.doc_id}] ${c.text.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n\n");
}

export class DecisionEngineNube implements DecisionEngine {
  private readonly adaptador: AdaptadorNube;

  constructor(adaptador: AdaptadorNube) {
    this.adaptador = adaptador;
  }

  async assessSufficiency(req: DecisionEngineInput): Promise<SufficiencyAssessment> {
    const r = await this.adaptador.generarEstructurado<{
      sufficient: boolean;
      reopen_unit_ids: string[];
    }>({
      rol: "decider",
      sistema: PREFIJO_SUFICIENCIA,
      prompt: [
        "ESTADO DE LAS UNIDADES",
        describirUnidades(req),
        "",
        `SALUD DE LA SESION: global ${req.session_state.global}, marco ${req.session_state.frame_health}`,
        `RESUMEN LITERAL: ${req.transcript_digest}`,
      ].join("\n"),
      esquema: ESQUEMA_SUFICIENCIA,
      validar: validarSuficiencia,
      max_tokens: 200,
    });

    return { sufficient: r.valor.sufficient, reopen_unit_ids: r.valor.reopen_unit_ids };
  }

  async emitVote(req: DecisionEngineInput & { evidence: RetrievedChunk[] }): Promise<ProbabilisticVote> {
    const r = await this.adaptador.generarEstructurado<{
      reason: string;
      criticality: "verde" | "amarillo" | "rojo";
      escalate: boolean;
      doc_ids: string[];
    }>({
      rol: "decider",
      // La evidencia va en el PREFIJO: es lo mas grande del prompt y lo que mas
      // gana con la cache cuando dos casos parecidos recuperan lo mismo.
      sistema: `${PREFIJO_DECISOR}\n\nEVIDENCIA RECUPERADA\n${describirEvidencia(req.evidence)}`,
      prompt: [
        "LO QUE REPORTO EL PACIENTE",
        describirUnidades(req),
        "",
        `RESUMEN LITERAL: ${req.transcript_digest}`,
        "",
        "Emite tu voto: primero la razon, despues la criticidad, despues si escala.",
      ].join("\n"),
      esquema: ESQUEMA_VOTO,
      validar: validarVoto,
      max_tokens: 400,
    });

    return {
      vote: {
        escalate: r.valor.escalate,
        criticality: r.valor.criticality,
        reason: r.valor.reason,
      },
      // Sin sanear aqui: el saneamiento contra lo efectivamente recuperado lo hace el
      // orquestador (H5), y hacerlo dos veces esconderia cual de los dos funciona.
      doc_ids: r.valor.doc_ids,
    };
  }
}
