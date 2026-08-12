/**
 * Los criterios de aceptacion del Paso 0, escritos como pruebas.
 *
 * Cada rechazo se comprueba en tres cosas, no en una: que rechace, que apunte al
 * campo exacto, y que el mensaje sea ACCIONABLE — es decir, que diga que hacer y
 * no solo que algo esta mal. Un validador que rechaza sin explicar cuesta lo mismo
 * que un undefined silencioso, solo que mas tarde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ContractValidationError,
  exigirValido,
  validateCallSummary,
  validateContextFrame,
  validateDecision,
  validateDeterministicReport,
  validateSourceDocument,
  validateUnitResults,
  type ValidationIssue,
  type ValidationResult,
} from "../src/index.ts";
import { EJEMPLO_SPEC_8_3 } from "./fixtures/spec-conversacional-8-3.ts";
import {
  DECISION_VALIDA,
  DOCUMENTO_VALIDO,
  REPORTE_VALIDO,
  RESUMEN_VALIDO,
  UNIT_RESULT_NO_SABE,
  UNIT_RESULT_VALIDO,
  copiar,
} from "./fixtures/validos.ts";

// ---------------------------------------------------------------------------
// Utilidades de asercion
// ---------------------------------------------------------------------------

function buscar(res: ValidationResult, path: string): ValidationIssue | undefined {
  return res.issues.find((i) => i.path === path);
}

/** Rechazo con mensaje accionable: hay issue en la ruta, con codigo y con pista util. */
function exigirRechazo(
  res: ValidationResult,
  path: string,
  code: ValidationIssue["code"],
  fragmentoDeLaPista: string,
): ValidationIssue {
  assert.equal(res.valid, false, `se esperaba rechazo en ${path} y el objeto paso`);
  const issue = buscar(res, path);
  assert.ok(
    issue,
    `no hay ningun problema en ${path}. Rutas reportadas: [${res.issues.map((i) => i.path).join(", ")}]`,
  );
  assert.equal(issue.code, code, `codigo inesperado en ${path}`);
  assert.ok(issue.message.length > 0, `el mensaje de ${path} llego vacio`);
  assert.ok(
    issue.hint.toLowerCase().includes(fragmentoDeLaPista.toLowerCase()),
    `la pista de ${path} no explica que hacer. Se recibio: ${issue.hint}`,
  );
  return issue;
}

// ---------------------------------------------------------------------------
// Criterio 1 — el ContextFrame de la spec §8.3 valida
// ---------------------------------------------------------------------------

test("el ContextFrame de ejemplo de la spec §8.3 valida", () => {
  const res = validateContextFrame(EJEMPLO_SPEC_8_3);
  assert.deepEqual(
    res.issues,
    [],
    `el ejemplo de la spec debe validar sin observaciones; se reportaron: ${JSON.stringify(res.issues, null, 2)}`,
  );
  assert.equal(res.valid, true);
});

test("los objetos validos de referencia pasan en los cinco tipos normativos", () => {
  for (const [etiqueta, res] of [
    ["UnitResult", validateUnitResults([UNIT_RESULT_VALIDO, UNIT_RESULT_NO_SABE])],
    ["Decision", validateDecision(DECISION_VALIDA)],
    ["DeterministicReport", validateDeterministicReport(REPORTE_VALIDO)],
    ["SourceDocument", validateSourceDocument(DOCUMENTO_VALIDO)],
    ["CallSummary", validateCallSummary(RESUMEN_VALIDO)],
  ] as const) {
    assert.deepEqual(res.issues, [], `${etiqueta} valido fue rechazado: ${JSON.stringify(res.issues, null, 2)}`);
  }
});

// ---------------------------------------------------------------------------
// Criterio 2 — los seis rechazos, con mensaje accionable
// ---------------------------------------------------------------------------

test("rechaza priority invalida y dice cual usar", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  (marco["units"] as Record<string, unknown>[])[0]!["priority"] = "urgente";

  const issue = exigirRechazo(
    validateContextFrame(marco),
    "units[0].priority",
    "valor_fuera_de_enum",
    "opportunistic",
  );
  assert.ok(issue.message.includes("urgente"), "el mensaje debe citar el valor recibido");
  assert.ok(issue.message.includes("required"), "el mensaje debe enumerar los valores admitidos");
});

