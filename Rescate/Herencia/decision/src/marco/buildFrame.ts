/**
 * WO-41 — el generador de marcos (ADR-012). El marco se GENERA, no se escribe.
 *
 * ============ Que NO lleva el marco ============
 *
 * No lleva **umbrales ni reglas**. Si el marco dijera "si supera 38.5 marcar
 * infeccion", la frontera estaria rota: eso es criterio clinico y vive entero del
 * lado del decisor.
 *
 * No lleva **nada del caso clinico**. Lo que entra es la proyeccion de WO-37
 * —referencia opaca, unidades y `dia_postop`— y no el `PatientCase`.
 *
 * ==============================================
 *
 * `intent` es prosa dirigida a la CONVERSACIONAL, no al paciente: dice QUE se
 * necesita saber, nunca como preguntarlo ni que significa clinicamente.
 */

import {
  exigirValido,
  validateContextFrame,
  type ContextFrame,
  type UnitPriority,
  type UnitSpec,
} from "@techsphere/contracts";
import { cargarLexico, lexiconDeUnidad, type LexicoDestilado } from "./lexico.ts";

/**
 * Que necesita saber el decisor de cada unidad, y con que cobertura la da por
 * descrita. Es lo unico de contenido que vive aqui, y es intencion, no criterio:
 * ninguna linea dice que significa un valor.
 *
 * Las seis unidades son las del dominio `postop-0.1.0`. `required` en las seis
 * porque el hallazgo central del dominio —`CO-02`— compone apetito y sueño con
 * fiebre: dejar cualquiera en `desired` haria que el caso rojo dependiera de que el
 * paciente la mencionara por su cuenta.
 */
const INTENCION: Record<string, { intent: string; priority: UnitPriority; coverage: UnitSpec["coverage"] }> = {
  fiebre: {
    intent: "Saber si ha tenido fiebre desde la cirugia, de cuanto, y desde cuando.",
    priority: "required",
    coverage: { requires: ["value", "onset"] },
  },
  dolor_intensidad: {
    intent: "Saber la intensidad del dolor en una escala de 0 a 10 y si sube o baja respecto a ayer.",
    priority: "required",
    coverage: { requires: ["magnitude", "trend"] },
  },
  aspecto_herida: {
    intent: "Saber como se ve y como se siente la herida: color, calor, si sale algo y si cambio.",
    priority: "required",
    coverage: { requires: ["value", "trend"] },
  },
  movilidad: {
    intent: "Saber si puede moverse y caminar como se espera para su dia, y con que ayuda.",
    priority: "required",
    coverage: { requires: ["value"] },
  },
  apetito: {
    intent: "Saber si esta comiendo, cuanto respecto a lo habitual, y si tolera la comida.",
    priority: "required",
    coverage: { requires: ["value"] },
  },
  sueno: {
    intent: "Saber si esta durmiendo y si el descanso se interrumpe.",
    priority: "required",
    coverage: { requires: ["value"] },
  },
};

/**
 * ============ Las red flags SI van en el marco, y son PATRONES DE SUPERFICIE ============
 *
 * La primera version dejo `red_flags: []` argumentando ADR-020. Estaba mal, y la
 * distincion que se me escapo es esta:
 *
 *   PROHIBIDO en el marco  —  criterio clinico. "si supera 38.5 marcar infeccion".
 *                             Eso es interpretar, y vive entero del lado del decisor.
 *   ESTO                   —  frases que el paciente puede DECIR y que cortan el bucle.
 *                             No interpretan nada: casan texto.
 *
 * Con la lista vacia, `detectarUrgencia` no puede disparar nunca y la interrupcion
 * prioritaria de §14 es codigo muerto en produccion: alguien diria "no puedo respirar"
 * y el agente seguiria preguntando por el apetito. El escalamiento por los dos votos
 * llega al final de la llamada, y una urgencia no puede esperar al final de la llamada.
 *
 * DOS REGLAS DE ESCRITURA, y la segunda cuesta cara si se olvida:
 *
 *  1. Frases, no palabras. `detectarUrgencia` casa SUBCADENA sobre texto sin acentos y
 *     **no entiende negaciones**: el patron "sangre" dispararia con "no me sale sangre",
 *     que es justo lo contrario. Por eso todos los patrones son sintagmas que un
 *     paciente no dice para negar.
 *  2. Ninguna magnitud. Ni grados, ni escalas, ni cantidades — el momento en que un
 *     patron diga un numero, esto habra dejado de ser superficie.
 *
 * PROCEDENCIA: `inferred` (ADR-012). Derivadas del habla esperada, no validadas por
 * experto, y **el director las revisa**: son el unico contenido clinico que esta capa
 * escribe, y lo declara en vez de disimularlo.
 *
 * ========================================================================================
 */
