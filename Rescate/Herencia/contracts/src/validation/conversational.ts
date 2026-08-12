/**
 * Validacion de la costura conversacional <-> decision.
 *
 * Valida en AMBOS SENTIDOS: el `ContextFrame` que baja del decisor y el marco
 * hidratado (`UnitResult[]`) que sube de la conversacional. Las dos direcciones
 * cruzan la misma frontera y las dos pueden llegar mal.
 */

import {
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  STATE_MAX,
  STATE_MIN,
} from "../conversational.ts";
import { agregar, resultado, type IssueSink, type ValidationResult } from "./issues.ts";
import {
  esRegistro,
  exigirArreglo,
  exigirArregloDeCadenas,
  exigirBooleano,
  exigirCadena,
  exigirCadenaONulo,
  exigirEnum,
  exigirNumero,
  exigirObjeto,
  rechazarClavesDesconocidas,
  rechazarDuplicados,
} from "./primitives.ts";

// --- Enumerados en tiempo de ejecucion --------------------------------------
// Estan aqui y no en los archivos de tipos porque los archivos de tipos no
// contienen valores: son la superficie que las cuatro capas importan y debe
// borrarse entera al compilar.

export const PRIORIDADES = ["required", "desired", "opportunistic"] as const;
export const TIPOS_DE_UNIDAD = ["boolean", "scale", "categorical", "quantity", "free"] as const;
export const DIMENSIONES_DE_COBERTURA = ["value", "onset", "trend", "magnitude"] as const;
export const ESTADOS_DE_EXTRACCION = [
  "cubierta",
  "cubierta_condicionada",
  "hidratada_sin_normalizar",
  "suspendida",
] as const;
export const CAUSAS = [
  "no_sabe",
  "no_aplica",
  "no_comprende",
  "rehusa",
  "sin_respuesta",
  "incoherente",
  "interrumpido",
  "bloqueado_por_urgencia",
] as const;
export const CIERRES = ["declarado", "degradacion", "corte"] as const;
export const CRITICIDADES = ["verde", "amarillo", "rojo"] as const;
export const REASON_CODES = [
  "evaluado",
  "vigilancia",
  "contexto_incompleto",
  "incongruencia",
  "falla_tecnica",
  "urgencia",
] as const;

/** §10.2 — que causas admite cada tipo de cierre. La tabla, ejecutable. */
const CAUSAS_POR_CIERRE: Record<(typeof CIERRES)[number], readonly string[]> = {
  declarado: ["no_sabe", "no_aplica", "rehusa"],
  degradacion: ["no_comprende", "incoherente", "sin_respuesta"],
  corte: ["interrumpido", "bloqueado_por_urgencia"],
};

const CLAVES_UNIT_SPEC = [
  "id",
  "intent",
  "priority",
  "type",
  "coverage",
  "lexicon",
  "depends_on",
  "composes",
] as const;

const CLAVES_POLICY = [
  "max_turns",
  "max_session_ms",
  "reflect_below_confidence",
  "stall_window",
  "allow_partial_handback",
] as const;

const CLAVES_CONTEXT_FRAME = [
  "frame_id",
  "patient_ref",
  "round",
  "units",
  "red_flags",
  "policy",
] as const;

const CLAVES_UNIT_RESULT = [
  "id",
  "extraction",
  "state",
  "state_trace",
  "raw",
  "normalized",
  "confidence",
  "coverage_met",
  "cause",
  "closure",
  "blocked_by",
  "turn_refs",
] as const;

const CLAVES_DECISION = [
  "escalate",
  "criticality",
  "reason",
  "reason_code",
  "say_to_patient",
  "traces",
  "context_complete",
] as const;

const REF_FRAME = "docs/Especificacion-Capa-Conversacional.md §8.2";
const REF_UNIT_RESULT = "docs/Especificacion-Capa-Conversacional.md §15.1";
const REF_DECISION = "docs/Especificacion-Capa-Conversacional.md §15.1 + ADR-018";

// ---------------------------------------------------------------------------
// ContextFrame
// ---------------------------------------------------------------------------

