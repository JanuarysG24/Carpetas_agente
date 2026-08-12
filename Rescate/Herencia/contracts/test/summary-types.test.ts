/**
 * `CallSummary`, `Vote`, `SourceDocument` y `PatientCase`: aserciones de forma.
 *
 * La prueba negativa de ADR-011 (paciente en el RAG) vive en su propio archivo;
 * aqui se fija que los tipos digan lo que ADR-016 y ADR-018 exigen que digan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  CallSummary,
  NormalizedValue,
  SourceDocument,
  SummaryDecision,
  SummaryFinding,
  UnitResult,
  VerifierKind,
  Vote,
} from "../src/index.ts";
import { DOCUMENT_KINDS, VERIFIER_KINDS } from "../src/index.ts";
import type { Equal, Expect, HasNoKey, HasRequiredKey } from "./_type-assertions.ts";

// --- ADR-018 · el voto transporta accion Y lectura -------------------------

export type _VotoLlevaEscalate = Expect<HasRequiredKey<Vote, "escalate">>;
export type _VotoLlevaCriticality = Expect<HasRequiredKey<Vote, "criticality">>;
export type _VotoLlevaRazon = Expect<HasRequiredKey<Vote, "reason">>;
/** Correccion X-1: el voto ya no es el par de literales "alertar" | "no_alertar". */
export type _VotoNoEsLiteral = Expect<
  Equal<Vote extends "alertar" | "no_alertar" ? true : false, false>
>;

// --- Correccion X-1 · `escalate`, no `alert`, tambien en el resumen ---------

export type _ResumenNoUsaAlert = Expect<HasNoKey<SummaryDecision, "alert">>;
export type _ResumenLlevaEscalate = Expect<HasRequiredKey<SummaryDecision, "escalate">>;
export type _ResumenLlevaCriticality = Expect<HasRequiredKey<SummaryDecision, "criticality">>;
export type _ResumenLlevaReasonCode = Expect<HasRequiredKey<SummaryDecision, "reason_code">>;

// --- Guardarrail de la spec de decision §10 · trazas obligatorias -----------

export type _ResumenLlevaTrazas = Expect<HasRequiredKey<SummaryDecision, "traces">>;
export type _ResumenLlevaFindings = Expect<HasRequiredKey<CallSummary, "findings">>;
export type _ResumenLlevaVersiones = Expect<HasRequiredKey<CallSummary, "versions">>;

// --- Correccion X-7 · findings[].normalized usa la union ancha --------------

export type _FindingUsaUnionAncha = Expect<
  Equal<SummaryFinding["normalized"], NormalizedValue>
>;
/** Y coincide exactamente con la de `UnitResult`: el ensamblador copia, no convierte. */
export type _FindingCoincideConUnitResult = Expect<
  Equal<SummaryFinding["normalized"], UnitResult["normalized"]>
>;

// --- ADR-016 · `narrative` es opcional y jamas canonico ---------------------

export type _NarrativeEsOpcional = Expect<
  Equal<HasRequiredKey<CallSummary, "narrative">, false>
>;

// --- ADR-011 · el documento fuente no tiene identidad de paciente -----------
//
// La prueba negativa completa esta en `no-patient-in-rag.test.ts`. Estas dos
// aserciones cubren los dos campos que mas veces se han colado en sistemas asi.

export type _DocumentoSinPacienteId = Expect<HasNoKey<SourceDocument, "paciente_id">>;
export type _DocumentoSinPatientRef = Expect<HasNoKey<SourceDocument, "patient_ref">>;

// --- Correccion X-3 · el enum de verificadores perdio `fecha_nacimiento` ----

export type _VerificadoresSonTres = Expect<
  Equal<VerifierKind, "fecha_procedimiento" | "documento" | "eps">
>;

// --- Comprobaciones en ejecucion -------------------------------------------

test("ningun kind de documento es un tipo de paciente (ADR-011)", () => {
  const sospechosos = ["paciente", "historia_clinica", "caso", "expediente", "perfil_paciente"];
  for (const sospechoso of sospechosos) {
    assert.ok(
      !(DOCUMENT_KINDS as readonly string[]).includes(sospechoso),
      `"${sospechoso}" no puede ser un kind del corpus: ADR-011 separa conocimiento de estado`,
    );
  }
  assert.equal(DOCUMENT_KINDS.length, 5);
});

test("el enum de verificadores no admite fecha_nacimiento (correccion X-3)", () => {
  assert.ok(
    !(VERIFIER_KINDS as readonly string[]).includes("fecha_nacimiento"),
    "el dataset solo trae edad, y la edad tiene entropia casi nula como verificador",
  );
  assert.deepEqual([...VERIFIER_KINDS], ["fecha_procedimiento", "documento", "eps"]);
});
