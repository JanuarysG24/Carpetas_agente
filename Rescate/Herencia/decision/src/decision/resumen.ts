/**
 * ADR-016 — el ensamblador. El resumen SE DESTILA DEL LEDGER, no se infiere.
 *
 * Esta prohibido pedirle al modelo que "resuma la llamada" como mecanismo canonico:
 * la evidencia ya esta en el ledger y un resumen inferido podria contradecirla. Es
 * una funcion determinista sobre el ledger — mismos insumos, mismo resumen.
 *
 * Y no transforma: `findings[].normalized` conserva numero, booleano o texto tal como
 * venia. Serializar una fiebre a "38.5" romperia la comparacion contra
 * `label_ground_truth`, porque contrastar "7" con 7 exige parsear y parsear es donde
 * viven los errores silenciosos (correccion X-7).
 */

import {
  exigirValido,
  validateCallSummary,
  type CallSummary,
  type Decision,
  type DecisionBranch,
  type IdentityStatus,
  type SummaryFinding,
} from "@techsphere/contracts";
import type { Ledger } from "./ledger.ts";
import type { HuecoDeEvidencia } from "../conocimiento/respaldo.ts";

export interface VersionesDelResumen {
  domain_version: string;
  vd_version: string;
  embedding_model: string;
}

export interface PedidoDeResumen {
  decision: Decision;
  branch: DecisionBranch;
  identity_status: IdentityStatus;
  versions: VersionesDelResumen;
  evidence_gaps?: readonly HuecoDeEvidencia[];
  generated_at?: string;
}

export function ensamblarResumen(ledger: Ledger, pedido: PedidoDeResumen): CallSummary {
  const hidratado = ledger.ultima("marco_hidratado");
  const identidad = ledger.ultima("identidad");
  const vp = ledger.ultima("voto_vp");
  const vd = ledger.ultima("voto_vd");

  // Una entrada por unidad del marco, COPIADA del ledger. Sin recalcular nada: el
  // ensamblador destila, no reinterpreta.
  const findings: SummaryFinding[] = (hidratado?.units ?? []).map((u) => {
    const f: SummaryFinding = {
      unit_id: u.id,
      state: u.state,
      raw: u.raw,
      normalized: u.normalized,
    };
    if (u.cause !== undefined) f.cause = u.cause;
    return f;
  });

  const resumen: CallSummary = {
    session_id: ledger.session_id,
    generated_at: pedido.generated_at ?? new Date().toISOString(),
    patient_ref: identidad?.patient_ref ?? null,
    identity_status: pedido.identity_status,
    frame: {
      // ADR-012 — con el contenido de hoy siempre `inferred`, y se declara.
      provenance: "inferred",
      rounds: ledger.rondas(),
      context_complete: pedido.decision.context_complete,
    },
    findings,
    decision: {
      escalate: pedido.decision.escalate,
      criticality: pedido.decision.criticality,
      reason: pedido.decision.reason,
      reason_code: pedido.decision.reason_code,
      branch: pedido.branch,
      traces: {
        doc_ids: pedido.decision.traces.doc_ids,
        rules_fired: pedido.decision.traces.rules_fired,
        ...(vd?.vd_rule === undefined ? {} : { vd_rule: vd.vd_rule }),
      },
      // Los votos viajan como evidencia, y solo cuando existieron: en degradacion y
      // urgencia no hubo nada que ponderar, y un objeto vacio mentiria.
      ...(pedido.branch === "or" && vp && vd ? { votes: { vp: vp.vote, vd: vd.vote } } : {}),
    },
    versions: { ...pedido.versions },
    ...(pedido.evidence_gaps && pedido.evidence_gaps.length > 0
      ? { evidence_gaps: pedido.evidence_gaps.map((h) => ({ ...h })) }
      : {}),
  };

  exigirValido("CallSummary ensamblado", validateCallSummary(resumen));
  return resumen;
}