const RED_FLAGS: readonly { id: string; patterns: string[] }[] = [
  {
    id: "RF-sangrado",
    patterns: [
      "sangrando mucho",
      "no para de sangrar",
      "no deja de sangrar",
      "sangre a chorros",
      "se me abrio la herida",
      "se me abrio todo",
      "botando mucha sangre",
      // "hemorragia" a secas estaba aqui y la prueba lo caza: una sola palabra dispara
      // con "no tengo hemorragia", que es lo contrario. Las frases de arriba cubren el
      // mismo caso sin ese riesgo.
    ],
  },
  {
    id: "RF-respiracion",
    patterns: ["no puedo respirar", "me falta el aire", "no me entra el aire", "me estoy ahogando", "me ahogo"],
  },
  {
    id: "RF-dolor-toracico",
    patterns: ["dolor en el pecho", "me duele el pecho", "me aprieta el pecho", "opresion en el pecho"],
  },
  {
    id: "RF-conciencia",
    patterns: ["me desmaye", "se desmayo", "esta inconsciente", "no responde", "no reacciona"],
  },
];

/**
 * El presupuesto de la sesion. Es red de seguridad, no criterio de cierre: el cierre
 * lo decide el estado del motor. `max_rounds` NO vive aqui — el bucle de rondas lo
 * gobierna el decisor (correccion X-4) y la conversacional no debe saber en que
 * ronda va, porque conocerlo le permitiria modular su insistencia.
 */
const POLITICA = {
  max_turns: 12,
  max_session_ms: 420_000,
  reflect_below_confidence: 0.5,
  stall_window: 3,
  allow_partial_handback: true,
} as const;

/**
 * Lo minimo que el generador necesita. `ProyeccionParaMarco` lo satisface, y el
 * `patient_ref` se ensancha a `string | null` porque el marco generico de una
 * identidad no verificada no tiene referencia que poner — y falsificar una seria
 * exactamente lo que ADR-024 prohibe.
 */
export interface BaseDeMarco {
  patient_ref: string | null;
  unit_ids: readonly string[];
  dia_postop: number;
}

export interface OpcionesDeMarco {
  /** 0 = marco inicial; >0 = frame_delta. */
  round?: number;
  /** Solo estas unidades. Es lo que hace del delta un delta. */
  solo?: readonly string[];
  lexico?: LexicoDestilado;
}

/**
 * ADR-012 — el marco se genera desde el caso y el conocimiento, y su procedencia se
 * DECLARA. Con el contenido de hoy es siempre `inferred`, y eso va al informe como
 * limite conocido en vez de disimularse.
 */
export const PROCEDENCIA_DEL_MARCO = "inferred" as const;

export function buildFrame(
  proyeccion: BaseDeMarco,
  session_id: string,
  opciones: OpcionesDeMarco = {},
): ContextFrame {
  const lexico = opciones.lexico ?? cargarLexico();
  const round = opciones.round ?? 0;

  const ids = proyeccion.unit_ids.filter((id) => (opciones.solo ? opciones.solo.includes(id) : true));

  const units: UnitSpec[] = ids.map((id) => {
    const intencion = INTENCION[id];
    if (!intencion) {
      throw new Error(
        `La unidad ${JSON.stringify(id)} no tiene intencion declarada en el generador de marcos. ` +
          `Las unidades vienen del dominio y su intencion se declara aqui: si el dominio crecio, ` +
          `alguien tiene que escribir QUE se necesita saber, y eso no se infiere.`,
      );
    }
    const spec: UnitSpec = {
      id,
      intent: intencion.intent,
      priority: intencion.priority,
      type: lexico.unidades[id]?.tipo ?? "free",
      coverage: intencion.coverage,
    };
    const unidad = lexico.unidades[id];
    if (unidad) {
      const lexicon = lexiconDeUnidad(unidad);
      if (lexicon) spec.lexicon = lexicon;
    }
    return spec;
  });

  const frame: ContextFrame = {
    frame_id: `frame-${session_id}-${round}`,
    patient_ref: proyeccion.patient_ref,
    round,
    units,
    // Patrones de superficie, no umbrales. Sin ellos la interrupcion prioritaria de
    // §14 no puede dispararse nunca. Ver el bloque de arriba.
    red_flags: RED_FLAGS.map((f) => ({ id: f.id, patterns: [...f.patterns] })),
    policy: { ...POLITICA },
  };

  exigirValido("ContextFrame generado", validateContextFrame(frame));
  return frame;
}

/**
 * El `frame_delta`: mismo generador, `round` incrementado y SOLO las unidades
 * reabiertas. Un segundo esquema se desincronizaria, y por eso reutiliza `ContextFrame`.
 */
export function buildFrameDelta(
  proyeccion: BaseDeMarco,
  session_id: string,
  reabrir: readonly string[],
  round: number,
  lexico?: LexicoDestilado,
): ContextFrame {
  return buildFrame(proyeccion, session_id, {
    round,
    solo: reabrir,
    ...(lexico === undefined ? {} : { lexico }),
  });
}

/**
 * Marco generico para `identity: unverified` — la llamada que SIGUE adelante sin
 * identificar. Sin `patient_ref` y sin dia_postop, porque no hay caso: se pregunta
 * lo mismo, y quien pondera recibe la bandera de identidad por `SessionState`.
 */
export function buildFrameGenerico(session_id: string, lexico?: LexicoDestilado): ContextFrame {
  return buildFrame(
    { patient_ref: null, unit_ids: Object.keys(INTENCION), dia_postop: 0 },
    session_id,
    lexico === undefined ? {} : { lexico },
  );
}