export function validateContextFrame(valor: unknown): ValidationResult {
  const sink: IssueSink = [];
  const marco = exigirObjeto(sink, "", valor, "un ContextFrame");
  if (!marco) return resultado(sink);

  rechazarClavesDesconocidas(
    sink,
    "",
    marco,
    CLAVES_CONTEXT_FRAME,
    `El marco solo transporta estructura. Si necesitas mandar criterio clinico, no va aqui: vive del lado del decisor (${REF_FRAME}).`,
  );

  exigirCadena(sink, "frame_id", marco["frame_id"], {
    noVacia: true,
    hint: `El frame_id identifica esta ronda de extraccion y viaja de vuelta en submitFrame (${REF_FRAME}).`,
  });

  exigirCadenaONulo(
    sink,
    "patient_ref",
    marco["patient_ref"],
    `Usa null cuando la identidad quedo unverified; nunca omitas la clave (${REF_FRAME}).`,
  );

  exigirNumero(sink, "round", marco["round"], {
    min: 0,
    entero: true,
    hint: `0 es el marco inicial; cada frame_delta incrementa en 1 (${REF_FRAME}).`,
  });

  validarPolicy(sink, marco["policy"]);
  validarRedFlags(sink, marco["red_flags"]);
  const idsDeclarados = validarUnitSpecs(sink, marco["units"]);
  validarReferenciasEntreUnidades(sink, marco["units"], idsDeclarados);

  return resultado(sink);
}

function validarPolicy(sink: IssueSink, valor: unknown): void {
  const policy = exigirObjeto(sink, "policy", valor, "el objeto policy");
  if (!policy) return;

  // Correccion X-4: `max_rounds` no vive aqui, y colarlo tiene consecuencia de
  // diseño, no solo de esquema — le permitiria a la conversacional modular su
  // insistencia segun el presupuesto del decisor.
  if ("max_rounds" in policy) {
    agregar(
      sink,
      "policy.max_rounds",
      "campo_prohibido",
      `policy no admite max_rounds. El bucle de rondas lo gobierna el decisor (ADR-003), no la conversacional.`,
      `Quita el campo. Si necesitas limitar las rondas, hazlo en el decisor: agotarlo produce una Decision con context_complete: false. Conocer la ronda desde la conversacional le permitiria modular su insistencia segun un presupuesto que por diseño no debe ver (docs/Especificacion-Capa-Conversacional.md §16, correccion X-4).`,
    );
  }

  rechazarClavesDesconocidas(
    sink,
    "policy",
    policy,
    CLAVES_POLICY,
    `policy es red de seguridad, no criterio de cierre: el cierre lo decide el estado del motor (§16).`,
  );

  exigirNumero(sink, "policy.max_turns", policy["max_turns"], {
    min: 1,
    entero: true,
    hint: `Turnos por ronda antes de forzar submitFrame. Debe ser al menos 1 (§16).`,
  });
  exigirNumero(sink, "policy.max_session_ms", policy["max_session_ms"], {
    min: 1,
    entero: true,
    hint: `Reloj de pared de la sesion: el paciente esta al telefono (§16).`,
  });
  exigirNumero(sink, "policy.reflect_below_confidence", policy["reflect_below_confidence"], {
    min: CONFIDENCE_MIN,
    max: CONFIDENCE_MAX,
    hint: `Es un umbral sobre UnitResult.confidence, que vive en [0,1]. No lo confundas con state, que vive en [-3,3] y mide otra cosa (ADR-005).`,
  });
  exigirNumero(sink, "policy.stall_window", policy["stall_window"], {
    min: 1,
    entero: true,
    hint: `Turnos consecutivos en negativo para declarar ciclo retroactivo (§9.5).`,
  });
  exigirBooleano(
    sink,
    "policy.allow_partial_handback",
    policy["allow_partial_handback"],
    `Si el decisor acepta un marco parcial cuando se agota el presupuesto (§16).`,
  );
}

function validarRedFlags(sink: IssueSink, valor: unknown): void {
  const banderas = exigirArreglo(sink, "red_flags", valor, {
    hint: `Puede ir vacio, pero la clave debe existir: la interrupcion prioritaria es parte del contrato (§14).`,
  });
  if (!banderas) return;

  banderas.forEach((bandera, i) => {
    const ruta = `red_flags[${i}]`;
    const obj = exigirObjeto(sink, ruta, bandera, "una RedFlagSpec");
    if (!obj) return;
    rechazarClavesDesconocidas(sink, ruta, obj, ["id", "patterns"], `Una red flag es id + patrones de superficie (§14).`);
    exigirCadena(sink, `${ruta}.id`, obj["id"], {
      noVacia: true,
      hint: `Este id viaja literal en escalateNow y en la Decision de urgencia (§14).`,
    });
    exigirArregloDeCadenas(sink, `${ruta}.patterns`, obj["patterns"], {
      noVacio: true,
      hint: `Una red flag sin patrones no dispara nunca. Declara al menos una frase de superficie (§14).`,
    });
  });
}

