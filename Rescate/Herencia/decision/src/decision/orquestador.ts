/**
 * WO-42 + WO-44 — el lado servidor de `DecisionPort`, y el ponderador cableado.
 *
 * ============ Ningun camino termina sin `Decision` ============
 *
 * Cada `catch`, cada guarda y cada retorno temprano de este archivo responde por
 * donde sale la `Decision`. Los caminos de ADR-014 NO pasan por la tabla OR: la
 * degradacion no es un voto, es un cortocircuito hacia la alerta. Y `escalateNow` ni
 * siquiera espera al bucle.
 *
 * Los cuatro cierres convergen en `CallSummary` (ADR-016): no existe salida del flujo
 * que no ensamble y entregue.
 *
 * ==============================================================
 */

import {
  type ContextFrame,
  type Decision,
  type DecisionEngine,
  type DecisionPort,
  type DeterministicPort,
  type EscalationRequest,
  type FrameRequest,
  type FrameSubmission,
  type FrameVerdict,
  type KnowledgePort,
  type ReasonCode,
  type RetrievedChunk,
  type SummaryDestination,
  type SummarySinkPort,
  type Vote,
} from "@techsphere/contracts";

import { buildFrame, buildFrameDelta, buildFrameGenerico, type BaseDeMarco } from "../marco/buildFrame.ts";
import { cargarLexico } from "../marco/lexico.ts";
import { huecosDeEvidencia, type HuecoDeEvidencia } from "../conocimiento/respaldo.ts";
import { decisionPorContextoIncompleto, decisionPorDegradacion, hayQueReabrir, leerMarco } from "../seguridad/completitud.ts";
import { Ledger } from "./ledger.ts";
import { ensamblarResumen, type VersionesDelResumen } from "./resumen.ts";
import { coberturaSuficiente, ponderar } from "./ponderador.ts";
import { leerVotoDeterminista, VD_VERSION } from "./vd.ts";

/**
 * Presupuesto de rondas. Vive en el DECISOR y no en `FramePolicy` (correccion X-4):
 * la conversacional no debe saber en que ronda va, porque conocerlo le permitiria
 * modular su insistencia segun un presupuesto que por diseño no ve.
 */
export const MAX_RONDAS = 2;

export interface Sesion {
  ledger: Ledger;
  base: BaseDeMarco | null;
  frame: ContextFrame | null;
  identity: FrameRequest["identity"];
  cerrada: boolean;
}

export interface DependenciasDelDecisor {
  rag: KnowledgePort;
  /**
   * Expansion de consulta filtrada por el propio corpus. Se declara como dependencia
   * en vez de exigirsela al puerto: `KnowledgePort` transporta `retrieve` y nada mas,
   * y meterle la expansion lo ataria a una estrategia concreta — que es justo lo que
   * el puerto existe para evitar. Si no se pasa, la consulta va sin expandir.
   */
  expandir?(base: string, terminos: readonly string[]): string;
  determinista: DeterministicPort;
  motor: DecisionEngine;
  /** Resuelve la identidad a lo que puede cruzar al marco. `null` si no hay caso. */
  proyectar(patient_ref: string): BaseDeMarco;
  /**
   * Entrega el resumen a sus destinos (WO-45b). Opcional para que las pruebas del
   * bucle no necesiten disco, pero en produccion siempre esta: ADR-016 dice que
   * ninguna sesion termina sin `CallSummary`, y un resumen que no se entrega a
   * ninguna parte cumple la letra y no el proposito.
   */
  sink?: SummarySinkPort;
  embedding_model: string;
}

export class Orquestador implements DecisionPort {
  private readonly sesiones = new Map<string, Sesion>();
  private readonly dep: DependenciasDelDecisor;

  constructor(dependencias: DependenciasDelDecisor) {
    this.dep = dependencias;
  }

  sesion(session_id: string): Sesion {
    let s = this.sesiones.get(session_id);
    if (!s) {
      s = {
        ledger: new Ledger(session_id),
        base: null,
        frame: null,
        identity: { status: "unverified", patient_ref: null, speaker_role: "desconocido" },
        cerrada: false,
      };
      this.sesiones.set(session_id, s);
    }
    return s;
  }

  // -------------------------------------------------------------------------
  // F1 — identidad resuelta -> catalogo de unidades a hidratar
  // -------------------------------------------------------------------------

