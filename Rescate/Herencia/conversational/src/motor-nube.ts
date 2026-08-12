/**
 * `ConversationalEngine` real, en rol `interviewer` (ADR-002, ports.ts). HTTP
 * plano contra el dialecto de chat compatible con OpenAI — el mismo patron que
 * `AdaptadorNube` de `@techsphere/decision`, reescrito aqui SIN depender de esa
 * capa: la conversacional es aguas arriba de la decision (su propio package.json
 * solo depende de `@techsphere/contracts|dev`) y depender de decision cerraria un
 * ciclo que no existe en la arquitectura.
 *
 * G3 (compuerta que descalifica): ningun SDK de proveedor, `fetch` nativo, y el
 * NOMBRE del modelo entra siempre como parametro — nunca una constante en este
 * archivo. La unica constante de modelo del repositorio vive en
 * `decision/src/modelo/rutas.ts`; quien cablea este motor la importa de ahi.
 *
 * `interpret` DETECTA y extrae; `render` pone en palabras un acto YA elegido por
 * el motor de estados (`motor-estados.ts`). Ninguna de las dos decide la cadencia
 * de la entrevista, y `interpret` nunca ve el RAG (ADR-019).
 */

import {
  formatear,
  type ConversationalEngine,
  type EngineExtraction,
  type EngineSignal,
  type IssueSink,
  type ValidationIssue,
  type ValidationResult,
} from "@techsphere/contracts";

// ---------------------------------------------------------------------------
// Validacion minima, local a este archivo.
//
// `@techsphere/contracts` solo publica tipos, puertos y los validadores de la
// COSTURA (ContextFrame, UnitResult, Decision) por su `exports` de package.json.
// `EngineExtraction`/`EngineSignal` son la forma INTERNA del puerto
// `ConversationalEngine` (ports.ts §7) — nunca cruzan la costura tal cual, asi
// que su validacion no vive en el modulo compartido. Se valida aqui, contra el
// mismo vocabulario de `ValidationIssue` para que los mensajes de correccion
// que vuelven al modelo tengan la misma forma que el resto del sistema.
// ---------------------------------------------------------------------------

function agregar(sink: IssueSink, path: string, code: ValidationIssue["code"], message: string, hint: string): void {
  sink.push({ path, code, message, hint });
}

function resultado(sink: IssueSink): ValidationResult {
  return { valid: sink.length === 0, issues: sink };
}

function exigirObjeto(sink: IssueSink, ruta: string, valor: unknown, etiqueta: string): Record<string, unknown> | undefined {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    agregar(sink, ruta, "tipo_invalido", `Se esperaba ${etiqueta}; llego ${typeof valor}.`, `Devuelve un objeto JSON.`);
    return undefined;
  }
  return valor as Record<string, unknown>;
}

function exigirCadena(sink: IssueSink, ruta: string, valor: unknown, opts: { noVacia?: boolean; hint: string }): string | undefined {
  if (typeof valor !== "string") {
    agregar(sink, ruta, "tipo_invalido", `Se esperaba una cadena; llego ${typeof valor}.`, opts.hint);
    return undefined;
  }
  if (opts.noVacia && valor.trim() === "") {
    agregar(sink, ruta, "vacio", `La cadena no puede ir vacia.`, opts.hint);
    return undefined;
  }
  return valor;
}

function exigirNumero(sink: IssueSink, ruta: string, valor: unknown, opts: { min?: number; max?: number; hint: string }): number | undefined {
  if (typeof valor !== "number" || Number.isNaN(valor)) {
    agregar(sink, ruta, "tipo_invalido", `Se esperaba un numero; llego ${typeof valor}.`, opts.hint);
    return undefined;
  }
  if ((opts.min !== undefined && valor < opts.min) || (opts.max !== undefined && valor > opts.max)) {
    agregar(sink, ruta, "fuera_de_rango", `${valor} fuera de [${opts.min ?? "-inf"}, ${opts.max ?? "+inf"}].`, opts.hint);
    return undefined;
  }
  return valor;
}

