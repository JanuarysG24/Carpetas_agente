/**
 * WO-41 a WO-44 — el bucle de decision, probado por sus costuras.
 *
 * Pruebas GRUESAS: que el marco se construya y valide, que el bucle cierre, que la
 * tabla VD de las cinco lecturas, y que el ponderador dispare con OR. No se busca
 * cobertura: se busca que el circuito cierre y que las propiedades que el diseño
 * promete no se puedan romper en silencio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateCallSummary,
  validateContextFrame,
  validateDecision,
  type CallSummary,
  type DeterministicReport,
  type SummaryDestination,
  type UnitResult,
  type Vote,
} from "@techsphere/contracts";
import { cargarDominioDesdeArchivo, MotorDeterminista } from "@techsphere/deterministic";

import {
  AlmacenDeFuentes,
  buildFrame,
  buildFrameDelta,
  cargarLexico,
  clasesPresentes,
  coberturaSuficiente,
  CORPUS_SEMILLA,
  criticidadMasGrave,
  DecisionEngineGuion,
  IndiceLexico,
  leerVotoDeterminista,
  Orquestador,
  ponderar,
  TABLA_VD,
  UNIDADES_DEL_DOMINIO,
  VD_VERSION,
  type BaseDeMarco,
} from "../src/index.ts";

const BASE: BaseDeMarco = {
  patient_ref: "pref-9f2c41ab",
  unit_ids: UNIDADES_DEL_DOMINIO,
  dia_postop: 7,
};

const dominio = cargarDominioDesdeArchivo("../docs/dominio/dominio-postop-v0.1.json");
const determinista = new MotorDeterminista(dominio);

function unidad(id: string, normalized: unknown, extra: Partial<UnitResult> = {}): UnitResult {
  return {
    id,
    extraction: "cubierta",
    state: 3,
    state_trace: [3],
    raw: `dijo algo sobre ${id}`,
    normalized: normalized as UnitResult["normalized"],
    confidence: 0.9,
    coverage_met: ["value", "onset", "trend", "magnitude"],
    turn_refs: [1],
    ...extra,
  };
}

/** Un caso rojo del dataset: apetito y sueño en clase maxima con fiebre. */
const ROJO: UnitResult[] = [
  unidad("fiebre", 38.6),
  unidad("dolor_intensidad", 7),
  unidad("aspecto_herida", "secrecion_purulenta"),
  unidad("movilidad", "limitada_esperada"),
  unidad("apetito", "muy_disminuido"),
  unidad("sueno", "muy_alterado"),
];

const VERDE: UnitResult[] = [
  unidad("fiebre", 36.8),
  unidad("dolor_intensidad", 2),
  unidad("aspecto_herida", "normal"),
  unidad("movilidad", "normal"),
  unidad("apetito", "normal"),
  unidad("sueno", "normal"),
];

function orquestador(opciones: { motor?: DecisionEngineGuion } = {}) {
  const almacen = new AlmacenDeFuentes();
  for (const doc of CORPUS_SEMILLA) almacen.ingest(doc, { actor: "prueba" });
  const rag = new IndiceLexico(almacen);
  const entregados: Array<{ resumen: CallSummary; destinos: SummaryDestination[] }> = [];

  const orq = new Orquestador({
    rag,
    determinista,
    motor: opciones.motor ?? new DecisionEngineGuion(),
    proyectar: () => BASE,
    sink: { deliver: (resumen, destinos) => { entregados.push({ resumen, destinos }); return { delivered: [...destinos], failed: [] }; } },
    embedding_model: rag.descriptor(),
  });
  return { orq, entregados };
}

const IDENTIDAD = {
  status: "identificado" as const,
  patient_ref: "pref-9f2c41ab",
  speaker_role: "paciente" as const,
};

const ESTADO = { global: 2, frame_health: 2, retroactive_cycle: false, identity: "identificado" as const };

// ===========================================================================
// WO-41 · el marco
// ===========================================================================

test("WO-41 · el marco se construye con las seis unidades del dominio y VALIDA", () => {
  const frame = buildFrame(BASE, "s1");
  assert.deepEqual(validateContextFrame(frame).issues, []);
  assert.deepEqual(frame.units.map((u) => u.id).sort(), [...UNIDADES_DEL_DOMINIO].sort());
  assert.equal(frame.patient_ref, "pref-9f2c41ab");
  assert.equal(frame.round, 0);
});

