import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContextFrame, ConversationalEngine, EngineExtraction, EngineSignal } from "@techsphere/contracts";
import { validateUnitResults } from "@techsphere/contracts";
import {
  cargarMarco,
  cerrarPendientesPorCorte,
  conducirTurno,
  iniciarSesion,
  transcriptDigest,
  unidadesParaEntrega,
} from "../src/sesion.ts";

function frameDePrueba(round = 0): ContextFrame {
  return {
    frame_id: "F-prueba",
    patient_ref: "paciente-1",
    round,
    units: [
      {
        id: "fiebre",
        intent: "Saber si ha tenido fiebre desde la cirugia, de cuanto y desde cuando.",
        priority: "required",
        type: "quantity",
        coverage: { requires: ["value", "onset"] },
        lexicon: { values: [], unit: "°C", requires_precision: ["calorcito", "caliente"] },
      },
      {
        id: "dolor",
        intent: "Saber la intensidad del dolor en escala 0-10.",
        priority: "required",
        type: "scale",
        coverage: { requires: ["magnitude"] },
        lexicon: { values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] },
      },
    ],
    red_flags: [{ id: "RF-sangrado", patterns: ["sangrando mucho"] }],
    policy: {
      max_turns: 6,
      max_session_ms: 300_000,
      reflect_below_confidence: 0.5,
      stall_window: 2,
      allow_partial_handback: true,
    },
  };
}

/** Un motor falso, programable turno a turno, sin red — para probar el motor de estados solo. */
function motorProgramado(
  guion: { extractions: EngineExtraction[]; signals: EngineSignal[] }[],
): ConversationalEngine {
  let i = 0;
  return {
    async interpret() {
      const paso = guion[i] ?? { extractions: [], signals: [] };
      i++;
      return paso;
    },
    async render(req) {
      return `[${req.act.act}${req.act.unit_id ? `:${req.act.unit_id}` : ""}]`;
    },
  };
}

test("iniciarSesion + cargarMarco deja la sesion en F2 con todas las unidades del marco", () => {
  const estado = cargarMarco(iniciarSesion("s1"), frameDePrueba());
  assert.equal(estado.phase, "F2");
  assert.equal(estado.orden.length, 2);
  assert.ok(estado.unidades.has("fiebre"));
  assert.ok(estado.unidades.has("dolor"));
});

test("conducirTurno cierra una unidad con una extraccion limpia y avanza a la siguiente", async () => {
  const motor = motorProgramado([
    {
      extractions: [{ unit_id: "fiebre", raw: "38.9 desde ayer", normalized: 38.9, confidence: 0.9, coverage_met: ["value", "onset"] }],
      signals: [],
    },
  ]);
  let estado = cargarMarco(iniciarSesion("s2"), frameDePrueba());
  const r = await conducirTurno(estado, "tuve 38.9 de fiebre desde ayer", motor, 1);
  estado = r.estado;

  assert.equal(estado.unidades.get("fiebre")?.extraction, "cubierta");
  assert.equal(r.acto?.act, "continuar", "con fiebre resuelta, el siguiente acto pide la unidad pendiente (dolor)");
  assert.equal(r.acto?.unit_id, "dolor");
  assert.ok(r.say);
});

test('una expresion que toca la unidad sin cuantificar ("un calorcito") dispara reflejar y NO inventa un numero', async () => {
  const motor = motorProgramado([
    { extractions: [{ unit_id: "fiebre", raw: "un calorcito", normalized: null, confidence: 0.9, coverage_met: [] }], signals: [] },
  ]);
  let estado = cargarMarco(iniciarSesion("s3"), frameDePrueba());
  const r = await conducirTurno(estado, "senti un calorcito nada mas", motor, 1);
  estado = r.estado;

  const fiebre = estado.unidades.get("fiebre");
  assert.equal(fiebre?.normalized, null);
  assert.equal(fiebre?.raw, "un calorcito");
  assert.equal(r.acto?.act, "reflejar");
});

test("una bandera roja corta el guion: say es null y el llamador debe manejar la urgencia aparte", async () => {
  const motor = motorProgramado([
    { extractions: [], signals: [{ kind: "red_flag", red_flag_id: "RF-sangrado", utterance: "estoy sangrando mucho" }] },
  ]);
  let estado = cargarMarco(iniciarSesion("s4"), frameDePrueba());
  const r = await conducirTurno(estado, "doctor estoy sangrando mucho", motor, 1);
  estado = r.estado;

  assert.ok(estado.red_flag);
  assert.equal(estado.red_flag?.red_flag_id, "RF-sangrado");
  assert.equal(r.say, null);
  assert.equal(estado.phase, "F5");
});

test("cerrarPendientesPorCorte cierra lo que quedo abierto con la causa dada, y unidadesParaEntrega produce UnitResult validos", async () => {
  const motor = motorProgramado([{ extractions: [], signals: [] }]);
  let estado = cargarMarco(iniciarSesion("s5"), frameDePrueba());
  const r = await conducirTurno(estado, "eh no se que decirle", motor, 1);
  estado = r.estado;
  estado = cerrarPendientesPorCorte(estado, "interrumpido");

  const unidades = unidadesParaEntrega(estado);
  assert.equal(unidades.length, 2);
  for (const u of unidades) {
    assert.equal(u.extraction, "suspendida");
    assert.equal(u.cause, "interrumpido");
    assert.equal(u.closure, "corte");
  }

  const validacion = validateUnitResults(unidades, { frame: frameDePrueba() });
  assert.equal(validacion.valid, true, JSON.stringify(validacion.issues, null, 2));
});

test("transcriptDigest concatena el transcript literal, sin interpretar", async () => {
  const motor = motorProgramado([
    { extractions: [{ unit_id: "fiebre", raw: "38.9 desde ayer", normalized: 38.9, confidence: 0.9, coverage_met: ["value", "onset"] }], signals: [] },
  ]);
  let estado = cargarMarco(iniciarSesion("s6"), frameDePrueba());
  const r = await conducirTurno(estado, "tuve 38.9 de fiebre desde ayer", motor, 1);
  estado = r.estado;
  const digest = transcriptDigest(estado);
  assert.ok(digest.includes("38.9 de fiebre"));
});

test("agotar max_turns cierra la fase en F5 aunque queden unidades sin resolver", async () => {
  const frame = { ...frameDePrueba(), policy: { ...frameDePrueba().policy, max_turns: 1 } };
  const motor = motorProgramado([{ extractions: [], signals: [] }]);
  let estado = cargarMarco(iniciarSesion("s7"), frame);
  const r = await conducirTurno(estado, "no se", motor, 1);
  assert.equal(r.estado.phase, "F5");
});
