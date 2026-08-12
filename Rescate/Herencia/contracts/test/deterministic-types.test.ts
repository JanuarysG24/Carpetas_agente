/**
 * Costura decision <-> determinista: aserciones sobre la forma de los hallazgos.
 *
 * Cubre las invariantes 1 y 3 de la spec determinista §6.4. La invariante 2
 * (ningun peso, score ni orden de gravedad) es una de las dos pruebas negativas
 * y vive en su propio archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  ClassHit,
  CompositionHit,
  DeterministicHit,
  DeterministicReport,
  DeterministicRequest,
  DomainManifest,
  StructureHit,
  UnitResult,
} from "../src/index.ts";
import type { Equal, Expect, HasRequiredKey } from "./_type-assertions.ts";

// --- Invariante 1 · `rule_id` obligatorio en los tres ----------------------

export type _ClassHitLlevaRuleId = Expect<HasRequiredKey<ClassHit, "rule_id">>;
export type _CompositionHitLlevaRuleId = Expect<HasRequiredKey<CompositionHit, "rule_id">>;
export type _StructureHitLlevaRuleId = Expect<HasRequiredKey<StructureHit, "rule_id">>;

/** Y la union entera lo lleva: un hallazgo nuevo no puede entrar sin `rule_id`. */
export type _TodoHallazgoLlevaRuleId = Expect<
  Equal<DeterministicHit extends { rule_id: string } ? true : false, true>
>;

// --- Invariante 3 · `origen_unit_ids`, con ese nombre exacto en los tres ----
//
// Correccion X-6: la version anterior llamaba `unit_ids` al campo en `ClassHit`.
// Con un nombre unico esta invariante se prueba recorriendo los tres tipos; con
// dos nombres haria falta un mapa, y el proximo tipo de hallazgo invitaria a un tercero.

export type _ClassHitLlevaOrigen = Expect<HasRequiredKey<ClassHit, "origen_unit_ids">>;
export type _CompositionHitLlevaOrigen = Expect<
  HasRequiredKey<CompositionHit, "origen_unit_ids">
>;
export type _StructureHitLlevaOrigen = Expect<HasRequiredKey<StructureHit, "origen_unit_ids">>;
export type _TodoHallazgoLlevaOrigen = Expect<
  Equal<DeterministicHit extends { origen_unit_ids: string[] } ? true : false, true>
>;

/** El nombre viejo no sobrevive en ninguno de los tres. */
export type _NingunHallazgoUsaUnitIds = Expect<
  Equal<Extract<keyof DeterministicHit, "unit_ids">, never>
>;

// --- La peticion no re-tipa las unidades -----------------------------------

export type _RequestReutilizaUnitResult = Expect<
  Equal<DeterministicRequest["units"], UnitResult[]>
>;

// --- ADR-009 · la cobertura es obligatoria en el reporte --------------------

export type _ReporteLlevaCobertura = Expect<HasRequiredKey<DeterministicReport, "coverage">>;
export type _ReporteLlevaTraza = Expect<HasRequiredKey<DeterministicReport, "trace">>;
export type _ReporteLlevaCalidad = Expect<HasRequiredKey<DeterministicReport, "quality">>;

// --- ADR-010 · el manifiesto declara su validez clinica ---------------------

export type _ManifiestoDeclaraValidez = Expect<
  HasRequiredKey<DomainManifest, "validez_clinica">
>;
export type _ManifiestoLlevaChecksum = Expect<HasRequiredKey<DomainManifest, "checksum">>;

// --- Comprobacion en ejecucion ---------------------------------------------

test("los tres tipos de hallazgo se recorren con un solo nombre de campo de origen", () => {
  // La invariante 3, ejercida como la spec dice que debe poder ejercerse:
  // un solo recorrido sobre los tres, sin mapa de nombres.
  const hallazgos: DeterministicHit[] = [
    {
      rule_id: "R-clase-001",
      clase: "compromiso_local",
      origen_unit_ids: ["aspecto_herida"],
      origen_valores: ["exudado_purulento"],
      fallback: false,
    },
    {
      rule_id: "R-comp-001",
      clases_requeridas: ["compromiso_local", "respuesta_sistemica"],
      clase_producida: "infeccion_sitio_operatorio",
      origen_unit_ids: ["aspecto_herida", "fiebre"],
    },
    {
      rule_id: "R-estr-001",
      estructura: "sitio_quirurgico",
      clases_contribuyentes: ["infeccion_sitio_operatorio"],
      origen_unit_ids: ["aspecto_herida", "fiebre"],
    },
  ];

  for (const hallazgo of hallazgos) {
    assert.ok(hallazgo.rule_id.length > 0, "invariante 1: todo hallazgo lleva rule_id");
    assert.ok(
      Array.isArray(hallazgo.origen_unit_ids) && hallazgo.origen_unit_ids.length > 0,
      "invariante 3: todo hallazgo es recorrible hasta las unidades que lo originaron",
    );
  }
});