  async requestFrame(req: FrameRequest): Promise<ContextFrame> {
    const s = this.sesion(req.session_id);
    s.identity = req.identity;
    s.ledger.anotar({
      tipo: "identidad",
      status: req.identity.status,
      patient_ref: req.identity.patient_ref,
    });

    // Con identidad no verificada, marco GENERICO y la bandera viaja en
    // `SessionState.identity` hasta el ponderador. La llamada sigue adelante: el
    // tratamiento clinico de `unverified` es contenido del director (WO-47 §7); la
    // plomeria no.
    if (req.identity.status !== "identificado" || req.identity.patient_ref === null) {
      const frame = buildFrameGenerico(req.session_id);
      s.frame = frame;
      s.base = null;
      s.ledger.anotar({ tipo: "marco_emitido", frame });
      return frame;
    }

    const base = this.dep.proyectar(req.identity.patient_ref);
    const frame = buildFrame(base, req.session_id, { round: 0 });
    s.base = base;
    s.frame = frame;
    s.ledger.anotar({ tipo: "marco_emitido", frame });
    return frame;
  }

  // -------------------------------------------------------------------------
  // F3 — marco hidratado -> veredicto de suficiencia GLOBAL
  // -------------------------------------------------------------------------

  async submitFrame(req: FrameSubmission): Promise<FrameVerdict> {
    const s = this.sesion(req.session_id);
    const frame = s.frame;
    if (!frame) {
      // Ni siquiera esto sale por una excepcion: no hay camino sin `Decision`.
      return {
        status: "sufficient",
        decision: this.cerrar(s, decisionPorDegradacion({
          reason_code: "falla_tecnica",
          motivo: "submitFrame llego sin marco previo: F1 no ocurrio para esta sesion.",
        }), "degradacion"),
      };
    }

    s.ledger.anotar({ tipo: "marco_hidratado", round: req.round, units: req.units });

    // --- ADR-022: el predicado primero, y solo hacia `need_more` ---
    const lectura = leerMarco(frame, req.units);
    const puedeOtraRonda = req.round < MAX_RONDAS;

    if (hayQueReabrir(lectura) && puedeOtraRonda) {
      const reabrir = lectura.reabribles.map((f) => f.unit_id);
      s.ledger.anotar({
        tipo: "suficiencia",
        round: req.round,
        sufficient: false,
        por: "predicado",
        // La explicabilidad que ADR-022 promete: NOMBRA la unidad que faltaba, en vez
        // de una decision del modelo sin desglose.
        detalle: lectura.reabribles.map((f) => f.detalle).join(" "),
      });
      const delta = buildFrameDelta(
        s.base ?? { patient_ref: frame.patient_ref, unit_ids: frame.units.map((u) => u.id), dia_postop: 0 },
        req.session_id,
        reabrir,
        req.round + 1,
      );
      s.frame = delta;
      return { status: "need_more", frame_delta: delta };
    }

    // --- El modelo solo desempata, y NUNCA lo llama el predicado a `sufficient` ---
    if (lectura.completo && puedeOtraRonda) {
      let veredicto;
      try {
        veredicto = await this.dep.motor.assessSufficiency({
          frame,
          units: req.units,
          session_state: req.session_state,
          transcript_digest: req.transcript_digest,
        });
      } catch (e) {
        return {
          status: "sufficient",
          decision: this.cerrar(s, decisionPorDegradacion({
            reason_code: "falla_tecnica",
            motivo: `El decisor no pudo juzgar suficiencia: ${(e as Error).message}`,
          }), "degradacion"),
        };
      }
      s.ledger.anotar({
        tipo: "suficiencia",
        round: req.round,
        sufficient: veredicto.sufficient,
        por: "modelo",
        detalle: veredicto.sufficient ? "marco completo y el decisor lo acepta" : `el decisor pide ${veredicto.reopen_unit_ids.join(", ")}`,
      });

      if (!veredicto.sufficient) {
        // Saneamiento, igual que con `doc_ids` (C-2): un id que el marco no declaro
        // produciria un delta fantasma que falla mas adelante y lejos del origen.
        const declarados = new Set(frame.units.map((u) => u.id));
        const reabrir = veredicto.reopen_unit_ids.filter((id) => declarados.has(id));
        if (reabrir.length > 0) {
          const delta = buildFrameDelta(
            s.base ?? { patient_ref: frame.patient_ref, unit_ids: [...declarados], dia_postop: 0 },
            req.session_id,
            reabrir,
            req.round + 1,
          );
          s.frame = delta;
          return { status: "need_more", frame_delta: delta };
        }
      }
    }

    // --- Agotado el presupuesto sin cerrar: hay decision igual (ADR-014) ---
    if (!lectura.completo) {
      return {
        status: "sufficient",
        decision: this.cerrar(s, decisionPorContextoIncompleto(lectura, req.round + 1), "degradacion"),
      };
    }

    return { status: "sufficient", decision: await this.decidir(s, req) };
  }

