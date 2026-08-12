#!/usr/bin/env node
/**
 * WO-45 — la sesion anotada. MATERIAL DE ENTREGA, no salida de prueba.
 *
 * Produce la evidencia que el informe y el video citan: la cadena completa desde el
 * enunciado literal del paciente hasta la razon de la decision, con cada eslabon
 * resoluble, y los TRES CIERRES del sistema demostrados uno detras de otro.
 *
 *   enunciado (raw) -> unidad (UnitResult) -> reporte (rule_id) -> voto (vd_rule)
 *                   -> Decision.traces -> CallSummary
 *
 * Se recoge SOBRE LA MARCHA, no se reconstruye al final: lo que se escribe aqui es lo
 * que el ledger anoto mientras la sesion ocurria.
 *
 *   node scripts/sesion-anotada.mjs        contra el modelo real (requiere GROQ_API_KEY)
 *
 * Escribe `docs/evidencia-decision/sesion-anotada.md` y su `.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cargarDominioDesdeArchivo, MotorDeterminista } from "@techsphere/deterministic";
import {
  AdaptadorNube,
  AlmacenDeFuentes,
  ArchivoDeSesiones,
  CanalDeAlerta,
  cargarCorpusReal,
  DecisionEngineNube,
  IndiceLexico,
  Orquestador,
  SumideroDeResumenes,
  UNIDADES_DEL_DOMINIO,
} from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(AQUI, "..", "..", "docs", "evidencia-decision");
const ARCHIVO = join(AQUI, "..", "salidas", "sesiones");

// --- Cableado ----------------------------------------------------------------

const adaptador = new AdaptadorNube({
  ruta: "nube_groq",
  modelo: "llama-3.3-70b-versatile",
  api_key: process.env.GROQ_API_KEY ?? "",
  timeout_ms: 45_000,
});

const dominio = cargarDominioDesdeArchivo(join(AQUI, "..", "..", "docs", "dominio", "dominio-postop-v0.1.json"));
const determinista = new MotorDeterminista(dominio);

const almacen = new AlmacenDeFuentes();
cargarCorpusReal(almacen);
const rag = new IndiceLexico(almacen);

const archivo = new ArchivoDeSesiones(ARCHIVO);
const canal = new CanalDeAlerta();
const sink = new SumideroDeResumenes(archivo, canal);

const orq = new Orquestador({
  rag,
  expandir: (base, terminos) => rag.expandirConsulta(base, terminos),
  determinista,
  motor: new DecisionEngineNube(adaptador),
  proyectar: (patient_ref) => ({ patient_ref, unit_ids: UNIDADES_DEL_DOMINIO, dia_postop: 7 }),
  sink,
  embedding_model: rag.descriptor(),
});

// --- Los casos ---------------------------------------------------------------

const unidad = (id, normalized, raw, extra = {}) => ({
  id,
  extraction: "cubierta",
  state: 3,
  state_trace: [2, 3],
  raw,
  normalized,
  confidence: 0.9,
  coverage_met: ["value", "onset", "trend", "magnitude"],
  turn_refs: [2],
  ...extra,
});

const CASO_ROJO = [
  unidad("fiebre", 38.6, "si, anoche me dio como calentura, me marco 38 y algo"),
  unidad("dolor_intensidad", 7, "un siete, y ayer estaba en cuatro"),
  unidad("aspecto_herida", "secrecion_purulenta", "le esta saliendo un liquido amarillo espeso"),
  unidad("movilidad", "limitada_esperada", "camino despacito hasta el bano y ya"),
  unidad("apetito", "muy_disminuido", "no me provoca nada, no he comido casi"),
  unidad("sueno", "muy_alterado", "me despierto toda la noche del dolor"),
];

const CASO_INCOMPLETO = [
  unidad("fiebre", 36.9, "no, fiebre no"),
  unidad("dolor_intensidad", 3, "un tres"),
  unidad("aspecto_herida", null, "pues ahi va, normalita", {
    extraction: "hidratada_sin_normalizar",
    normalized: null,
    confidence: 0.3,
    coverage_met: [],
  }),
  unidad("movilidad", "normal", "camino bien"),
  unidad("apetito", "normal", "como normal"),
  unidad("sueno", "normal", "duermo bien"),
];

const IDENT = { status: "identificado", patient_ref: "pref-9f2c41ab", speaker_role: "paciente" };
const ESTADO = { global: 2, frame_health: 2, retroactive_cycle: false, identity: "identificado" };

// --- Recorrido ---------------------------------------------------------------

const sesiones = [];

/**
 * Recorre la sesion hasta que el decisor cierre. El bucle puede pedir mas rondas —el
 * predicado por unidades sin cerrar, o el MODELO ejerciendo su desempate sobre un
 * marco estructuralmente completo (ADR-022)— y las dos cosas son comportamiento
 * correcto, no un tropiezo del guion. Se anota cuantas rondas costo.
 */