function validarUnitSpecs(sink: IssueSink, valor: unknown): string[] {
  const unidades = exigirArreglo(sink, "units", valor, {
    noVacio: true,
    hint: `Un marco sin unidades no pide nada. Si es un frame_delta, trae solo las unidades reabiertas, pero al menos una (${REF_FRAME}).`,
  });
  if (!unidades) return [];

  const ids: (string | undefined)[] = [];

  unidades.forEach((unidad, i) => {
    const ruta = `units[${i}]`;
    const obj = exigirObjeto(sink, ruta, unidad, "una UnitSpec");
    if (!obj) {
      ids.push(undefined);
      return;
    }

    rechazarClavesDesconocidas(
      sink,
      ruta,
      obj,
      CLAVES_UNIT_SPEC,
      `El marco no trae umbrales, reglas ni criterios clinicos: si dijera "si la temperatura supera 38.5 marcar infeccion", la conversacional estaria diagnosticando (§8.1).`,
    );

    const id = exigirCadena(sink, `${ruta}.id`, obj["id"], {
      noVacia: true,
      hint: `El id es la clave con la que la unidad vuelve en UnitResult y se referencia en depends_on y composes (${REF_FRAME}).`,
    });
    ids.push(id);

    exigirCadena(sink, `${ruta}.intent`, obj["intent"], {
      noVacia: true,
      hint: `intent dice QUE se necesita saber, no como preguntarlo: es prosa dirigida a la conversacional, no al paciente (§8.2).`,
    });

    exigirEnum(
      sink,
      `${ruta}.priority`,
      obj["priority"],
      PRIORIDADES,
      `Usa "required" si la unidad debe preguntarse siempre, "desired" si conviene pero no bloquea, y "opportunistic" si solo se hidrata cuando el paciente la toca — las opportunistic NUNCA se preguntan (§8.2).`,
    );

    exigirEnum(
      sink,
      `${ruta}.type`,
      obj["type"],
      TIPOS_DE_UNIDAD,
      `El tipo condiciona como se normaliza el valor: boolean, scale, categorical, quantity o free (§8.2).`,
    );

    validarCoverage(sink, `${ruta}.coverage`, obj["coverage"]);
    if (obj["lexicon"] !== undefined) validarLexicon(sink, `${ruta}.lexicon`, obj["lexicon"]);

    if (obj["depends_on"] !== undefined) {
      exigirArregloDeCadenas(sink, `${ruta}.depends_on`, obj["depends_on"], {
        noVacio: true,
        hint: `Si no hay dependencias, omite la clave en vez de mandarla vacia (enlace 6, §8.2).`,
      });
    }
    if (obj["composes"] !== undefined) {
      exigirArregloDeCadenas(sink, `${ruta}.composes`, obj["composes"], {
        noVacio: true,
        hint: `Una unidad compuesta emerge de otras: declara al menos dos componentes o quita la clave (§8.3).`,
      });
    }
  });

  rechazarDuplicados(
    sink,
    "units",
    ids,
    "id de unidad",
    `Dos unidades con el mismo id hacen ambiguo el UnitResult que vuelve: el decisor no sabria cual hidrato la conversacional. Renombra una (${REF_FRAME}).`,
  );

  return ids.filter((id): id is string => id !== undefined);
}

function validarCoverage(sink: IssueSink, ruta: string, valor: unknown): void {
  const coverage = exigirObjeto(sink, ruta, valor, "el objeto coverage");
  if (!coverage) return;
  rechazarClavesDesconocidas(sink, ruta, coverage, ["requires"], `coverage solo declara requires (enlace 2, §8.2).`);

  const requires = exigirArreglo(sink, `${ruta}.requires`, coverage["requires"], {
    noVacio: true,
    hint: `Una unidad sin ninguna dimension requerida nunca se puede dar por cubierta. Declara al menos "value" (§8.2).`,
  });
  if (!requires) return;

  requires.forEach((dimension, i) => {
    exigirEnum(
      sink,
      `${ruta}.requires[${i}]`,
      dimension,
      DIMENSIONES_DE_COBERTURA,
      `Las dimensiones del motor son value, onset, trend y magnitude. Un dolor con valor pero sin trend esta cubierto a medias, y el motor lo sabe (§8.2).`,
    );
  });
}