test("WO-41 · el marco lleva red flags REALES: sin ellas la urgencia es codigo muerto", () => {
  const flags = buildFrame(BASE, "s1").red_flags;
  assert.ok(flags.length >= 3, "con la lista vacia, detectarUrgencia no puede disparar nunca");
  for (const f of flags) assert.ok(f.patterns.length > 0, `${f.id} sin patrones no dispara jamas`);
});

test("WO-41 · los patrones son de SUPERFICIE: frases, sin magnitudes y sin negacion facil", () => {
  for (const f of buildFrame(BASE, "s1").red_flags) {
    for (const p of f.patterns) {
      // Ni una cifra: el momento en que un patron diga un numero, deja de ser
      // superficie y pasa a ser criterio clinico dentro del marco (ADR-020).
      assert.ok(!/\d/.test(p), `"${p}" trae una magnitud`);
      // `detectarUrgencia` casa subcadena y NO entiende negaciones: un patron de una
      // sola palabra como "sangre" dispararia con "no me sale sangre", que es lo
      // contrario de una urgencia.
      assert.ok(p.trim().includes(" "), `"${p}" es una sola palabra y se dispararia al negarlo`);
    }
  }
});

test("WO-41 · el marco no trae umbrales ni criterio clinico en ningun campo", () => {
  const serializado = JSON.stringify(buildFrame(BASE, "s1"));
  for (const prohibido of ["38.5", "marcar infeccion", "si supera", "diagnostic"]) {
    assert.ok(!serializado.toLowerCase().includes(prohibido.toLowerCase()), `el marco dice "${prohibido}"`);
  }
});

test("WO-41 · el lexico viaja por unidad, con sus tres categorias respetadas", () => {
  const frame = buildFrame(BASE, "s1");
  const fiebre = frame.units.find((u) => u.id === "fiebre")!;

  // `synonyms` produce normalized...
  assert.ok(fiebre.lexicon?.synonyms?.["normal"]?.includes("normalita"));
  // ...y `requires_precision` se niega a producirlo.
  assert.ok(fiebre.lexicon?.requires_precision?.includes("calorcito"));
  assert.equal(fiebre.lexicon?.unit, "celsius");

  // Los atenuadores no viajan como vocabulario de unidad. Ojo: algunos tienen DOBLE
  // PAPEL legitimo —"despacito" atenua y ademas es `requiere_precision` de movilidad,
  // "poquito" atenua y ademas es sinonimo—, asi que la propiedad no es "ninguna
  // expresion de la lista aparece": es que los atenuadores PUROS, los que solo
  // modulan confianza, no se cuelan en ninguna unidad.
  const lexico = cargarLexico();
  const deUnidades = new Set(
    Object.values(lexico.unidades).flatMap((u) => [
      ...Object.values(u.synonyms ?? {}).flatMap((v) => v.map((e) => e.expr)),
      ...(u.requiere_precision ?? []).map((e) => e.expr),
    ]),
  );
  const puros = Object.values(lexico.atenuadores)
    .flatMap((v) => (Array.isArray(v) ? v.map((e) => e.expr) : []))
    .filter((e) => e && !deUnidades.has(e));

  assert.ok(puros.includes("dolorcito") && puros.includes("digamos"), "el fixture del lexico cambio");

  // Comparacion por ELEMENTO, no por subcadena: "a veces" es atenuador puro y a la
  // vez prefijo de "a veces me despierto", que si es sinonimo legitimo de sueno. Un
  // `includes` sobre el JSON serializado lo daba por colado.
  const enElMarco = new Set(
    frame.units.flatMap((u) => [
      ...Object.values(u.lexicon?.synonyms ?? {}).flat(),
      ...(u.lexicon?.requires_precision ?? []),
    ]),
  );
  for (const atenuador of puros) {
    assert.ok(!enElMarco.has(atenuador), `el atenuador puro "${atenuador}" se colo en el marco`);
  }
});

test("WO-41 · ninguna expresion esta a la vez en synonyms y en requires_precision", () => {
  const lexico = cargarLexico();
  for (const [id, unidad] of Object.entries(lexico.unidades)) {
    const sinonimos = new Set(Object.values(unidad.synonyms ?? {}).flat().map((e) => e.expr));
    for (const e of unidad.requiere_precision ?? []) {
      assert.ok(!sinonimos.has(e.expr), `${id}: "${e.expr}" esta en las dos categorias`);
    }
  }
});

