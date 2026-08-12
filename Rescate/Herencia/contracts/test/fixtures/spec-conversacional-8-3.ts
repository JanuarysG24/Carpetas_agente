/**
 * El `ContextFrame` de ejemplo de `docs/Especificacion-Capa-Conversacional.md` §8.3,
 * transcrito SIN cambios. Es el criterio de aceptacion numero uno del Paso 0:
 * si este marco no valida, el contrato no representa lo que la spec describe.
 *
 * Se declara con `satisfies` y no con `:` a proposito: `satisfies` comprueba la
 * conformidad sin ensanchar el tipo, asi que el fixture sigue sirviendo tambien
 * como prueba a nivel de tipo.
 */
import type { ContextFrame } from "../../src/index.ts";

export const EJEMPLO_SPEC_8_3 = {
  frame_id: "f_9c2a",
  patient_ref: "p_0042",
  round: 0,
  units: [
    {
      id: "dolor_intensidad",
      intent: "Nivel de dolor actual en la zona intervenida",
      priority: "required",
      type: "scale",
      coverage: { requires: ["value", "trend"] },
      lexicon: {
        values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        unit: "1-10",
      },
    },
    {
      id: "aspecto_herida",
      intent: "Estado visible de la herida quirurgica",
      priority: "required",
      type: "categorical",
      coverage: { requires: ["value"] },
      lexicon: {
        values: ["normal", "enrojecida", "exudado_seroso", "exudado_purulento", "dehiscencia"],
        synonyms: {
          exudado_purulento: ["pus", "liquido amarillo", "materia", "postema"],
          enrojecida: ["colorada", "roja", "brotada"],
        },
      },
    },
    {
      id: "fiebre",
      intent: "Presencia y magnitud de fiebre desde el alta",
      priority: "required",
      type: "quantity",
      coverage: { requires: ["value", "onset"] },
      lexicon: { values: [], unit: "°C" },
    },
    {
      id: "signo_infeccion",
      intent: "Cuadro compuesto de infeccion de sitio operatorio",
      priority: "required",
      type: "categorical",
      coverage: { requires: ["value"] },
      composes: ["aspecto_herida", "fiebre", "dolor_intensidad"],
    },
    {
      id: "adherencia_medicacion",
      intent: "Si esta tomando lo formulado",
      priority: "desired",
      type: "boolean",
      coverage: { requires: ["value"] },
    },
  ],
  red_flags: [
    { id: "disnea_aguda", patterns: ["no puedo respirar", "me falta el aire", "me ahogo"] },
    {
      id: "hemorragia",
      patterns: ["sangre a chorros", "no para de sangrar", "empapado de sangre"],
    },
  ],
  policy: {
    max_turns: 24,
    max_session_ms: 480000,
    reflect_below_confidence: 0.7,
    stall_window: 3,
    allow_partial_handback: true,
  },
} satisfies ContextFrame;
