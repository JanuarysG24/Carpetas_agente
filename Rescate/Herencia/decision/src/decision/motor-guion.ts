/**
 * `DecisionEngine` con GUION DECLARADO. No es el modelo: es el sustituto que permite
 * cerrar el bucle sin credenciales y probarlo sin red.
 *
 * ============ Que es real aqui y que no ============
 *
 * REAL: los puertos, el bucle, el marco, la tabla VD, el ponderador, el ensamblador y
 * el saneamiento de trazas. Todo eso sobrevive intacto al enchufe del modelo.
 *
 * GUION: la suficiencia global y el VP. Sus criterios estan DECLARADOS en este
 * archivo y son deliberadamente pobres — no pretenden juicio clinico. Cuando WO-47
 * enchufe `AdaptadorNube`, esto se sustituye y nada mas cambia; si hiciera falta
 * tocar el ponderador o los puertos, la forma estaba mal.
 *
 * ⚠️ Con este motor NO se miden precision de criticidad ni los 160 casos: el VP
 * saldria de un guion y el numero induciria confianza sobre nada (H17).
 *
 * ==================================================
 */

import type {
  DecisionEngine,
  DecisionEngineInput,
  ProbabilisticVote,
  RetrievedChunk,
  SufficiencyAssessment,
} from "@techsphere/contracts";

export interface OpcionesDelGuion {
  /** Fuerza el veredicto de suficiencia. Por defecto acepta el marco completo. */
  sufficient?: boolean;
  reopen?: string[];
  /** Fuerza el voto. Por defecto, el guion mira los normalizados. */
  voto?: ProbabilisticVote["vote"];
  fallar?: "suficiencia" | "voto";
}

export class DecisionEngineGuion implements DecisionEngine {
  private readonly op: OpcionesDelGuion;

  constructor(opciones: OpcionesDelGuion = {}) {
    this.op = opciones;
  }

  async assessSufficiency(_req: DecisionEngineInput): Promise<SufficiencyAssessment> {
    if (this.op.fallar === "suficiencia") throw new Error("guion: fallo simulado de suficiencia");
    return {
      sufficient: this.op.sufficient ?? true,
      reopen_unit_ids: this.op.reopen ?? [],
    };
  }

  /**
   * VP de guion. Mira `fiebre` y `aspecto_herida` porque son las dos unidades sobre
   * las que el corpus SI sostiene una cita, y cita los documentos efectivamente
   * recuperados — que es lo que el orquestador va a sanear despues de todos modos.
   *
   * Los umbrales de aqui NO son criterio clinico: son un guion para que el bucle
   * tenga dos votos distinguibles mientras el modelo no esta.
   */
  async emitVote(req: DecisionEngineInput & { evidence: RetrievedChunk[] }): Promise<ProbabilisticVote> {
    if (this.op.fallar === "voto") throw new Error("guion: fallo simulado del VP");

    const doc_ids = [...new Set(req.evidence.map((c) => c.doc_id))].slice(0, 3);
    if (this.op.voto) return { vote: this.op.voto, doc_ids };

    const valor = (id: string): unknown => req.units.find((u) => u.id === id)?.normalized;
    const fiebre = Number(valor("fiebre"));
    const herida = String(valor("aspecto_herida") ?? "");

    if (Number.isFinite(fiebre) && fiebre >= 38 && /purulenta|dehiscencia/.test(herida)) {
      return {
        vote: {
          escalate: true,
          criticality: "rojo",
          reason: "GUION: fiebre alta junto a hallazgo estructural en la herida.",
        },
        doc_ids,
      };
    }
    if ((Number.isFinite(fiebre) && fiebre >= 37.9) || /purulenta|dehiscencia|eritema/.test(herida)) {
      return {
        vote: {
          escalate: true,
          criticality: "amarillo",
          reason: "GUION: un hallazgo aislado que conviene vigilar.",
        },
        doc_ids,
      };
    }
    return {
      vote: { escalate: false, criticality: "verde", reason: "GUION: sin hallazgos en las unidades miradas." },
      doc_ids,
    };
  }
}