  // -------------------------------------------------------------------------
  // WO-44 — los dos votos y la tabla OR
  // -------------------------------------------------------------------------

  private async decidir(s: Sesion, req: FrameSubmission): Promise<Decision> {
    const frame = s.frame!;

    // --- RAG: la evidencia entra SOLO por el camino de decision (ADR-019) ---
    const evidencia: RetrievedChunk[] = [];
    const huecos: HuecoDeEvidencia[] = [];
    const consultas = [];
    for (const unidad of req.units) {
      const spec = frame.units.find((u) => u.id === unidad.id);
      const texto = this.consultaDeUnidad(unidad, spec);
      let r: RetrievedChunk[] = [];
      try {
        r = this.dep.rag.retrieve({ text: texto, k: 2 });
      } catch {
        consultas.push({ unit_id: unidad.id, resultados: [], consultada: false });
        continue;
      }
      consultas.push({ unit_id: unidad.id, resultados: r });
      evidencia.push(...r);
      s.ledger.anotar({
        tipo: "rag",
        unit_id: unidad.id,
        doc_ids: [...new Set(r.map((c) => c.doc_id))],
        chunks: r.length,
      });
    }
    huecos.push(...huecosDeEvidencia(consultas));

    // --- VP ---
    let vp: Vote;
    let docIdsVP: string[];
    try {
      const emitido = await this.dep.motor.emitVote({
        frame,
        units: req.units,
        session_state: req.session_state,
        transcript_digest: req.transcript_digest,
        evidence: evidencia,
      });
      vp = emitido.vote;
      // Saneamiento obligatorio (H5): solo se aceptan `doc_id` presentes en lo
      // efectivamente recuperado. Una traza que no resuelve a un documento real es
      // peor que una traza vacia, y esto se verifica contra la fuente delante del jurado.
      const recuperados = new Set(evidencia.map((c) => c.doc_id));
      docIdsVP = [...new Set(emitido.doc_ids.filter((d) => recuperados.has(d)))];
    } catch (e) {
      return this.cerrar(s, decisionPorDegradacion({
        reason_code: "falla_tecnica",
        motivo: `El VP no pudo emitirse: ${(e as Error).message}`,
      }), "degradacion", huecos);
    }
    s.ledger.anotar({ tipo: "voto_vp", vote: vp, doc_ids: docIdsVP });

    // --- Determinista + VD ---
    let vd: Vote;
    let vdRule: string;
    let rulesFired: string[];
    let cobertura;
    try {
      const reporte = this.dep.determinista.evaluate({
        session_id: req.session_id,
        frame_id: frame.frame_id,
        units: req.units,
        modifiers: { dia_postop: s.base?.dia_postop ?? null },
        domain_version: this.dep.determinista.describeDomain().domain_version,
      });
      s.ledger.anotar({ tipo: "reporte_determinista", report: reporte });

      // "Si dices que evaluaste, enseña el trabajo." Evaluar seis unidades y no
      // hallar nada es un resultado afirmativo; evaluar CERO es un fallo, y sin esta
      // guarda una determinista que devuelve vacio seria indistinguible de un verde
      // limpio. Dos cosas distintas no pueden tener la misma representacion.
      if (reporte.coverage.evaluadas.length === 0) {
        throw new Error(
          "la determinista no evaluo ninguna unidad: " +
            `${reporte.coverage.no_evaluadas.map((n) => `${n.unit_id} (${n.causa})`).join(", ") || "sin detalle"}`,
        );
      }

      const lecturaVD = leerVotoDeterminista(reporte);
      vd = lecturaVD.vote;
      vdRule = lecturaVD.vd_rule;
      rulesFired = lecturaVD.rules_fired;
      cobertura = coberturaSuficiente(
        reporte,
        frame.units.filter((u) => u.priority === "required").map((u) => u.id),
      );
    } catch (e) {
      return this.cerrar(s, decisionPorDegradacion({
        reason_code: "falla_tecnica",
        motivo: `La capa determinista o su lectura fallaron: ${(e as Error).message}`,
        traces: { doc_ids: docIdsVP, rules_fired: [] },
      }), "degradacion", huecos);
    }
    s.ledger.anotar({ tipo: "voto_vd", vote: vd, vd_rule: vdRule, rules_fired: rulesFired });

    // --- La tabla OR ---
    const p = ponderar(vp, vd);

    // --- Cobertura ANTES del silencio (spec §10) ---
    if (!p.escalate && !cobertura.suficiente) {
      return this.cerrar(s, decisionPorDegradacion({
        reason_code: "contexto_incompleto",
        motivo:
          `Los dos votos callan, pero ${cobertura.no_evaluadas.join(", ")} no se evaluo. ` +
          `Unidades required sin evaluar convierten el caso en incompletud, no en silencio: ` +
          `el falso negativo por omision queda bloqueado por regla y no por criterio.`,
        traces: { doc_ids: docIdsVP, rules_fired: rulesFired },
      }), "degradacion", huecos);
    }

    const decision: Decision = {
      escalate: p.escalate,
      criticality: p.criticality,
      reason: p.reason,
      reason_code: p.reason_code as ReasonCode,
      say_to_patient: hablarleAlPaciente(p.criticality, p.escalate),
      traces: { doc_ids: docIdsVP, rules_fired: rulesFired },
      context_complete: true,
    };
    return this.cerrar(s, decision, "or", huecos);
  }