async function recorrer(session_id, units, digest, estado = ESTADO) {
  const frame = await orq.requestFrame({ session_id, identity: IDENT });
  let veredicto;
  let rondas = 0;
  for (let round = 0; round <= 2; round++) {
    rondas = round + 1;
    veredicto = await orq.submitFrame({
      session_id,
      frame_id: frame.frame_id,
      round,
      units,
      session_state: estado,
      transcript_digest: digest,
      budget_spent: { turns: 8 + round * 2, ms: 190_000 + round * 30_000 },
    });
    if (veredicto.status === "sufficient") break;
  }
  return { frame, veredicto, rondas };
}

console.log("Generando la sesion anotada contra el modelo real...\n");

const rojo = await recorrer(
  "anotada-or-rojo",
  CASO_ROJO,
  "Refiere calentura desde anoche, liquido amarillo en la herida, casi no ha comido y no duerme del dolor.",
);
sesiones.push({ titulo: "Cierre por TABLA OR — caso que escala", ...rojo, session_id: "anotada-or-rojo" });

const incompleto = await recorrer(
  "anotada-degradacion",
  CASO_INCOMPLETO,
  "Dice que va bien pero no logra describir como esta la herida.",
  { ...ESTADO, frame_health: 0 },
);
sesiones.push({
  titulo: "Cierre por DEGRADACION (ADR-014) — el contexto no cerro",
  ...incompleto,
  session_id: "anotada-degradacion",
});

const urgencia = await orq.escalateNow({
  session_id: "anotada-urgencia",
  red_flag_id: "RF-sangrado",
  utterance: "se me abrio la herida y estoy sangrando harto, no para",
  units_so_far: [],
});
sesiones.push({
  titulo: "Cierre por URGENCIA — corta el bucle desde cualquier punto",
  session_id: "anotada-urgencia",
  veredicto: { status: "sufficient", decision: urgencia },
  frame: null,
});

// --- Escritura ----------------------------------------------------------------