function validarLexicon(sink: IssueSink, ruta: string, valor: unknown): void {
  const lexicon = exigirObjeto(sink, ruta, valor, "el objeto lexicon");
  if (!lexicon) return;
  rechazarClavesDesconocidas(
    sink,
    ruta,
    lexicon,
    ["values", "synonyms", "requires_precision", "unit"],
    `El lexicon es el corazon de ADR-002: vocabulario canonico, sinonimos esperados, expresiones que piden precision y unidad (§8.2).`,
  );

  if (lexicon["requires_precision"] !== undefined) {
    exigirArregloDeCadenas(sink, `${ruta}.requires_precision`, lexicon["requires_precision"], {
      noVacio: true,
      hint: `Expresiones que tocan la unidad y NO la cuantifican ("calorcito", "molestia"). Producen normalized: null con el raw intacto y disparan reflejo, jamas un valor canonico: mapearlas inventaria precision que el paciente no dio (ADR-024). Si no hay ninguna, omite la clave en vez de mandarla vacia.`,
    });

    // Una expresion no puede estar en las dos listas: una produce valor y la otra
    // se niega a producirlo. Tenerla en ambas hace que el resultado dependa de en
    // cual mire primero quien extrae, y eso es un bug que solo aparece en produccion.
    const sinonimos = lexicon["synonyms"];
    if (esRegistro(sinonimos) && Array.isArray(lexicon["requires_precision"])) {
      const enSinonimos = new Set(
        Object.values(sinonimos).flatMap((v) => (Array.isArray(v) ? v.map(String) : [])),
      );
      for (const expr of lexicon["requires_precision"] as unknown[]) {
        if (typeof expr === "string" && enSinonimos.has(expr)) {
          agregar(
            sink,
            `${ruta}.requires_precision`,
            "incoherencia",
            `La expresion ${JSON.stringify(expr)} esta a la vez en synonyms y en requires_precision.`,
            `Son categorias opuestas: synonyms PRODUCE normalized y requires_precision se niega a producirlo. Decide cual es, o el valor extraido dependera de en que lista mire primero quien extrae (§8.2).`,
          );
        }
      }
    }
  }

  exigirArregloDeCadenas(sink, `${ruta}.values`, lexicon["values"], {
    hint: `Puede ir vacio para valores numericos libres (asi lo hace "fiebre" en el ejemplo de §8.3), pero la clave debe existir.`,
  });

  if (lexicon["synonyms"] !== undefined) {
    const sinonimos = exigirObjeto(sink, `${ruta}.synonyms`, lexicon["synonyms"], "el mapa de sinonimos");
    if (sinonimos) {
      const canonicos = Array.isArray(lexicon["values"]) ? (lexicon["values"] as unknown[]) : [];
      for (const [canonico, variantes] of Object.entries(sinonimos)) {
        exigirArregloDeCadenas(sink, `${ruta}.synonyms.${canonico}`, variantes, {
          noVacio: true,
          hint: `Cada entrada mapea regionalismos esperados al termino canonico (§8.2).`,
        });
        if (canonicos.length > 0 && !canonicos.includes(canonico)) {
          agregar(
            sink,
            `${ruta}.synonyms.${canonico}`,
            "referencia_rota",
            `El termino canonico ${JSON.stringify(canonico)} no esta en lexicon.values.`,
            `Los sinonimos mapean regionalismo -> canonico; el canonico tiene que existir en values, o la normalizacion produce un valor que el decisor no declaro (§8.2).`,
          );
        }
      }
    }
  }

  if (lexicon["unit"] !== undefined) {
    exigirCadena(sink, `${ruta}.unit`, lexicon["unit"], {
      noVacia: true,
      hint: `Ejemplos del dominio: "°C", "dias", "1-10" (§8.2).`,
    });
  }
}