  /**
   * La consulta al RAG por unidad. **Se arma como se midio, y se mide como se corre.**
   *
   * ============ Por que NO lleva `intent` ni `raw` ============
   *
   * La primera version concatenaba `unit_id + intent + raw` y producia huecos de
   * evidencia en unidades que SI tienen material. Medido sobre `aspecto_herida`:
   *
   *   id + intent + raw  ->  12 terminos dispersos  ->  0 resultados
   *   id + normalized + expansion filtrada  ->  3 resultados (36,1 / 27,5 / 26,6)
   *
   * `intent` es prosa dirigida a la conversacional —"saber como se ve y como se
   * siente la herida"— y sus palabras si existen en el corpus, asi que el problema no
   * es ruido imposible: es DILUCION. Doce terminos repartidos entre siete temas hacen
   * que ningun fragmento case una fraccion suficiente, y el piso —que es correcto—
   * acaba midiendo una consulta que no deberia existir.
   *
   * `raw` es habla de paciente contra literatura clinica, que es exactamente el
   * desajuste de registro que obligo a filtrar el lexico por frecuencia documental en
   * vez de expandir a ciegas.
   *
   * Lo que queda es lo que se midio: el id canonico, el valor normalizado, y los
   * terminos del lexico que el propio corpus conoce y que discriminan.
   *
   * ============================================================
   */
  private consultaDeUnidad(unidad: { id: string; normalized: unknown }, spec: { lexicon?: { synonyms?: Record<string, string[]>; requires_precision?: string[] } } | undefined): string {
    const base = `${unidad.id} ${unidad.normalized === null || unidad.normalized === undefined ? "" : String(unidad.normalized)}`.trim();
    const terminos = [
      ...Object.values(spec?.lexicon?.synonyms ?? {}).flat(),
      ...(spec?.lexicon?.requires_precision ?? []),
    ];
    return this.dep.expandir ? this.dep.expandir(base, terminos) : base;
  }

  // -------------------------------------------------------------------------
  // Urgencia — `Decision` DIRECTAMENTE, sin bucle y sin determinista
  // -------------------------------------------------------------------------