function exigirArreglo(sink: IssueSink, ruta: string, valor: unknown, opts: { hint: string }): unknown[] | undefined {
  if (!Array.isArray(valor)) {
    agregar(sink, ruta, "tipo_invalido", `Se esperaba un arreglo; llego ${typeof valor}.`, opts.hint);
    return undefined;
  }
  return valor;
}

function exigirEnum<const T extends readonly string[]>(
  sink: IssueSink,
  ruta: string,
  valor: unknown,
  opciones: T,
  hint: string,
): T[number] | undefined {
  if (typeof valor !== "string" || !(opciones as readonly string[]).includes(valor)) {
    agregar(sink, ruta, "valor_fuera_de_enum", `${JSON.stringify(valor)} no esta en [${opciones.join(", ")}].`, hint);
    return undefined;
  }
  return valor as T[number];
}

const CAUSAS_VALIDAS = [
  "no_sabe",
  "no_aplica",
  "no_comprende",
  "rehusa",
  "sin_respuesta",
  "incoherente",
  "interrumpido",
  "bloqueado_por_urgencia",
] as const;

const DIMENSIONES_VALIDAS = ["value", "onset", "trend", "magnitude"] as const;
const ROLES_VALIDOS = ["paciente", "cuidador", "desconocido"] as const;

export interface OpcionesMotorNube {
  /** Nunca una constante local: viene de `decision/src/modelo/rutas.ts` en quien cablea. */
  modelo: string;
  api_key: string;
  /** Por defecto, la base de Groq (dialecto OpenAI). Inyectable para otras rutas de nube compatibles. */
  base_url?: string;
  intentos?: number;
  timeout_ms?: number;
  temperatura_interpret?: number;
  temperatura_render?: number;
  max_tokens_interpret?: number;
  max_tokens_render?: number;
  /** Inyectable para pruebas sin red. En produccion, el `fetch` nativo. */
  fetch_impl?: typeof fetch;
}

const BASE_POR_DEFECTO = "https://api.groq.com/openai/v1";
const INTENTOS_POR_DEFECTO = 2;
const TIMEOUT_MS_POR_DEFECTO = 20_000;
const TEMPERATURA_INTERPRET_POR_DEFECTO = 0.2;
const TEMPERATURA_RENDER_POR_DEFECTO = 0.5;
const MAX_TOKENS_INTERPRET_POR_DEFECTO = 500;
const MAX_TOKENS_RENDER_POR_DEFECTO = 180;

export class ErrorDeCredencialConversacional extends Error {
  constructor() {
    super("Falta GROQ_API_KEY (o la que corresponda): el motor conversacional no puede arrancar sin credencial.");
    this.name = "ErrorDeCredencialConversacional";
  }
}

export class ErrorDeSalidaNoValidableConversacional extends Error {
  readonly issues: ValidationResult["issues"];
  constructor(intentos: number, issues: ValidationResult["issues"], crudo: string) {
    super(
      `El motor conversacional no produjo una extraccion valida en ${intentos} intento(s).\n${formatear(issues)}\n` +
        `Crudo: ${crudo.slice(0, 300)}`,
    );
    this.name = "ErrorDeSalidaNoValidableConversacional";
    this.issues = issues;
  }
}