function validarReferenciasEntreUnidades(
  sink: IssueSink,
  valor: unknown,
  idsDeclarados: readonly string[],
): void {
  if (!Array.isArray(valor)) return;

  valor.forEach((unidad, i) => {
    if (!esRegistro(unidad)) return;
    const propioId = typeof unidad["id"] === "string" ? unidad["id"] : undefined;

    for (const campo of ["depends_on", "composes"] as const) {
      const referencias = unidad[campo];
      if (!Array.isArray(referencias)) continue;

      referencias.forEach((referencia, j) => {
        if (typeof referencia !== "string") return;
        const ruta = `units[${i}].${campo}[${j}]`;

        if (referencia === propioId) {
          agregar(
            sink,
            ruta,
            "referencia_rota",
            `La unidad ${JSON.stringify(referencia)} se referencia a si misma en ${campo}.`,
            `Una unidad no puede depender de si misma ni componerse de si misma: el grafo no cerraria nunca (enlace 6, §8.2).`,
          );
          return;
        }

        if (!idsDeclarados.includes(referencia)) {
          agregar(
            sink,
            ruta,
            "referencia_rota",
            `${campo} apunta a ${JSON.stringify(referencia)}, que no es ninguna de las unidades declaradas en este marco [${idsDeclarados.join(", ")}].`,
            campo === "depends_on"
              ? `Declara la unidad referenciada en el mismo marco o quita la dependencia: la conversacional no puede resolver una dependencia contra algo que no recibio, y la unidad quedaria en cubierta_condicionada para siempre (enlace 6, §8.2).`
              : `Una unidad compuesta emerge de otras del MISMO marco. Si el componente vive en otra ronda, reabrelo en el frame_delta junto con la compuesta (§8.3).`,
          );
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// UnitResult
// ---------------------------------------------------------------------------

export interface OpcionesUnitResults {
  /** Si se pasa, se comprueba que cada unidad devuelta exista en el marco. */
  frame?: unknown;
}

export function validateUnitResult(valor: unknown, ruta = ""): ValidationResult {
  const sink: IssueSink = [];
  validarUnUnitResult(sink, ruta, valor);
  return resultado(sink);
}

export function validateUnitResults(
  valor: unknown,
  opciones: OpcionesUnitResults = {},
): ValidationResult {
  const sink: IssueSink = [];
  const unidades = exigirArreglo(sink, "units", valor, {
    hint: `submitFrame transporta el marco hidratado: un arreglo de UnitResult, aunque sea vacio en una interrupcion temprana (${REF_UNIT_RESULT}).`,
  });
  if (!unidades) return resultado(sink);

  const ids: (string | undefined)[] = [];
  unidades.forEach((unidad, i) => {
    ids.push(validarUnUnitResult(sink, `units[${i}]`, unidad));
  });

  rechazarDuplicados(
    sink,
    "units",
    ids,
    "id de unidad",
    `Dos resultados para la misma unidad dejan al decisor sin saber cual es el vigente (${REF_UNIT_RESULT}).`,
  );

  const marco = opciones.frame;
  if (esRegistro(marco) && Array.isArray(marco["units"])) {
    const declarados = marco["units"]
      .map((u) => (esRegistro(u) && typeof u["id"] === "string" ? u["id"] : undefined))
      .filter((id): id is string => id !== undefined);

    ids.forEach((id, i) => {
      if (id !== undefined && !declarados.includes(id)) {
        agregar(
          sink,
          `units[${i}].id`,
          "referencia_rota",
          `Se devuelve la unidad ${JSON.stringify(id)}, que el marco no pidio. El marco declaro [${declarados.join(", ")}].`,
          `La conversacional hidrata el catalogo que el decisor entrego; no puede inventar unidades. Si el paciente aporto algo fuera del marco, viaja en transcript_digest, que es la valvula de ADR-004 a nivel de conversacion (${REF_UNIT_RESULT}).`,
        );
      }
    });
  }

  return resultado(sink);
}

function validarUnUnitResult(sink: IssueSink, ruta: string, valor: unknown): string | undefined {
  const prefijo = ruta === "" ? "" : `${ruta}.`;
  const obj = exigirObjeto(sink, ruta, valor, "un UnitResult");
  if (!obj) return undefined;

  rechazarClavesDesconocidas(
    sink,
    ruta,
    obj,
    CLAVES_UNIT_RESULT,
    `El UnitResult es lo que el decisor pondera. Un campo de mas aqui es criterio clinico filtrandose desde la conversacional (${REF_UNIT_RESULT}).`,
  );

  const id = exigirCadena(sink, `${prefijo}id`, obj["id"], {
    noVacia: true,
    hint: `Debe coincidir con el UnitSpec.id del marco (${REF_UNIT_RESULT}).`,
  });

  const extraction = exigirEnum(
    sink,
    `${prefijo}extraction`,
    obj["extraction"],
    ESTADOS_DE_EXTRACCION,
    `cubierta, cubierta_condicionada (con depends_on abiertos), hidratada_sin_normalizar (hay evidencia pero no valor mapeable) o suspendida (§10.1).`,
  );

  exigirNumero(sink, `${prefijo}state`, obj["state"], {
    min: STATE_MIN,
    max: STATE_MAX,
    entero: true,
    hint: `state es la SALUD DE LA EXTRACCION y vive en [${STATE_MIN}, ${STATE_MAX}] como entero (ADR-005). Si lo que querias reportar es la fidelidad del mapeo, ese campo es confidence y vive en [0,1]: son cosas distintas y las dos deben viajar.`,
  });

  const trace = exigirArreglo(sink, `${prefijo}state_trace`, obj["state_trace"], {
    hint: `La trayectoria turno a turno distingue "salio limpio" de "costo pero se logro". Puede ir vacia si la unidad no se toco, pero la clave debe existir (§15.2).`,
  });
  if (trace) {
    trace.forEach((punto, i) => {
      exigirNumero(sink, `${prefijo}state_trace[${i}]`, punto, {
        min: STATE_MIN,
        max: STATE_MAX,
        entero: true,
        hint: `Cada punto de la trayectoria es un estado del motor: entero en [${STATE_MIN}, ${STATE_MAX}] (§9.2).`,
      });
    });
  }

  exigirCadenaONulo(
    sink,
    `${prefijo}raw`,
    obj["raw"],
    `ADR-004: el literal del paciente viaja SIEMPRE. Usa null solo si la unidad nunca se toco; no lo omitas y no lo reemplaces por la interpretacion.`,
  );

  const normalized = obj["normalized"];
  if (
    normalized !== null &&
    typeof normalized !== "string" &&
    typeof normalized !== "number" &&
    typeof normalized !== "boolean"
  ) {
    agregar(
      sink,
      `${prefijo}normalized`,
      normalized === undefined ? "campo_ausente" : "tipo_invalido",
      `normalized admite string, number, boolean o null; se recibio ${typeof normalized}.`,
      `Una fiebre es number, una adherencia a medicacion es boolean y un aspecto de herida es string. No serialices a texto: el mismo valor viaja sin convertir hasta el CallSummary (correccion X-7).`,
    );
  }

  exigirNumero(sink, `${prefijo}confidence`, obj["confidence"], {
    min: CONFIDENCE_MIN,
    max: CONFIDENCE_MAX,
    hint: `confidence es la FIDELIDAD DEL MAPEO y vive en [${CONFIDENCE_MIN}, ${CONFIDENCE_MAX}] (ADR-005). Si lo que querias reportar es que tan sana fue la conversacion, ese campo es state y vive en [${STATE_MIN}, ${STATE_MAX}].`,
  });

  const cobertura = exigirArreglo(sink, `${prefijo}coverage_met`, obj["coverage_met"], {
    hint: `Que dimensiones de coverage.requires se satisficieron. Vacio es valido y significativo: la unidad se toco pero no cubrio nada (§8.2).`,
  });
  if (cobertura) {
    cobertura.forEach((dimension, i) => {
      exigirEnum(
        sink,
        `${prefijo}coverage_met[${i}]`,
        dimension,
        DIMENSIONES_DE_COBERTURA,
        `Debe ser una de las dimensiones que el marco declaro en coverage.requires (§8.2).`,
      );
    });
  }

  const causa =
    obj["cause"] === undefined
      ? undefined
      : exigirEnum(
          sink,
          `${prefijo}cause`,
          obj["cause"],
          CAUSAS,
          `Distinguir no_sabe de no_comprende de sin_respuesta es clinicamente decisivo y solo esta capa puede observarlo. Colapsarlas destruye señal irrecuperable (§10.3).`,
        );

  const cierre =
    obj["closure"] === undefined
      ? undefined
      : exigirEnum(
          sink,
          `${prefijo}closure`,
          obj["closure"],
          CIERRES,
          `declarado (el paciente lo dijo con claridad), degradacion (estado -3 o ciclo retroactivo) o corte (presupuesto o urgencia) (§10.2).`,
        );

  if (obj["blocked_by"] !== undefined) {
    exigirArregloDeCadenas(sink, `${prefijo}blocked_by`, obj["blocked_by"], {
      noVacio: true,
      hint: `Si no hay dependencias abiertas, omite la clave en vez de mandarla vacia (§15.1).`,
    });
  }

  exigirArreglo(sink, `${prefijo}turn_refs`, obj["turn_refs"], {
    hint: `Trazabilidad: en que turnos se hidrato esta unidad. Puede ir vacio, pero la clave debe existir (§15.1).`,
  });

  // --- Coherencias entre campos validos por separado -----------------------

  if (extraction === "suspendida" && causa === undefined) {
    agregar(
      sink,
      `${prefijo}cause`,
      "incoherencia",
      `extraction es "suspendida" pero no viene cause.`,
      `Suspender no es descartar: se cierra CON CAUSA y la causa es la informacion. El decisor lee muy distinto un no_sabe que un no_comprende (§10.2, §10.3).`,
    );
  }

  if (extraction === "cubierta_condicionada" && obj["blocked_by"] === undefined) {
    agregar(
      sink,
      `${prefijo}blocked_by`,
      "incoherencia",
      `extraction es "cubierta_condicionada" pero no viene blocked_by.`,
      `Condicionada significa cubierta CON dependencias sin resolver: declara cuales, o usa "cubierta" si ya no queda ninguna (§10.1).`,
    );
  }

  if (cierre !== undefined && causa !== undefined) {
    const admitidas = CAUSAS_POR_CIERRE[cierre];
    if (!admitidas.includes(causa)) {
      agregar(
        sink,
        `${prefijo}closure`,
        "incoherencia",
        `closure "${cierre}" no admite la causa "${causa}". Las causas de ese cierre son [${admitidas.join(", ")}].`,
        `La tabla de §10.2 no es decorativa: un cierre declarado es una extraccion EXITOSA (i1=+1, i3=+1) y uno por degradacion es un estado en -3. Etiquetarlos al reves haria que el decisor pondere una colaboracion como si fuera un fracaso.`,
      );
    }
  }

  return id;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export function validateDecision(valor: unknown, ruta = ""): ValidationResult {
  const sink: IssueSink = [];
  validarUnaDecision(sink, ruta, valor);
  return resultado(sink);
}

export function validarUnaDecision(sink: IssueSink, ruta: string, valor: unknown): void {
  const prefijo = ruta === "" ? "" : `${ruta}.`;
  const obj = exigirObjeto(sink, ruta, valor, "una Decision");
  if (!obj) return;

  if ("alert" in obj) {
    agregar(
      sink,
      `${prefijo}alert`,
      "campo_prohibido",
      `La Decision no lleva "alert". El booleano se llama "escalate".`,
      `Renombra el campo. Teniendo criticality al lado, "alert" invita a leerse como sinonimo de criticality === "rojo", que es exactamente la confusion que ADR-018 elimina: escalate nombra la ACCION y criticality la LECTURA. El termino alert sobrevive solo en alert_channel, que es un destino de entrega (correccion X-1).`,
    );
  }

  rechazarClavesDesconocidas(
    sink,
    ruta,
    obj,
    CLAVES_DECISION,
    `La Decision es el producto terminal: accion, lectura, razon, razon tipificada, verbalizacion, trazas y completitud. Nada mas (${REF_DECISION}).`,
  );

  const escalate = exigirBooleano(
    sink,
    `${prefijo}escalate`,
    obj["escalate"],
    `Es la ACCION, y lo unico sobre lo que opera el ponderador OR de ADR-013. No lo derives de criticality: son campos independientes (ADR-018).`,
  );

  exigirEnum(
    sink,
    `${prefijo}criticality`,
    obj["criticality"],
    CRITICIDADES,
    `Es la LECTURA de gravedad, y es lo que se contrasta contra label_ground_truth del dataset. Colapsarla al booleano perderia el amarillo, que es el 16 % de los casos y el unico tramo donde la decision es interesante (ADR-018).`,
  );

  exigirCadena(sink, `${prefijo}reason`, obj["reason"], {
    noVacia: true,
    hint: `Toda Decision se explica. La razon y la evidencia viajan siempre juntas: una decision sin razon no es auditable, y la auditabilidad es criterio de rubrica (docs/Especificacion-Capa-Decision.md §10).`,
  });

  const reasonCode = exigirEnum(
    sink,
    `${prefijo}reason_code`,
    obj["reason_code"],
    REASON_CODES,
    `Obligatorio: uno opcional deja media auditoria sin codigo. "evaluado" es el camino normal; "vigilancia" el amarillo escalado por seguimiento; los otros cuatro son las ramas de ADR-014 (correccion X-5).`,
  );

  exigirCadena(sink, `${prefijo}say_to_patient`, obj["say_to_patient"], {
    hint: `El decisor entrega la sustancia y la conversacional la reformula con tono y regionalismos. Puede ir vacio si la conversacional redacta sola, pero la clave debe existir (§15.2).`,
  });

  const contextComplete = exigirBooleano(
    sink,
    `${prefijo}context_complete`,
    obj["context_complete"],
    `Habilita la degradacion segura de ADR-014: un contexto incompleto no puede terminar en silencio.`,
  );

  const traces = exigirObjeto(
    sink,
    `${prefijo}traces`,
    obj["traces"],
    "el objeto traces",
    `traces lleva doc_ids (evidencia del VP) y rules_fired (evidencia del VD). Una decision sin trazas no se puede reconstruir, y la trazabilidad documental vale 20 puntos de la rubrica (docs/Especificacion-Capa-Decision.md §10).`,
  );
  if (traces) {
    rechazarClavesDesconocidas(
      sink,
      `${prefijo}traces`,
      traces,
      ["doc_ids", "rules_fired"],
      `La Decision transporta doc_ids y rules_fired. La regla de lectura VD concreta viaja en el CallSummary (vd_rule), no aqui.`,
    );
    const docIds = exigirArregloDeCadenas(sink, `${prefijo}traces.doc_ids`, traces["doc_ids"], {
      hint: `Documentos que sustentaron el voto probabilistico. Vacio es valido cuando no hubo VP (urgencia, falla tecnica), pero la clave debe existir.`,
    });
    const rulesFired = exigirArregloDeCadenas(
      sink,
      `${prefijo}traces.rules_fired`,
      traces["rules_fired"],
      {
        hint: `rule_id de los hallazgos del reporte determinista. Vacio es valido cuando no se invoco evaluate, pero la clave debe existir.`,
      },
    );

    // ============ Por que aqui NO se exige que las trazas vengan llenas ============
    //
    // La version anterior de este bloque marcaba como incoherente un `reason_code:
    // "evaluado"` con `doc_ids` o `rules_fired` vacios, razonando que si ambos votos
    // existieron tuvieron que dejar evidencia. Se retiro el 8-ago, medido contra el
    // corpus y el dominio reales, porque las dos cosas son LEGITIMAMENTE vacias:
    //
    //   `rules_fired` — un caso verde limpio produce un `DeterministicReport` SIN
    //   NINGUN hallazgo, y por tanto sin un solo `rule_id`. El VD si se leyo: la
    //   regla que aplico fue la de por defecto, y esa viaja en `vd_rule`.
    //
    //   `doc_ids` — con piso de relevancia en la recuperacion, una unidad sobre la
    //   que el corpus no sostiene una cita devuelve CERO fragmentos. Eso no es un
    //   fallo: es el sistema negandose a fabricar respaldo.
    //
    // Y el problema no era solo el falso positivo. Una regla de esquema que declara
    // invalido lo que de verdad ocurre EMPUJA A FABRICAR: la unica forma de pasarla
    // en un caso verde es inventar un `rule_id` o citar un documento que no sostiene
    // nada, que es exactamente lo que ADR-024 prohibe y lo que el piso de relevancia
    // acaba de impedir en la otra punta.
    //
    // Lo que reemplaza a esta comprobacion no es nada: es `CallSummary.evidence_gaps`,
    // que DECLARA sobre que unidades no se pudo citar y por que. Un sistema que
    // nombra sus huecos es mas fuerte que uno al que el esquema le exige taparlos.
    //
    // Lo que SI se sigue exigiendo es que las claves existan y sean arreglos: la
    // ausencia de traza se declara vacia, no omitida.
    // ================================================================================
    void docIds;
    void rulesFired;

    if (reasonCode === "urgencia" && rulesFired !== undefined && rulesFired.length > 0) {
      agregar(
        sink,
        `${prefijo}traces.rules_fired`,
        "incoherencia",
        `reason_code es "urgencia" pero vienen ${rulesFired.length} regla(s) determinista(s).`,
        `escalateNow no invoca la capa determinista: en urgencia no hay bucle ni tiempo de analisis estructural. Si hay reglas, alguien la invoco por un camino que la spec no contempla (docs/Especificacion-Capa-Determinista.md §6.1).`,
      );
    }
  }

  // --- ADR-014 y ADR-018 · coherencia entre la accion y su motivo ----------

  if (escalate === false && reasonCode !== undefined && reasonCode !== "evaluado") {
    agregar(
      sink,
      `${prefijo}escalate`,
      "incoherencia",
      `escalate es false con reason_code "${reasonCode}", que es una rama que siempre alerta.`,
      reasonCode === "vigilancia"
        ? `El amarillo escala: un amarillo que no escala es un falso negativo potencial, y un amarillo que escala cuesta la revision de un humano. La razon "vigilancia" existe para que el personal distinga una alerta de seguimiento de una de urgencia, no para no alertar (ADR-018).`
        : `A la falla, actua humano. Las cuatro ramas de ADR-014 —contexto_incompleto, incongruencia, falla_tecnica y urgencia— producen ALERTAR sin pasar por la tabla OR. Un sistema de seguridad cuyo modo de fallo es el silencio no es un sistema de seguridad (ADR-014).`,
    );
  }

  if (contextComplete === false && escalate === false) {
    agregar(
      sink,
      `${prefijo}escalate`,
      "incoherencia",
      `context_complete es false y escalate es false: el contexto quedo incompleto y el sistema callo.`,
      `Es la degradacion segura de ADR-014: un falso positivo cuesta la revision de un humano, un falso negativo cuesta un paciente sin atender. Con contexto incompleto se alerta con reason_code "contexto_incompleto".`,
    );
  }
}