const bloque = (s) => {
  const ledger = orq.ledgerDe(s.session_id);
  const d = s.veredicto.decision;
  const resumen = archivo.leer(s.session_id);
  const hidratado = ledger.ultima("marco_hidratado");
  const vd = ledger.ultima("voto_vd");
  const vp = ledger.ultima("voto_vp");
  const reporte = ledger.ultima("reporte_determinista");

  const lineas = [];
  lineas.push(`## ${s.titulo}`, "");
  lineas.push(
    `\`session_id\`: \`${s.session_id}\` · rama: **${resumen?.decision.branch}** · ` +
      `\`reason_code\`: \`${d.reason_code}\`` +
      (s.rondas ? ` · rondas recorridas: **${s.rondas}**` : ""),
    "",
  );

  if (hidratado) {
    lineas.push("### La cadena de evidencia, eslabón a eslabón", "");
    lineas.push("| unidad | lo que dijo el paciente (`raw`) | normalizado | regla determinista |");
    lineas.push("|---|---|---|---|");
    for (const u of hidratado.units) {
      const reglas = (reporte?.report.trace ?? [])
        .filter((t) => t.origen_unit_ids.includes(u.id))
        .map((t) => `\`${t.rule_id}\``)
        .join(" ") || "—";
      lineas.push(
        `| \`${u.id}\` | ${u.raw === null ? "—" : `"${u.raw}"`} | ${u.normalized === null ? "**sin normalizar**" : `\`${JSON.stringify(u.normalized)}\``} | ${reglas} |`,
      );
    }
    lineas.push("");
  }

  if (vp && vd) {
    lineas.push("### Los dos votos", "");
    lineas.push(`- **VP** (modelo, \`temperature: 0\`) — ${vp.vote.criticality}, ${vp.vote.escalate ? "escala" : "no escala"}: ${vp.vote.reason}`);
    lineas.push(`- **VD** (tabla declarada \`${vd.vd_rule}\`) — ${vd.vote.criticality}, ${vd.vote.escalate ? "escala" : "no escala"}: ${vd.vote.reason}`);
    lineas.push("");
    lineas.push(`Ponderación OR: **${d.escalate ? "ESCALA" : "no escala"}**, criticidad \`${d.criticality}\`.`, "");
  } else {
    lineas.push("### Sin votos", "");
    lineas.push(
      "Los caminos de ADR-014 y la urgencia **no pasan por la tabla OR**: la degradación no es un voto, es un cortocircuito hacia la alerta.",
      "",
    );
  }

  lineas.push("### La decisión", "");
  lineas.push(`> ${d.reason}`, "");
  lineas.push(`- \`escalate\`: **${d.escalate}** · \`criticality\`: **${d.criticality}** · \`context_complete\`: ${d.context_complete}`);
  lineas.push(`- \`traces.doc_ids\`: ${d.traces.doc_ids.map((x) => `\`${x}\``).join(", ") || "—"}`);
  lineas.push(`- \`traces.rules_fired\`: ${d.traces.rules_fired.map((x) => `\`${x}\``).join(", ") || "— (ninguna regla disparó: es un resultado, no un fallo)"}`);
  if (resumen?.evidence_gaps?.length) {
    lineas.push(`- \`evidence_gaps\`: ${resumen.evidence_gaps.map((h) => `\`${h.unit_id}\``).join(", ")} — sobre esas unidades **el corpus no sostiene una cita**`);
  }
  lineas.push(`- Al paciente: *"${d.say_to_patient}"*`, "");
  lineas.push(`Entregado a: ${resumen ? "`session_archive`" : "—"}${d.escalate ? " y `alert_channel`" : ""}.`, "");
  return lineas.join("\n");
};

const cabecera = [
  "# Sesión anotada — capa de decisión",
  "",
  "> Generada por `decision/scripts/sesion-anotada.mjs` contra el **modelo real** de la ruta",
  "> primaria y el **corpus real** de 107 documentos. Los datos del paciente son sintéticos.",
  "",
  `Modelo: \`${adaptador.modelo}\` · \`temperature: 0\` en el rol decisor`,
  `Dominio: \`${determinista.describeDomain().domain_version}\` · Recuperación: \`${rag.descriptor()}\``,
  `Generada: ${new Date().toISOString()}`,
  "",
  "Los **tres cierres** del sistema, uno detrás de otro. Ninguno termina sin `Decision`, y",
  "ninguno sin `CallSummary`: los tres convergen en el resumen (ADR-016).",
  "",
  "---",
  "",
].join("\n");

mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, "sesion-anotada.md"), cabecera + sesiones.map(bloque).join("\n---\n\n"), "utf8");
writeFileSync(
  join(SALIDA, "sesion-anotada.json"),
  JSON.stringify(
    {
      _declaracion:
        "Sesiones reales contra el modelo de la ruta primaria y el corpus real. Datos de paciente SINTETICOS.",
      modelo: adaptador.modelo,
      dominio: determinista.describeDomain().domain_version,
      recuperacion: rag.descriptor(),
      sesiones: sesiones.map((s) => ({
        session_id: s.session_id,
        titulo: s.titulo,
        ledger: orq.ledgerDe(s.session_id).entradas,
        resumen: archivo.leer(s.session_id),
      })),
    },
    null,
    2,
  ),
  "utf8",
);

for (const s of sesiones) {
  const r = archivo.leer(s.session_id);
  console.log(
    `  ${s.session_id.padEnd(22)} ${r?.decision.branch?.padEnd(12)} escalate=${String(r?.decision.escalate).padEnd(5)} ${r?.decision.criticality}`,
  );
}
console.log(`\n  canal de alerta: ${canal.recibidos.length} resumen(es)`);
console.log(`  escritos: docs/evidencia-decision/sesion-anotada.{md,json}\n`);