test("rechaza unit.id duplicado y señala donde se declaro primero", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  const unidades = marco["units"] as Record<string, unknown>[];
  unidades[2]!["id"] = "dolor_intensidad"; // ya existe en units[0]

  const issue = exigirRechazo(
    validateContextFrame(marco),
    "units[2].id",
    "duplicado",
    "renombra",
  );
  assert.ok(
    issue.message.includes("units[0]"),
    "el mensaje debe decir donde estaba la primera declaracion, no solo que hay duplicado",
  );
});

test("rechaza depends_on que apunta a una unidad inexistente", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  const unidades = marco["units"] as Record<string, unknown>[];
  unidades[0]!["depends_on"] = ["unidad_que_no_existe"];

  const issue = exigirRechazo(
    validateContextFrame(marco),
    "units[0].depends_on[0]",
    "referencia_rota",
    "cubierta_condicionada",
  );
  assert.ok(
    issue.message.includes("unidad_que_no_existe"),
    "el mensaje debe citar la referencia rota",
  );
  assert.ok(
    issue.message.includes("dolor_intensidad"),
    "el mensaje debe enumerar las unidades que si existen en el marco",
  );
});

test("rechaza composes que apunta a una unidad inexistente, con pista propia", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  const unidades = marco["units"] as Record<string, unknown>[];
  unidades[3]!["composes"] = ["aspecto_herida", "unidad_fantasma"];

  exigirRechazo(
    validateContextFrame(marco),
    "units[3].composes[1]",
    "referencia_rota",
    "frame_delta",
  );
});

test("rechaza una unidad que depende de si misma", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  const unidades = marco["units"] as Record<string, unknown>[];
  unidades[1]!["depends_on"] = ["aspecto_herida"];

  exigirRechazo(
    validateContextFrame(marco),
    "units[1].depends_on[0]",
    "referencia_rota",
    "no puede depender de si misma",
  );
});

test("rechaza state fuera de rango y distingue state de confidence en la pista", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["state"] = 7;

  const issue = exigirRechazo(
    validateUnitResults([unidad]),
    "units[0].state",
    "fuera_de_rango",
    "confidence",
  );
  assert.ok(issue.message.includes("7"), "el mensaje debe citar el valor recibido");
  assert.ok(
    issue.hint.includes("[0,1]") && issue.hint.includes("SALUD DE LA EXTRACCION"),
    "la pista debe explicar la distincion de ADR-005, que es el punto de confusion del proyecto",
  );
});

test("rechaza state decimal: el motor trabaja con enteros", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["state"] = 1.5;
  exigirRechazo(validateUnitResults([unidad]), "units[0].state", "no_entero", "ADR-005");
});

test("rechaza confidence fuera de [0,1] y remite a state en la pista", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["confidence"] = 3;
  exigirRechazo(validateUnitResults([unidad]), "units[0].confidence", "fuera_de_rango", "state");
});

test("rechaza una Decision sin reason", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  delete decision["reason"];

  exigirRechazo(validateDecision(decision), "reason", "campo_ausente", "auditable");
});

test("rechaza una Decision con reason vacio: presente no es lo mismo que dicho", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  decision["reason"] = "   ";

  exigirRechazo(validateDecision(decision), "reason", "vacio", "auditable");
});

test("rechaza una Decision sin trazas", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  delete decision["traces"];

  const issue = exigirRechazo(validateDecision(decision), "traces", "campo_ausente", "doc_ids");
  assert.ok(
    issue.hint.includes("rules_fired"),
    "la pista debe nombrar las dos evidencias: doc_ids del VP y rules_fired del VD",
  );
});

test("rechaza un CallSummary sin decision.traces", () => {
  const resumen = copiar(RESUMEN_VALIDO) as unknown as Record<string, unknown>;
  delete (resumen["decision"] as Record<string, unknown>)["traces"];

  exigirRechazo(validateCallSummary(resumen), "decision.traces", "campo_ausente", "autocontenido");
});

// ---------------------------------------------------------------------------
// Ninguna validacion devuelve undefined silencioso
// ---------------------------------------------------------------------------

test("ningun validador acepta basura ni devuelve undefined silencioso", () => {
  const basura = [undefined, null, 42, "texto", [], true];
  const validadores = [
    ["validateContextFrame", validateContextFrame],
    ["validateDecision", validateDecision],
    ["validateDeterministicReport", validateDeterministicReport],
    ["validateSourceDocument", validateSourceDocument],
    ["validateCallSummary", validateCallSummary],
  ] as const;

  for (const [nombre, validar] of validadores) {
    for (const entrada of basura) {
      const res = validar(entrada);
      assert.equal(res.valid, false, `${nombre} acepto ${JSON.stringify(entrada)}`);
      assert.ok(res.issues.length > 0, `${nombre} rechazo sin decir por que`);
    }
  }
});

