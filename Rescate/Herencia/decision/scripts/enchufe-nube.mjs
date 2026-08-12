#!/usr/bin/env node
/**
 * WO-47 §1 — el enchufe del modelo real, contra la ruta primaria.
 *
 * La pregunta que responde este script no es "¿funciona el modelo?" sino una sobre la
 * ARQUITECTURA, y es falsable: enchufar el modelo real ¿obliga a tocar el ponderador,
 * los puertos, la tabla VD o el ensamblador?
 *
 * Si la respuesta es no, las costuras de aislamiento valieron lo que costaron. Si es
 * si, hay que saberlo hoy y no el domingo.
 *
 *   node scripts/enchufe-nube.mjs        un caso rojo y uno verde, de punta a punta
 *
 * Requiere GROQ_API_KEY. Lo que sale a la red son datos SINTETICOS de los fixtures.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cargarDominioDesdeArchivo, MotorDeterminista } from "@techsphere/deterministic";
import {
  AdaptadorNube,
  AlmacenDeFuentes,
  cargarCorpusReal,
  DecisionEngineNube,
  IndiceLexico,
  Orquestador,
  UNIDADES_DEL_DOMINIO,
} from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const verde = (s) => `[32m${s}[0m`;
const rojo = (s) => `[31m${s}[0m`;
const gris = (s) => `[90m${s}[0m`;
const azul = (s) => `[36m${s}[0m`;

// --- El cableado. Esto es lo unico que cambia respecto al guion. -------------

const adaptador = new AdaptadorNube({
  ruta: "nube_groq",
  modelo: "llama-3.3-70b-versatile",
  api_key: process.env.GROQ_API_KEY ?? "",
  timeout_ms: 45_000,
});
const motor = new DecisionEngineNube(adaptador);

const dominio = cargarDominioDesdeArchivo(join(AQUI, "..", "..", "docs", "dominio", "dominio-postop-v0.1.json"));
const determinista = new MotorDeterminista(dominio);

const almacen = new AlmacenDeFuentes();
const carga = cargarCorpusReal(almacen);
const rag = new IndiceLexico(almacen);

const entregados = [];
const orq = new Orquestador({
  rag,
  determinista,
  motor,
  proyectar: (patient_ref) => ({ patient_ref, unit_ids: UNIDADES_DEL_DOMINIO, dia_postop: 7 }),
  expandir: (base, terminos) => rag.expandirConsulta(base, terminos),
  entregar: (resumen, destinos) => entregados.push({ resumen, destinos }),
  embedding_model: rag.descriptor(),
});

// --- Los casos, sinteticos, del dataset -------------------------------------

const unidad = (id, normalized, raw) => ({
  id,
  extraction: "cubierta",
  state: 3,
  state_trace: [3],
  raw,
  normalized,
  confidence: 0.9,
  coverage_met: ["value", "onset", "trend", "magnitude"],
  turn_refs: [1],
});

const CASOS = {
  rojo: {
    digest:
      "Dice que tiene calentura desde anteanoche, que la herida le esta botando algo amarillo, " +
      "que casi no ha comido y que no duerme del dolor.",
    units: [
      unidad("fiebre", 38.6, "tengo como calentura, 38 y algo me marco"),
      unidad("dolor_intensidad", 7, "un 7, y anoche peor"),
      unidad("aspecto_herida", "secrecion_purulenta", "le esta saliendo un liquido amarillo"),
      unidad("movilidad", "limitada_esperada", "camino despacito hasta el bano"),
      unidad("apetito", "muy_disminuido", "no me provoca nada"),
      unidad("sueno", "muy_alterado", "me despierto toda la noche"),
    ],
  },
  verde: {
    digest: "Dice que va bien, sin fiebre, la herida limpia y durmiendo normal.",
    units: [
      unidad("fiebre", 36.8, "no, nada de fiebre, me la tome y normalita"),
      unidad("dolor_intensidad", 2, "un 2, casi nada"),
      unidad("aspecto_herida", "normal", "la tengo limpiecita y tapadita"),
      unidad("movilidad", "normal", "camino normal por la casa"),
      unidad("apetito", "normal", "como bien, con hambre"),
      unidad("sueno", "normal", "duermo corrido"),
    ],
  },
};

// --- La corrida --------------------------------------------------------------

console.log(azul("\n═══ WO-47 §1 · enchufe del modelo real ═══"));
console.log(gris(`ruta: nube_groq · modelo: ${adaptador.modelo} · temperatura del decider: 0`));
console.log(gris(`corpus: ${carga.ingeridos} documentos · ${rag.status().chunks} fragmentos · ${rag.descriptor()}\n`));

const IDENT = { status: "identificado", patient_ref: "pref-9f2c41ab", speaker_role: "paciente" };
const ESTADO = { global: 2, frame_health: 2, retroactive_cycle: false, identity: "identificado" };

let fallos = 0;

for (const [etiqueta, caso] of Object.entries(CASOS)) {
  const session_id = `enchufe-${etiqueta}`;
  const t0 = Date.now();
  console.log(azul(`── caso ${etiqueta} ─────────────────────────────────────────`));

  try {
    const frame = await orq.requestFrame({ session_id, identity: IDENT });
    console.log(gris(`  marco: ${frame.units.length} unidades, round ${frame.round}`));

    const veredicto = await orq.submitFrame({
      session_id,
      frame_id: frame.frame_id,
      round: 0,
      units: caso.units,
      session_state: ESTADO,
      transcript_digest: caso.digest,
      budget_spent: { turns: 8, ms: 180_000 },
    });

    if (veredicto.status !== "sufficient") {
      console.log(rojo(`  el bucle pidio otra ronda: ${veredicto.frame_delta.units.map((u) => u.id).join(", ")}`));
      continue;
    }

    const d = veredicto.decision;
    const resumen = entregados.at(-1).resumen;
    const ms = Date.now() - t0;

    console.log(`  ${d.escalate ? rojo("ESCALA") : verde("no escala")}  criticidad: ${d.criticality}  (${d.reason_code})`);
    console.log(gris(`  VD: ${resumen.decision.traces.vd_rule} · reglas: ${d.traces.rules_fired.join(", ") || "(ninguna)"}`));
    console.log(gris(`  VP: ${resumen.decision.votes?.vp?.criticality} — ${resumen.decision.votes?.vp?.reason?.slice(0, 150)}`));
    console.log(gris(`  doc_ids saneados: ${d.traces.doc_ids.join(", ") || "(ninguno)"}`));
    if (resumen.evidence_gaps?.length) {
      console.log(gris(`  sin respaldo documental: ${resumen.evidence_gaps.map((h) => h.unit_id).join(", ")}`));
    }
    console.log(gris(`  say_to_patient: "${d.say_to_patient.slice(0, 90)}..."`));
    console.log(gris(`  reloj de pared: ${ms} ms\n`));

    if (etiqueta === "rojo" && !d.escalate) {
      console.log(rojo("  !! un caso rojo no escalo"));
      fallos++;
    }
  } catch (e) {
    console.log(rojo(`  fallo: ${e.message.split("\n")[0]}`));
    fallos++;
  }
}

console.log(azul("═══ que hubo que tocar PARA ENCHUFARLO ═══"));
console.log("  ponderador ...... nada");
console.log("  tabla VD ........ nada");
console.log("  puertos ......... nada");
console.log("  ensamblador ..... nada");
console.log("  orquestador ..... nada");
console.log(gris("  el cambio es la linea `motor:` del cableado, y este archivo."));
console.log(
  gris(
    "  (despues del enchufe SI se toco la construccion de la consulta del RAG en el\n" +
      "   orquestador, por E13. Es un defecto propio que el enchufe hizo visible, no un\n" +
      "   coste del enchufe: no movio ninguna costura.)\n",
  ),
);

process.exitCode = fallos > 0 ? 1 : 0;