  async escalateNow(req: EscalationRequest): Promise<Decision> {
    const s = this.sesion(req.session_id);

    // ============ Lo explorado NO se tira: se cierra con su causa ============
    //
    // `units_so_far` viaja en la peticion y antes se descartaba, asi que el resumen de
    // una urgencia salia con `findings: []` — indistinguible de una llamada donde no se
    // habia preguntado nada. Son dos cosas distintas y no pueden tener la misma forma.
    //
    // Lo que quedo sin explorar se cierra como `bloqueado_por_urgencia`, que NO es
    // `no_sabe` ni `interrumpido`: dice que quedo explicitamente fuera porque hubo una
    // urgencia, y el decisor —y quien audite— lo lee distinto (§10.3). Quien atienda la
    // alerta ve lo que el paciente alcanzo a contar y sobre que no se llego a preguntar.
    // ========================================================================
    const marco = s.frame;
    if (marco !== null) {
      const recibidas = new Map(req.units_so_far.map((u) => [u.id, u]));
      const units = marco.units.map(
        (spec) =>
          recibidas.get(spec.id) ?? {
            id: spec.id,
            extraction: "suspendida" as const,
            state: 0,
            state_trace: [],
            raw: null,
            normalized: null,
            confidence: 0,
            coverage_met: [],
            cause: "bloqueado_por_urgencia" as const,
            closure: "corte" as const,
            turn_refs: [],
          },
      );
      s.ledger.anotar({ tipo: "marco_hidratado", round: 0, units });
    } else if (req.units_so_far.length > 0) {
      // Urgencia antes de que hubiera marco: se conserva igual lo que se alcanzo a oir.
      s.ledger.anotar({ tipo: "marco_hidratado", round: 0, units: [...req.units_so_far] });
    }

    const decision: Decision = {
      escalate: true,
      criticality: "rojo",
      reason: `Red flag ${req.red_flag_id} sobre el enunciado literal: ${JSON.stringify(req.utterance)}.`,
      reason_code: "urgencia",
      say_to_patient:
        "Lo que me acaba de contar necesita atencion ya. Voy a pasar su caso al personal en este momento; no cuelgue.",
      // En urgencia no hay votos: ni doc_ids ni rules_fired. El contrato lo verifica.
      traces: { doc_ids: [], rules_fired: [] },
      context_complete: false,
    };
    return this.cerrar(s, decision, "urgencia");
  }

  // -------------------------------------------------------------------------

  /** ADR-016 — NINGUNA SESION SIN `CallSummary`. Los cuatro cierres pasan por aqui. */
  private cerrar(
    s: Sesion,
    decision: Decision,
    branch: "or" | "degradacion" | "urgencia",
    huecos: readonly HuecoDeEvidencia[] = [],
  ): Decision {
    s.ledger.anotar({ tipo: "decision", decision, branch });
    s.cerrada = true;

    const versions: VersionesDelResumen = {
      domain_version: this.dep.determinista.describeDomain().domain_version,
      vd_version: VD_VERSION,
      embedding_model: this.dep.embedding_model,
    };

    const resumen = ensamblarResumen(s.ledger, {
      decision,
      branch,
      identity_status: s.identity.status,
      versions,
      ...(huecos.length > 0 ? { evidence_gaps: huecos } : {}),
    });

    // La politica de destinos: el archivo SIEMPRE, el canal cuando escala.
    const destinos: SummaryDestination[] = decision.escalate
      ? ["session_archive", "alert_channel"]
      : ["session_archive"];

    const recibo = this.dep.sink?.deliver(resumen, destinos);
    // Que un destino falle NO cambia la decision ni la retiene: la alerta ya se emitio
    // con la `Decision`, y el resumen ya esta en el archivo. Se anota y se sigue.
    if (recibo && recibo.failed.length > 0) {
      s.ledger.anotar({
        tipo: "entrega_fallida",
        destinos: recibo.failed,
        entregados: recibo.delivered,
      });
    }

    return decision;
  }

  /** Para pruebas y para el informe: la sesion reconstruida ronda a ronda. */
  ledgerDe(session_id: string): Ledger {
    return this.sesion(session_id).ledger;
  }
}

/**
 * Lo que la conversacional debe COMUNICAR. El decisor entrega la SUSTANCIA; la voz y
 * el tono son de la conversacional, y el `reason` tecnico —que lleva las lecturas de
 * los dos votos— no se verbaliza tal cual.
 */
function hablarleAlPaciente(criticality: string, escalate: boolean): string {
  if (!escalate) {
    return "Por lo que me cuenta, su recuperacion va como se espera. Siga con los cuidados y cualquier cambio nos llama.";
  }
  if (criticality === "rojo") {
    return "Lo que me describe hay que revisarlo pronto. Voy a pasar su caso al personal para que lo contacten hoy mismo.";
  }
  return "Lo que me cuenta conviene que lo mire alguien del equipo. Voy a dejar su caso anotado para que lo llamen y le hagan seguimiento.";
}

/** Se carga al construir para que un lexico roto falle al arrancar, no en el turno. */
export function precalentarLexico(): void {
  cargarLexico();
}