test("WO-41 · el frame_delta trae SOLO las reabiertas, con round incrementado", () => {
  const delta = buildFrameDelta(BASE, "s1", ["fiebre", "apetito"], 1);
  assert.deepEqual(validateContextFrame(delta).issues, []);
  assert.deepEqual(delta.units.map((u) => u.id), ["fiebre", "apetito"]);
  assert.equal(delta.round, 1);
});

// ===========================================================================
// WO-43 · la tabla VD
// ===========================================================================

function reporteDe(units: UnitResult[]): DeterministicReport {
  return determinista.evaluate({
    session_id: "s",
    frame_id: "f",
    units,
    modifiers: { dia_postop: 7 },
    domain_version: determinista.describeDomain().domain_version,
  });
}

test("WO-43 · la tabla tiene las cinco reglas del dominio, en orden de gravedad", () => {
  assert.deepEqual(TABLA_VD.map((r) => r.vd_rule), ["VD-01", "VD-02", "VD-03", "VD-04", "VD-05"]);
  assert.deepEqual(TABLA_VD.map((r) => r.lectura), ["rojo", "rojo", "amarillo", "amarillo", "verde"]);
  assert.equal(TABLA_VD.at(-1)!.si_clase_presente, null, "la ultima es la de por defecto");
});

test("WO-43 · un caso rojo dispara VD-01 por convergencia sistemica", () => {
  const r = reporteDe(ROJO);
  assert.ok(clasesPresentes(r).has("convergencia_sistemica"));

  const vd = leerVotoDeterminista(r);
  assert.equal(vd.vd_rule, "VD-01");
  assert.equal(vd.vote.criticality, "rojo");
  assert.equal(vd.vote.escalate, true);
  assert.ok(vd.rules_fired.includes("CO-02"));
  assert.equal(vd.vd_version, VD_VERSION);
});

test("WO-43 · un caso verde cae a VD-05 y NO escala", () => {
  const vd = leerVotoDeterminista(reporteDe(VERDE));
  assert.equal(vd.vd_rule, "VD-05");
  assert.equal(vd.vote.criticality, "verde");
  assert.equal(vd.vote.escalate, false);
});

test("WO-43 · el mismo reporte produce SIEMPRE el mismo voto", () => {
  const r = reporteDe(ROJO);
  assert.deepEqual(leerVotoDeterminista(r), leerVotoDeterminista(r));
  // De aqui viene la consistencia del sistema: temperatura cero no da determinismo
  // en un modelo hospedado, pero esta tabla es identica ante el mismo caso.
});

test("WO-43 · la tabla NO mira dia_postop (E6-R)", () => {
  const conDia = (dia: number) =>
    leerVotoDeterminista(
      determinista.evaluate({
        session_id: "s",
        frame_id: "f",
        units: ROJO,
        modifiers: { dia_postop: dia },
        domain_version: determinista.describeDomain().domain_version,
      }),
    ).vote;

  assert.deepEqual(conDia(1), conDia(14));
  // Meter el dia separaria la banda amarilla, y si el VD resolviera lo dudoso el
  // voto probabilistico sobraria. El dia lo pondera el decisor.
});

// ===========================================================================
// WO-44 · el ponderador
// ===========================================================================

const si: Vote = { escalate: true, criticality: "rojo", reason: "x" };
const no: Vote = { escalate: false, criticality: "verde", reason: "y" };

test("WO-44 · las cuatro filas de la tabla OR", () => {
  assert.equal(ponderar(si, si).escalate, true);
  assert.equal(ponderar(si, no).escalate, true);
  assert.equal(ponderar(no, si).escalate, true, "la fila que justifica ADR-013 entero");
  assert.equal(ponderar(no, no).escalate, false, "dos noes, y solo dos noes, callan");
});

test("WO-44 · NO existe veto: ningun voto negativo apaga uno positivo", () => {
  // Se prueba por exhaustion sobre las dos entradas: no hay ninguna combinacion en
  // que un `escalate: true` desaparezca. La ausencia de la rama es la garantia.
  for (const vp of [true, false]) {
    for (const vd of [true, false]) {
      for (const cvp of ["verde", "amarillo", "rojo"] as const) {
        for (const cvd of ["verde", "amarillo", "rojo"] as const) {
          const r = ponderar(
            { escalate: vp, criticality: cvp, reason: "a" },
            { escalate: vd, criticality: cvd, reason: "b" },
          );
          assert.equal(r.escalate, vp || vd);
        }
      }
    }
  }
});

