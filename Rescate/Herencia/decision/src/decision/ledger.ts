/**
 * El ledger de sesion: lo que hace auditable una `Decision`.
 *
 * ADR-016 — el resumen NO se infiere, SE ENSAMBLA, y se ensambla de aqui. El modelo
 * de lenguaje no es fuente de ningun campo estructurado: la evidencia ya esta escrita
 * y un resumen inferido podria contradecirla.
 *
 * Vive DENTRO de la implementacion y no en la firma del puerto: `DecisionPort`
 * transporta `session_id` y nada mas, y eso es correcto — meter el ledger en el tipo
 * habria acoplado el contrato a como esta capa mide (hallazgo C-1 de la rebanada).
 */

import type {
  ContextFrame,
  Decision,
  DeterministicReport,
  RetrievedChunk,
  UnitResult,
  Vote,
} from "@techsphere/contracts";

export type Anotacion =
  | { tipo: "identidad"; status: string; patient_ref: string | null }
  | { tipo: "marco_emitido"; frame: ContextFrame }
  | { tipo: "marco_hidratado"; round: number; units: UnitResult[] }
  | { tipo: "suficiencia"; round: number; sufficient: boolean; por: "predicado" | "modelo"; detalle: string }
  | { tipo: "rag"; unit_id: string; doc_ids: string[]; chunks: number }
  | { tipo: "voto_vp"; vote: Vote; doc_ids: string[] }
  | { tipo: "reporte_determinista"; report: DeterministicReport }
  | { tipo: "voto_vd"; vote: Vote; vd_rule: string; rules_fired: string[] }
  | { tipo: "decision"; decision: Decision; branch: string }
  | { tipo: "entrega_fallida"; destinos: string[]; entregados: string[] };

export class Ledger {
  readonly session_id: string;
  readonly entradas: Array<{ ts: string; anotacion: Anotacion }> = [];

  constructor(session_id: string) {
    this.session_id = session_id;
  }

  anotar(anotacion: Anotacion): void {
    this.entradas.push({ ts: new Date().toISOString(), anotacion });
  }

  /** La ultima anotacion de un tipo. El ensamblador destila de aqui, no recalcula. */
  ultima<T extends Anotacion["tipo"]>(tipo: T): Extract<Anotacion, { tipo: T }> | undefined {
    for (let i = this.entradas.length - 1; i >= 0; i--) {
      const a = this.entradas[i]!.anotacion;
      if (a.tipo === tipo) return a as Extract<Anotacion, { tipo: T }>;
    }
    return undefined;
  }

  todas<T extends Anotacion["tipo"]>(tipo: T): Array<Extract<Anotacion, { tipo: T }>> {
    return this.entradas
      .map((e) => e.anotacion)
      .filter((a): a is Extract<Anotacion, { tipo: T }> => a.tipo === tipo);
  }

  /** Rondas efectivamente recorridas. Es del decisor: la conversacional no lo sabe. */
  rondas(): number {
    return this.todas("marco_hidratado").length;
  }

  chunksRecuperados(): RetrievedChunk[] {
    return [];
  }
}
