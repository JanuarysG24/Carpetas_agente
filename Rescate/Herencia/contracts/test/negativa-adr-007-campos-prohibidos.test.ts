/**
 * PRUEBA NEGATIVA 1 — ADR-006 y ADR-007.
 *
 * El modulo determinista NO pondera: entrega evidencia ponderable. Su salida no
 * admite `alert`, `score`, `risk`, `severity`, `recommendation` ni `diagnosis`,
 * y esa ausencia es NORMATIVA. Quien convierte la evidencia en voto es el decisor,
 * con una tabla de lectura declarada y auditable regla a regla — y ese es el
 * segundo mecanismo independiente que hace valer la disyuncion de ADR-013.
 *
 * Esta prueba falla si alguien agrega cualquiera de los seis campos:
 *   - A NIVEL DE TIPO: las aserciones rompen `npm run typecheck`.
 *   - EN EJECUCION: el validador rechaza el objeto, en cualquier profundidad.
 *
 * Los dos niveles hacen falta. El de tipo atrapa al que edita `deterministic.ts`;
 * el de ejecucion atrapa al que construye el reporte desde una fuente sin tipar
 * —un JSON de otro proceso, una respuesta HTTP— que es exactamente el caso que
 * el aislamiento de capas hace probable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPOS_PROHIBIDOS_ADR_007,
  validateDeterministicReport,
  type ClassHit,
  type CompositionHit,
  type DeterministicReport,
  type DomainManifest,
  type StructureHit,
} from "../src/index.ts";
import type { Expect, HasNoKey } from "./_type-assertions.ts";
import { REPORTE_VALIDO, copiar } from "./fixtures/validos.ts";

// ---------------------------------------------------------------------------
// Nivel 1 — el tipo no admite los campos
// ---------------------------------------------------------------------------

type CamposProhibidos =
  | "alert"
  | "score"
  | "risk"
  | "severity"
  | "recommendation"
  | "diagnosis";

export type _ReporteSinCamposProhibidos = Expect<
  HasNoKey<DeterministicReport, CamposProhibidos>
>;

/**
 * Invariante 2 de la spec §6.4: la prohibicion se EXTIENDE a los tipos de hallazgo.
 * Un `ClassHit` con `severity` reintroduciria por la puerta de atras justo lo que
 * ADR-007 cierra, y ademas de forma invisible para quien solo mire el reporte.
 */
export type _ClassHitSinCamposProhibidos = Expect<HasNoKey<ClassHit, CamposProhibidos>>;
export type _CompositionHitSinCamposProhibidos = Expect<
  HasNoKey<CompositionHit, CamposProhibidos>
>;
export type _StructureHitSinCamposProhibidos = Expect<
  HasNoKey<StructureHit, CamposProhibidos>
>;
export type _DomainManifestSinCamposProhibidos = Expect<
  HasNoKey<DomainManifest, CamposProhibidos>
>;

/** Y tampoco por los sub-objetos del reporte. */
export type _EjesSinCamposProhibidos = Expect<
  HasNoKey<DeterministicReport["funcionalidad"], CamposProhibidos> extends true
    ? HasNoKey<DeterministicReport["interaccion"], CamposProhibidos> extends true
      ? HasNoKey<DeterministicReport["integridad"], CamposProhibidos>
      : false
    : false
>;

// ---------------------------------------------------------------------------
// Nivel 2 — el validador rechaza los campos, en cualquier profundidad
// ---------------------------------------------------------------------------

test("la lista de campos prohibidos es exactamente la de ADR-007", () => {
  assert.deepEqual(
    [...CAMPOS_PROHIBIDOS_ADR_007],
    ["alert", "score", "risk", "severity", "recommendation", "diagnosis"],
    "la lista es la fuente unica que usan el validador y esta prueba; cambiarla exige un ADR que revierta ADR-006 y ADR-007",
  );
});

test("rechaza cada campo prohibido en la raiz del reporte, con la razon del ADR", () => {
  for (const campo of CAMPOS_PROHIBIDOS_ADR_007) {
    const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
    reporte[campo] = campo === "alert" ? true : 0.9;

    const res = validateDeterministicReport(reporte);
    assert.equal(res.valid, false, `el reporte con "${campo}" fue aceptado`);

    const issue = res.issues.find((i) => i.path === campo && i.code === "campo_prohibido");
    assert.ok(issue, `no hay rechazo tipificado para "${campo}"; rutas: [${res.issues.map((i) => i.path).join(", ")}]`);
    assert.ok(
      issue.hint.includes("ADR-007"),
      `el rechazo de "${campo}" debe citar el ADR que lo prohibe, para que quien lo lea sepa que no es una preferencia`,
    );
  }
});

test("rechaza los campos prohibidos DENTRO de un ClassHit: la puerta de atras tambien cierra", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  const clases = (reporte["funcionalidad"] as Record<string, unknown>)["clases"] as Record<
    string,
    unknown
  >[];
  clases[0]!["severity"] = 3;

  const res = validateDeterministicReport(reporte);
  const issue = res.issues.find((i) => i.path === "funcionalidad.clases[0].severity");
  assert.ok(issue, "un severity dentro de un hallazgo debe rechazarse igual que en la raiz");
  assert.equal(issue.code, "campo_prohibido");
  assert.ok(
    issue.hint.includes("ADR-006") && issue.hint.includes("ADR-007"),
    "la pista debe citar los dos ADR: el objeto de evaluacion y la prohibicion de ponderar",
  );
});

test("rechaza un score anidado en la traza, que es donde menos se mira", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  const traza = reporte["trace"] as Record<string, unknown>[];
  traza[0]!["score"] = 0.77;

  const res = validateDeterministicReport(reporte);
  assert.ok(
    res.issues.some((i) => i.path === "trace[0].score" && i.code === "campo_prohibido"),
    "la comprobacion es recursiva justamente para esto",
  );
});

test("el rechazo de alert explica que hacer en su lugar, no solo que esta prohibido", () => {
  const reporte = copiar(REPORTE_VALIDO) as unknown as Record<string, unknown>;
  reporte["alert"] = true;

  const res = validateDeterministicReport(reporte);
  const issue = res.issues.find((i) => i.path === "alert");
  assert.ok(issue);
  assert.ok(
    issue.hint.includes("rule_id"),
    "la salida correcta existe: emitir el hallazgo con su rule_id y dejar que el VD lo lea. La pista debe decirlo.",
  );
  assert.ok(
    issue.hint.includes("decisor"),
    "la pista debe nombrar a quien SI tiene la autoridad, o el rechazo parece arbitrario",
  );
});

test("el reporte valido sigue pasando: la prohibicion no rompe el camino feliz", () => {
  assert.deepEqual(validateDeterministicReport(REPORTE_VALIDO).issues, []);
});