test("WO-44 · la criticidad NO se pondera: se registra la mas grave", () => {
  assert.equal(criticidadMasGrave("verde", "rojo"), "rojo");
  assert.equal(criticidadMasGrave("amarillo", "verde"), "amarillo");
  // Y no cambia la accion: quedarse con la peor lectura no es ponderar.
  const r = ponderar({ escalate: false, criticality: "amarillo", reason: "a" }, no);
  assert.equal(r.escalate, false);
  assert.equal(r.criticality, "amarillo");
});

test("WO-44 · un amarillo que escala se marca vigilancia, no evaluado", () => {
  const r = ponderar({ escalate: true, criticality: "amarillo", reason: "a" }, no);
  assert.equal(r.reason_code, "vigilancia");
  // El personal alertado no recibe todo con el mismo timbre.
});

test("WO-44 · cobertura antes del silencio: una required sin evaluar no es silencio", () => {
  const parcial = VERDE.filter((u) => u.id !== "sueno").concat(
    unidad("sueno", null, { extraction: "suspendida", cause: "no_sabe", closure: "declarado" }),
  );
  const r = reporteDe(parcial);
  const cobertura = coberturaSuficiente(r, UNIDADES_DEL_DOMINIO);
  assert.equal(cobertura.suficiente, false);
  assert.ok(cobertura.no_evaluadas.includes("sueno"));
});

// ===========================================================================
// WO-42 · el bucle, de punta a punta
// ===========================================================================

test("WO-42 · una sesion completa cierra: requestFrame -> submitFrame -> Decision", async () => {
  const { orq, entregados } = orquestador();

  const frame = await orq.requestFrame({ session_id: "s-verde", identity: IDENTIDAD });
  assert.deepEqual(validateContextFrame(frame).issues, []);

  const veredicto = await orq.submitFrame({
    session_id: "s-verde",
    frame_id: frame.frame_id,
    round: 0,
    units: VERDE,
    session_state: ESTADO,
    transcript_digest: "el paciente dice que va bien",
    budget_spent: { turns: 6, ms: 120_000 },
  });

  assert.equal(veredicto.status, "sufficient");
  const decision = veredicto.status === "sufficient" ? veredicto.decision : null;
  assert.ok(decision);
  assert.deepEqual(validateDecision(decision).issues, []);
  assert.equal(decision.escalate, false, "verde con cobertura completa: los dos votos callan");
  assert.equal(decision.reason_code, "evaluado");
  assert.ok(decision.traces.doc_ids.length >= 0);

  // ADR-016: ninguna sesion sin resumen.
  assert.equal(entregados.length, 1);
  assert.deepEqual(validateCallSummary(entregados[0]!.resumen).issues, []);
  assert.deepEqual(entregados[0]!.destinos, ["session_archive"]);
});

test("WO-42 · un caso rojo escala y el resumen llega tambien al canal", async () => {
  const { orq, entregados } = orquestador();
  const frame = await orq.requestFrame({ session_id: "s-rojo", identity: IDENTIDAD });

  const veredicto = await orq.submitFrame({
    session_id: "s-rojo",
    frame_id: frame.frame_id,
    round: 0,
    units: ROJO,
    session_state: ESTADO,
    transcript_digest: "fiebre y herida con pus",
    budget_spent: { turns: 8, ms: 200_000 },
  });

  assert.equal(veredicto.status, "sufficient");
  const decision = veredicto.status === "sufficient" ? veredicto.decision : null;
  assert.ok(decision?.escalate);
  assert.equal(decision.criticality, "rojo");
  assert.deepEqual(entregados[0]!.destinos, ["session_archive", "alert_channel"]);

  const resumen = entregados[0]!.resumen;
  assert.deepEqual(validateCallSummary(resumen).issues, []);
  assert.equal(resumen.decision.branch, "or");
  assert.equal(resumen.decision.traces.vd_rule, "VD-01");
  assert.ok(resumen.decision.votes?.vp && resumen.decision.votes.vd, "los dos votos viajan como evidencia");
  assert.equal(resumen.findings.length, 6);
});