test("todo problema reportado trae ruta, mensaje y pista no vacios", () => {
  // Un objeto roto en varios sitios a la vez: la validacion acumula, no corta al primero.
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  const unidades = marco["units"] as Record<string, unknown>[];
  unidades[0]!["priority"] = "urgente";
  unidades[1]!["id"] = "dolor_intensidad";
  unidades[2]!["depends_on"] = ["fantasma"];
  delete marco["frame_id"];
  (marco["policy"] as Record<string, unknown>)["stall_window"] = 0;

  const res = validateContextFrame(marco);
  assert.ok(res.issues.length >= 5, `se esperaban al menos 5 problemas acumulados, hubo ${res.issues.length}`);

  for (const issue of res.issues) {
    assert.ok(issue.path.length > 0, "hay un problema sin ruta");
    assert.ok(issue.message.trim().length > 0, `el problema en ${issue.path} no tiene mensaje`);
    assert.ok(issue.hint.trim().length > 0, `el problema en ${issue.path} no dice que hacer`);
    assert.notEqual(issue.message, issue.hint, `en ${issue.path} el mensaje y la pista son lo mismo`);
  }
});

test("exigirValido lanza con todos los problemas formateados, no solo el primero", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  delete decision["reason"];
  delete decision["traces"];

  assert.throws(
    () => exigirValido("Decision de la sesion s_0042", validateDecision(decision)),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.issues.length, 2);
      assert.ok(error.message.includes("Decision de la sesion s_0042"));
      assert.ok(error.message.includes("reason"));
      assert.ok(error.message.includes("traces"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Guardarrailes de ADR-014 y ADR-018 que el esquema puede sostener
// ---------------------------------------------------------------------------

test("rechaza una Decision que no escala con un reason_code que siempre alerta", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  decision["escalate"] = false;
  decision["reason_code"] = "falla_tecnica";

  exigirRechazo(validateDecision(decision), "escalate", "incoherencia", "A la falla, actua humano");
});

test("rechaza silencio con contexto incompleto: es la degradacion segura de ADR-014", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  decision["escalate"] = false;
  decision["reason_code"] = "evaluado";
  decision["context_complete"] = false;

  exigirRechazo(validateDecision(decision), "escalate", "incoherencia", "contexto_incompleto");
});

test("ACEPTA reason_code evaluado con trazas vacias: hay casos en que de verdad lo estan", () => {
  // Corrección del 8-ago. Antes esto se rechazaba, razonando que si ambos votos se
  // ponderaron tuvieron que dejar evidencia. Medido contra el dominio y el corpus
  // reales, las dos trazas son legítimamente vacías:
  //
  //   `rules_fired` — un caso verde limpio produce un DeterministicReport SIN NINGÚN
  //   hallazgo, y por tanto sin un solo rule_id. El VD sí se leyó: aplicó su regla
  //   por defecto, y esa viaja en `vd_rule`.
  //
  //   `doc_ids` — con piso de relevancia, una unidad sobre la que el corpus no
  //   sostiene una cita devuelve cero fragmentos. No es un fallo: es el sistema
  //   negándose a fabricar respaldo.
  //
  // Y el motivo de fondo para retirarla: una regla de esquema que declara inválido
  // lo que de verdad ocurre EMPUJA A FABRICAR — la única forma de pasarla en un caso
  // verde es inventar un rule_id. Eso es exactamente lo que ADR-024 prohíbe.
  //
  // Quien declara los huecos ahora es `CallSummary.evidence_gaps`.
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  (decision["traces"] as Record<string, unknown>)["rules_fired"] = [];
  (decision["traces"] as Record<string, unknown>)["doc_ids"] = [];

  assert.deepEqual(validateDecision(decision).issues, []);
});

test("pero las claves de traza siguen siendo obligatorias: la ausencia se declara vacía, no omitida", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  delete (decision["traces"] as Record<string, unknown>)["rules_fired"];

  exigirRechazo(validateDecision(decision), "traces.rules_fired", "campo_ausente", "rule_id");
});

test("rechaza urgencia que traiga reglas deterministas: escalateNow no invoca evaluate", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  decision["reason_code"] = "urgencia";
  (decision["traces"] as Record<string, unknown>)["doc_ids"] = [];

  exigirRechazo(
    validateDecision(decision),
    "traces.rules_fired",
    "incoherencia",
    "en urgencia no hay bucle",
  );
});