interface RespuestaChat {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function validarExtraccion(sink: IssueSink, ruta: string, valor: unknown, unitIds: readonly string[]): void {
  const obj = exigirObjeto(sink, ruta, valor, "una EngineExtraction");
  if (!obj) return;
  const unitId = exigirCadena(sink, `${ruta}.unit_id`, obj["unit_id"], {
    noVacia: true,
    hint: "unit_id debe ser uno de los ids del catalogo de unidades entregado.",
  });
  if (unitId !== undefined && !unitIds.includes(unitId)) {
    agregar(
      sink,
      `${ruta}.unit_id`,
      "referencia_rota",
      `unit_id "${unitId}" no esta en el catalogo de esta sesion.`,
      `Solo se pueden extraer las unidades declaradas en el marco. Si el paciente menciono algo fuera del catalogo, va como signal tema_emergente, no como extraction.`,
    );
  }
  exigirCadena(sink, `${ruta}.raw`, obj["raw"], {
    noVacia: true,
    hint: "raw es el literal del paciente, siempre presente cuando hay una extraccion (ADR-004).",
  });
  const normalized = obj["normalized"];
  if (
    normalized !== null &&
    typeof normalized !== "string" &&
    typeof normalized !== "number" &&
    typeof normalized !== "boolean"
  ) {
    agregar(
      sink,
      `${ruta}.normalized`,
      "tipo_invalido",
      `normalized admite string, number, boolean o null; llego ${typeof normalized}.`,
      `Usa null si el paciente toco el tema sin cuantificarlo ("calorcito", "molestia") — nunca inventes un numero (ADR-024).`,
    );
  }
  exigirNumero(sink, `${ruta}.confidence`, obj["confidence"], {
    min: 0,
    max: 1,
    hint: "confidence en [0,1]: que tan fiel es el mapeo al lexico, no que tan seguro esta el paciente.",
  });
  const cobertura = exigirArreglo(sink, `${ruta}.coverage_met`, obj["coverage_met"], {
    hint: "coverage_met puede ir vacio, pero la clave debe existir.",
  });
  cobertura?.forEach((d, i) => exigirEnum(sink, `${ruta}.coverage_met[${i}]`, d, DIMENSIONES_VALIDAS, "dimension invalida"));
}

function validarSenal(sink: IssueSink, ruta: string, valor: unknown, unitIds: readonly string[]): void {
  const obj = exigirObjeto(sink, ruta, valor, "una EngineSignal");
  if (!obj) return;
  const kind = exigirEnum(
    sink,
    `${ruta}.kind`,
    obj["kind"],
    ["red_flag", "cause", "speaker_role", "tema_emergente"] as const,
    "kind debe ser red_flag, cause, speaker_role o tema_emergente.",
  );
  if (kind === "red_flag") {
    exigirCadena(sink, `${ruta}.red_flag_id`, obj["red_flag_id"], { noVacia: true, hint: "id de la bandera roja declarada en el marco." });
    exigirCadena(sink, `${ruta}.utterance`, obj["utterance"], { noVacia: true, hint: "el enunciado literal que disparo la bandera." });
  } else if (kind === "cause") {
    const unitId = exigirCadena(sink, `${ruta}.unit_id`, obj["unit_id"], { noVacia: true, hint: "unit_id de la unidad sin valor." });
    if (unitId !== undefined && !unitIds.includes(unitId)) {
      agregar(sink, `${ruta}.unit_id`, "referencia_rota", `unit_id "${unitId}" no esta en el catalogo.`, "Usa un id del marco.");
    }
    exigirEnum(sink, `${ruta}.cause`, obj["cause"], CAUSAS_VALIDAS, "cause debe ser una causa tipificada de §10.3.");
  } else if (kind === "speaker_role") {
    exigirEnum(sink, `${ruta}.role`, obj["role"], ROLES_VALIDOS, "role debe ser paciente, cuidador o desconocido.");
  } else if (kind === "tema_emergente") {
    exigirCadena(sink, `${ruta}.topic`, obj["topic"], { noVacia: true, hint: "topic: de que hablo el paciente que no estaba en el marco." });
  }
}

function validarSalidaInterpret(valor: unknown, unitIds: readonly string[]): ValidationResult {
  const sink: IssueSink = [];
  const obj = exigirObjeto(sink, "", valor, "la salida de interpret");
  if (!obj) return resultado(sink);
  const extractions = exigirArreglo(sink, "extractions", obj["extractions"], {
    hint: "extractions puede ir vacio (el paciente no aporto nada extraible este turno), pero la clave debe existir.",
  });
  extractions?.forEach((e, i) => validarExtraccion(sink, `extractions[${i}]`, e, unitIds));
  const signals = exigirArreglo(sink, "signals", obj["signals"], {
    hint: "signals puede ir vacio, pero la clave debe existir.",
  });
  signals?.forEach((s, i) => validarSenal(sink, `signals[${i}]`, s, unitIds));
  return resultado(sink);
}

const ESQUEMA_INTERPRET = {
  type: "object",
  properties: {
    extractions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unit_id: { type: "string" },
          raw: { type: "string" },
          normalized: { type: ["string", "number", "boolean", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          coverage_met: { type: "array", items: { type: "string", enum: DIMENSIONES_VALIDAS } },
        },
        required: ["unit_id", "raw", "normalized", "confidence", "coverage_met"],
      },
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["red_flag", "cause", "speaker_role", "tema_emergente"] },
          red_flag_id: { type: "string" },
          utterance: { type: "string" },
          unit_id: { type: "string" },
          cause: { type: "string", enum: CAUSAS_VALIDAS },
          role: { type: "string", enum: ROLES_VALIDOS },
          topic: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["extractions", "signals"],
} as const;

/**
 * Motor `ConversationalEngine` sobre una ruta de nube compatible con el
 * dialecto de chat de OpenAI (Groq es la ruta primaria del proyecto).
 */
export function crearMotorDeNube(opciones: OpcionesMotorNube): ConversationalEngine {
  const key = opciones.api_key.trim();
  if (key === "") throw new ErrorDeCredencialConversacional();

  const base = opciones.base_url ?? BASE_POR_DEFECTO;
  const modelo = opciones.modelo;
  const intentos = opciones.intentos ?? INTENTOS_POR_DEFECTO;
  const timeoutMs = opciones.timeout_ms ?? TIMEOUT_MS_POR_DEFECTO;
  const hacerFetch = opciones.fetch_impl ?? fetch;

  async function pedir(sistema: string, prompt: string, temperature: number, maxTokens: number, json: boolean): Promise<RespuestaChat> {
    const ac = new AbortController();
    const reloj = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await hacerFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: "system", content: sistema },
            { role: "user", content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const cuerpo = await res.text().catch(() => "");
        throw new Error(`El motor conversacional recibio ${res.status} de ${base}: ${cuerpo.slice(0, 300)}`);
      }
      return (await res.json()) as RespuestaChat;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`El motor conversacional no respondio en ${timeoutMs} ms.`);
      }
      throw e;
    } finally {
      clearTimeout(reloj);
    }
  }

  return {
    async interpret(req) {
      const unitIds = req.units.map((u) => u.id);
      const catalogo = req.units.map((u) => ({
        id: u.id,
        intent: u.intent,
        type: u.type,
        coverage_requires: u.coverage.requires,
        lexicon_values: u.lexicon?.values ?? [],
        lexicon_synonyms: u.lexicon?.synonyms ?? {},
        lexicon_requires_precision: u.lexicon?.requires_precision ?? [],
        lexicon_unit: u.lexicon?.unit,
      }));

      const sistema =
        `Eres el modulo de EXTRACCION de un agente de seguimiento post-operatorio que habla espanol colombiano. ` +
        `Tu unico trabajo es leer lo que dijo el paciente en ESTE turno y detectar, contra el catalogo de unidades ` +
        `dado, que valores aporto y que señales hay. NO diagnosticas, NO interpretas gravedad clinica, NO decides ` +
        `si hay que alertar a nadie: eso lo hace otra capa que no ves.\n\n` +
        `Regla que no se negocia: si el paciente no dijo un valor, "normalized" va en null. Expresiones como ` +
        `"calorcito", "un poquito", "molestia", "feo", "raro" TOCAN la unidad pero NO la cuantifican: van con ` +
        `normalized: null y el "raw" literal, nunca inventes un numero o categoria a partir de ellas. Si el ` +
        `catalogo de la unidad declara lexicon_requires_precision y la expresion del paciente esta ahi, aplica ` +
        `esta regla sin excepcion.\n\n` +
        `Catalogo de unidades de esta sesion (JSON): ${JSON.stringify(catalogo)}\n\n` +
        `Devuelve UNICAMENTE un objeto JSON que cumpla este esquema, sin texto alrededor:\n${JSON.stringify(ESQUEMA_INTERPRET)}`;

      let crudo = "";
      let ultimo: ValidationResult = { valid: false, issues: [] };
      for (let intento = 1; intento <= intentos; intento++) {
        const correccion =
          intento === 1
            ? ""
            : `\n\nTu respuesta anterior no cumplio el contrato:\n${formatear(ultimo.issues)}\nCorrige EXACTAMENTE eso y devuelve solo el JSON.`;
        const respuesta = await pedir(
          sistema,
          `Turno del paciente: ${JSON.stringify(req.utterance)}${correccion}`,
          opciones.temperatura_interpret ?? TEMPERATURA_INTERPRET_POR_DEFECTO,
          opciones.max_tokens_interpret ?? MAX_TOKENS_INTERPRET_POR_DEFECTO,
          true,
        );
        crudo = respuesta.choices?.[0]?.message?.content ?? "";
        let valor: unknown;
        try {
          valor = JSON.parse(crudo);
        } catch (e) {
          ultimo = { valid: false, issues: [{ path: "", code: "tipo_invalido", message: `JSON invalido: ${(e as Error).message}`, hint: "Devuelve solo el objeto JSON." }] };
          continue;
        }
        ultimo = validarSalidaInterpret(valor, unitIds);
        if (ultimo.valid) {
          const v = valor as { extractions: EngineExtraction[]; signals: EngineSignal[] };
          return { extractions: v.extractions, signals: v.signals };
        }
      }
      throw new ErrorDeSalidaNoValidableConversacional(intentos, ultimo.issues, crudo);
    },

    async render(req) {
      const sistema =
        `Eres la VOZ de un agente de seguimiento post-operatorio, hablando con un paciente colombiano por telefono, ` +
        `en espanol coloquial de Colombia (Medellin), calido y natural — nunca un doblaje neutro. Frases cortas, ` +
        `una sola pregunta o intervencion por turno, sin tecnicismos medicos. NO diagnosticas, NO das opinion clinica, ` +
        `NO inventas informacion: solo llevas la conversacion segun el acto que se te indica.\n\n` +
        `Actos posibles y que significan: "continuar" = pregunta algo nuevo segun la intencion dada; "profundizar" = ` +
        `pide el detalle que falta de lo mismo que se esta hablando; "reflejar" = repite brevemente lo que entendiste ` +
        `y pide que lo confirme o corrija, y si se pide precision, pide un dato mas exacto (p.ej. "¿se lo alcanzo a ` +
        `tomar con termometro?") sin usar la palabra "instrumento"; "reformular" = repite la misma pregunta con otras ` +
        `palabras, mas simple; "cambiar_perspectiva" = pregunta lo mismo desde un angulo distinto; "mantener" = una ` +
        `frase breve de transicion o acompañamiento; "suspender" = cierra el tema con calma, sin alarmar.`;

      const prompt =
        `Acto: ${req.act.act}\n` +
        (req.act.hint ? `Pista: ${req.act.hint}\n` : "") +
        `Responde SOLO con la frase que el agente dice al paciente, sin comillas ni explicaciones.`;

      const respuesta = await pedir(
        sistema,
        prompt,
        opciones.temperatura_render ?? TEMPERATURA_RENDER_POR_DEFECTO,
        opciones.max_tokens_render ?? MAX_TOKENS_RENDER_POR_DEFECTO,
        false,
      );
      const texto = respuesta.choices?.[0]?.message?.content ?? "";
      return texto.trim().replace(/^["']|["']$/g, "");
    },
  };
}