test("WO-42 · ADR-022: una required sin normalizar produce need_more SIN llamar al modelo", async () => {
  let llamadas = 0;
  class Espia extends DecisionEngineGuion {
    override async assessSufficiency(req: Parameters<DecisionEngineGuion["assessSufficiency"]>[0]) {
      llamadas++;
      return super.assessSufficiency(req);
    }
  }
  const { orq } = orquestador({ motor: new Espia() });
  const frame = await orq.requestFrame({ session_id: "s-parcial", identity: IDENTIDAD });

  const sinNormalizar = VERDE.map((u) =>
    u.id === "apetito" ? unidad("apetito", null, { extraction: "hidratada_sin_normalizar" }) : u,
  );

  const veredicto = await orq.submitFrame({
    session_id: "s-parcial",
    frame_id: frame.frame_id,
    round: 0,
    units: sinNormalizar,
    session_state: ESTADO,
    transcript_digest: "no quedo claro lo del apetito",
    budget_spent: { turns: 4, ms: 90_000 },
  });

  assert.equal(veredicto.status, "need_more");
  assert.equal(llamadas, 0, "la respuesta ya se conocia: llamar al modelo costaba 12,5 s por un booleano");
  const delta = veredicto.status === "need_more" ? veredicto.frame_delta : null;
  assert.deepEqual(delta?.units.map((u) => u.id), ["apetito"], "el delta NOMBRA la unidad que faltaba");
});

test("WO-42 · agotadas las rondas sin cerrar, hay Decision con contexto incompleto", async () => {
  const { orq, entregados } = orquestador();
  const frame = await orq.requestFrame({ session_id: "s-agotada", identity: IDENTIDAD });
  const sinNormalizar = VERDE.map((u) =>
    u.id === "apetito" ? unidad("apetito", null, { extraction: "hidratada_sin_normalizar" }) : u,
  );

  const comun = {
    session_id: "s-agotada",
    frame_id: frame.frame_id,
    units: sinNormalizar,
    session_state: ESTADO,
    transcript_digest: "sigue sin quedar claro",
    budget_spent: { turns: 10, ms: 300_000 },
  };
  await orq.submitFrame({ ...comun, round: 0 });
  await orq.submitFrame({ ...comun, round: 1 });
  const ultimo = await orq.submitFrame({ ...comun, round: 2 });

  assert.equal(ultimo.status, "sufficient");
  const decision = ultimo.status === "sufficient" ? ultimo.decision : null;
  assert.equal(decision?.escalate, true, "a la falla, actua humano");
  assert.equal(decision?.reason_code, "contexto_incompleto");
  assert.equal(decision?.context_complete, false);
  assert.match(decision!.reason, /apetito/);
  assert.equal(entregados.at(-1)!.resumen.decision.branch, "degradacion");
});

test("WO-42 · la urgencia CONSERVA lo explorado, cerrado como bloqueado_por_urgencia", async () => {
  const { orq, entregados } = orquestador();
  const frame = await orq.requestFrame({ session_id: "s-urg-units", identity: IDENTIDAD });

  await orq.escalateNow({
    session_id: "s-urg-units",
    red_flag_id: "RF-respiracion",
    utterance: "no puedo respirar bien desde anoche",
    units_so_far: [unidad("fiebre", 38.2), unidad("dolor_intensidad", 6)],
  });

  const resumen = entregados.at(-1)!.resumen;
  assert.deepEqual(validateCallSummary(resumen).issues, []);

  // Las seis unidades del marco viajan: dos con lo que alcanzo a contar...
  assert.equal(resumen.findings.length, frame.units.length);
  assert.equal(resumen.findings.find((f) => f.unit_id === "fiebre")?.normalized, 38.2);

  // ...y las otras cuatro declaradas como lo que son. `findings: []` habria sido
  // indistinguible de una llamada en la que no se pregunto nada, y son dos cosas
  // distintas.
  const bloqueadas = resumen.findings.filter((f) => f.cause === "bloqueado_por_urgencia");
  assert.equal(bloqueadas.length, 4);
  for (const b of bloqueadas) assert.equal(b.normalized, null);
});

test("WO-42 · escalateNow devuelve Decision sin bucle y sin determinista", async () => {
  const { orq, entregados } = orquestador();
  const decision = await orq.escalateNow({
    session_id: "s-urgencia",
    red_flag_id: "RF-sangrado",
    utterance: "estoy sangrando mucho por la herida",
    units_so_far: [],
  });

  assert.equal(decision.escalate, true);
  assert.equal(decision.reason_code, "urgencia");
  assert.deepEqual(decision.traces.rules_fired, [], "en urgencia no se invoca la determinista");
  assert.match(decision.reason, /sangrando mucho/, "el enunciado literal viaja sin interpretar");
  assert.deepEqual(validateDecision(decision).issues, []);
  assert.equal(entregados.at(-1)!.resumen.decision.branch, "urgencia");
  assert.equal(entregados.at(-1)!.resumen.decision.votes, undefined);
});