test("rechaza el nombre viejo: una Decision con alert en vez de escalate", () => {
  const decision = copiar(DECISION_VALIDA) as unknown as Record<string, unknown>;
  delete decision["escalate"];
  decision["alert"] = true;

  const issue = exigirRechazo(validateDecision(decision), "alert", "campo_prohibido", "escalate nombra la ACCION");
  assert.ok(
    issue.hint.includes("alert_channel"),
    "la pista debe aclarar donde SI sobrevive el termino alert, o invita a buscarlo",
  );
});

test("rechaza max_rounds en policy y explica por que no es solo un campo de mas", () => {
  const marco = copiar(EJEMPLO_SPEC_8_3) as unknown as Record<string, unknown>;
  (marco["policy"] as Record<string, unknown>)["max_rounds"] = 3;

  const issue = exigirRechazo(validateContextFrame(marco), "policy.max_rounds", "campo_prohibido", "context_complete");
  assert.ok(
    issue.hint.includes("insistencia"),
    "la pista debe explicar la consecuencia de diseño: conocer la ronda deja a la conversacional modular su insistencia",
  );
});

// ---------------------------------------------------------------------------
// Coherencias del UnitResult que la tabla de §10.2 hace verificables
// ---------------------------------------------------------------------------

test("rechaza una unidad suspendida sin causa: suspender no es descartar", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["extraction"] = "suspendida";

  exigirRechazo(validateUnitResults([unidad]), "units[0].cause", "incoherencia", "Suspender no es descartar");
});

test("rechaza cubierta_condicionada sin blocked_by", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["extraction"] = "cubierta_condicionada";

  exigirRechazo(validateUnitResults([unidad]), "units[0].blocked_by", "incoherencia", "dependencias sin resolver");
});

test("rechaza un cierre declarado con causa de degradacion", () => {
  const unidad = copiar(UNIT_RESULT_NO_SABE) as unknown as Record<string, unknown>;
  unidad["cause"] = "no_comprende";

  const issue = exigirRechazo(validateUnitResults([unidad]), "units[0].closure", "incoherencia", "extraccion EXITOSA");
  assert.ok(
    issue.message.includes("no_comprende"),
    "el mensaje debe citar la causa que no encaja con el cierre",
  );
});

test("rechaza una unidad que el marco no pidio, cuando se valida contra el marco", () => {
  const unidad = copiar(UNIT_RESULT_VALIDO) as unknown as Record<string, unknown>;
  unidad["id"] = "unidad_inventada";

  exigirRechazo(
    validateUnitResults([unidad], { frame: EJEMPLO_SPEC_8_3 }),
    "units[0].id",
    "referencia_rota",
    "transcript_digest",
  );
});

// ---------------------------------------------------------------------------
// Coherencias del reporte determinista
// ---------------------------------------------------------------------------

test("rechaza un reporte sin cobertura: la no evaluabilidad es resultado, no vacio", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  delete reporte["coverage"];

  exigirRechazo(validateDeterministicReport(reporte), "coverage", "campo_ausente", "cobertura antes del silencio");
});

test("rechaza un ratio de cobertura que no se corresponde con las listas", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  (reporte["coverage"] as Record<string, unknown>)["ratio"] = 1;

  const issue = exigirRechazo(validateDeterministicReport(reporte), "coverage.ratio", "incoherencia", "se deriva");
  assert.ok(
    issue.hint.includes("escalate: false"),
    "la pista debe decir por que importa: es el numero que el decisor consulta antes de callar",
  );
});

test("rechaza un hallazgo sin rule_id: invariante 1 de la spec §6.4", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  const clases = (reporte["funcionalidad"] as Record<string, unknown>)["clases"] as Record<string, unknown>[];
  delete clases[0]!["rule_id"];

  exigirRechazo(
    validateDeterministicReport(reporte),
    "funcionalidad.clases[0].rule_id",
    "campo_ausente",
    "no reconstruible",
  );
});

test("rechaza el nombre viejo unit_ids en un hallazgo: invariante 3 de la spec §6.4", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  const clases = (reporte["funcionalidad"] as Record<string, unknown>)["clases"] as Record<string, unknown>[];
  clases[0]!["unit_ids"] = clases[0]!["origen_unit_ids"];
  delete clases[0]!["origen_unit_ids"];

  const res = validateDeterministicReport(reporte);
  exigirRechazo(res, "funcionalidad.clases[0].origen_unit_ids", "campo_ausente", "origen_unit_ids en los tres");
  exigirRechazo(res, "funcionalidad.clases[0].unit_ids", "campo_desconocido", "correccion X-6");
});