test("WO-42 · la caida del VP degrada a humano, no rompe la sesion", async () => {
  const { orq, entregados } = orquestador({ motor: new DecisionEngineGuion({ fallar: "voto" }) });
  const frame = await orq.requestFrame({ session_id: "s-falla", identity: IDENTIDAD });

  const veredicto = await orq.submitFrame({
    session_id: "s-falla",
    frame_id: frame.frame_id,
    round: 0,
    units: VERDE,
    session_state: ESTADO,
    transcript_digest: "",
    budget_spent: { turns: 5, ms: 100_000 },
  });

  const decision = veredicto.status === "sufficient" ? veredicto.decision : null;
  assert.equal(decision?.escalate, true);
  assert.equal(decision?.reason_code, "falla_tecnica");
  assert.deepEqual(validateCallSummary(entregados.at(-1)!.resumen).issues, []);
});

test("WO-42 · identidad no verificada sigue adelante con marco generico y sin referencia", async () => {
  const { orq } = orquestador();
  const frame = await orq.requestFrame({
    session_id: "s-anon",
    identity: { status: "unverified", patient_ref: null, speaker_role: "desconocido" },
  });

  assert.equal(frame.patient_ref, null);
  assert.deepEqual(validateContextFrame(frame).issues, []);
  assert.equal(frame.units.length, 6);
});

test("E13 · la consulta al RAG se arma como se midio: sin intent y sin raw", async () => {
  // Mide lo que vas a correr, y corre lo que mediste. La primera version concatenaba
  // `unit_id + intent + raw` y producia huecos de evidencia en unidades que SI tienen
  // material: doce terminos repartidos entre siete temas, y ningun fragmento casa una
  // fraccion suficiente. El piso no estaba mal calibrado — media una consulta que no
  // deberia existir.
  const consultas: string[] = [];
  const almacen = new AlmacenDeFuentes();
  for (const doc of CORPUS_SEMILLA) almacen.ingest(doc, { actor: "prueba" });
  const indice = new IndiceLexico(almacen);

  const orq = new Orquestador({
    rag: {
      retrieve: (q) => {
        consultas.push(q.text);
        return indice.retrieve(q);
      },
    },
    expandir: (base, terminos) => indice.expandirConsulta(base, terminos),
    determinista,
    motor: new DecisionEngineGuion(),
    proyectar: () => BASE,
    embedding_model: indice.descriptor(),
  });

  const frame = await orq.requestFrame({ session_id: "s-consulta", identity: IDENTIDAD });
  await orq.submitFrame({
    session_id: "s-consulta",
    frame_id: frame.frame_id,
    round: 0,
    units: ROJO,
    session_state: ESTADO,
    transcript_digest: "",
    budget_spent: { turns: 6, ms: 100_000 },
  });

  assert.equal(consultas.length, 6, "una consulta por unidad");
  const todas = consultas.join(" | ");

  // Nada de `intent`: es prosa dirigida a la conversacional.
  assert.ok(!todas.includes("Saber si ha tenido fiebre"));
  assert.ok(!todas.toLowerCase().includes("saber como se ve"));
  // Nada de `raw`: es habla de paciente contra literatura clinica.
  assert.ok(!todas.includes("dijo algo sobre"));

  // Y si el id canonico y el valor normalizado.
  const deHerida = consultas.find((c) => c.startsWith("aspecto_herida"));
  assert.ok(deHerida?.includes("secrecion_purulenta"));
});

test("WO-42 · los doc_ids del VP se sanean contra lo efectivamente recuperado (H5)", async () => {
  class Inventor extends DecisionEngineGuion {
    override async emitVote(req: Parameters<DecisionEngineGuion["emitVote"]>[0]) {
      const r = await super.emitVote(req);
      return { ...r, doc_ids: [...r.doc_ids, "doc:inventado-que-no-existe"] };
    }
  }
  const { orq } = orquestador({ motor: new Inventor() });
  const frame = await orq.requestFrame({ session_id: "s-trazas", identity: IDENTIDAD });
  const veredicto = await orq.submitFrame({
    session_id: "s-trazas",
    frame_id: frame.frame_id,
    round: 0,
    units: ROJO,
    session_state: ESTADO,
    transcript_digest: "",
    budget_spent: { turns: 6, ms: 100_000 },
  });

  const decision = veredicto.status === "sufficient" ? veredicto.decision : null;
  assert.ok(!decision!.traces.doc_ids.includes("doc:inventado-que-no-existe"));
  // Una traza que no resuelve a un documento real es peor que una traza vacia: se
  // verifica contra la fuente, y delante del jurado.
});
