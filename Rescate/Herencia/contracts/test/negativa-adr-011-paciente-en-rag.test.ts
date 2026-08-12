/**
 * PRUEBA NEGATIVA 2 — ADR-011: el RAG no contiene pacientes.
 *
 * Un documento con datos de paciente tiene que ser rechazado POR ESQUEMA, no por
 * convencion. La diferencia no es de estilo: una convencion se rompe en la tercera
 * sesion de construccion, y el resultado seria un indice vectorial donde cada
 * operacion de consola —subir, retirar, reindexar, todas en caliente frente al
 * jurado— pasa a ser una operacion sobre datos personales.
 *
 * Hay ademas un motivo de correctitud, no solo de privacidad: la recuperacion por
 * similitud es el mecanismo equivocado para datos de paciente. Un caso "parecido"
 * recuperado por el RAG NO es el caso del paciente al telefono, y mezclarlos
 * habilita exactamente ese error, en un sistema donde hidratar el marco equivocado
 * produce una decision clinica sobre el paciente equivocado.
 *
 * Dos niveles, igual que la otra negativa: tipo y ejecucion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011,
  DOCUMENT_KINDS,
  KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011,
  validateSourceDocument,
  type DocumentKind,
  type SourceDocument,
} from "../src/index.ts";
import type { Expect, HasNoKey } from "./_type-assertions.ts";
import { DOCUMENTO_VALIDO, copiar } from "./fixtures/validos.ts";

// ---------------------------------------------------------------------------
// Nivel 1 — el tipo no tiene identidad de paciente
// ---------------------------------------------------------------------------

type CamposDeIdentidad =
  | "paciente_id"
  | "patient_id"
  | "patient_ref"
  | "nombre_completo"
  | "nombre"
  | "documento_cc"
  | "documento"
  | "cedula"
  | "direccion"
  | "ciudad"
  | "departamento"
  | "eps";

export type _DocumentoSinIdentidadDePaciente = Expect<
  HasNoKey<SourceDocument, CamposDeIdentidad>
>;

/** Y tampoco datos del caso quirurgico, que son estado y no conocimiento. */
export type _DocumentoSinDatosDelCaso = Expect<
  HasNoKey<SourceDocument, "fecha_cirugia" | "fecha_nacimiento" | "edad" | "comorbilidades">
>;

/**
 * `kind` no admite tipos de paciente. La union es cerrada, asi que la prueba de
 * tipo es directa: ningun literal de paciente es asignable a `DocumentKind`.
 */
export type _KindNoAdmitePaciente = Expect<
  "paciente" extends DocumentKind
    ? false
    : "historia_clinica" extends DocumentKind
      ? false
      : "caso" extends DocumentKind
        ? false
        : "expediente" extends DocumentKind
          ? false
          : true
>;

// ---------------------------------------------------------------------------
// Nivel 2 — el validador rechaza el documento
// ---------------------------------------------------------------------------

test("los cinco kind del corpus son de conocimiento, ninguno de paciente", () => {
  assert.deepEqual(
    [...DOCUMENT_KINDS],
    ["procedimiento", "cuidados", "complicaciones", "farmacologia", "protocolo"],
    "agregar un kind de paciente exige un ADR que revierta ADR-011 explicitamente",
  );
});

test("rechaza cada campo de identidad de paciente que se le cuele al documento", () => {
  for (const campo of CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011) {
    const doc = copiar(DOCUMENTO_VALIDO) as unknown as Record<string, unknown>;
    doc[campo] = "valor cualquiera";

    const res = validateSourceDocument(doc);
    assert.equal(res.valid, false, `el documento con "${campo}" fue aceptado`);

    const issue = res.issues.find((i) => i.path === campo && i.code === "campo_prohibido");
    assert.ok(
      issue,
      `no hay rechazo tipificado para "${campo}"; rutas: [${res.issues.map((i) => i.path).join(", ")}]`,
    );
    assert.ok(
      issue.hint.includes("PatientStorePort"),
      `la pista de "${campo}" debe decir por donde SI entra el dato del paciente, o el rechazo deja al operador sin salida`,
    );
  }
});

test("rechaza un kind de paciente y explica que el corpus no es para eso", () => {
  for (const kind of KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011) {
    const doc = copiar(DOCUMENTO_VALIDO) as unknown as Record<string, unknown>;
    doc["kind"] = kind;

    const res = validateSourceDocument(doc);
    const issue = res.issues.find((i) => i.path === "kind");
    assert.ok(issue, `el kind "${kind}" fue aceptado`);
    assert.equal(issue.code, "campo_prohibido");
    assert.ok(
      issue.message.includes("tipo de paciente"),
      `el mensaje debe decir POR QUE se rechaza "${kind}", no solo que el valor es invalido`,
    );
    assert.ok(issue.hint.includes("ADR-011"));
  }
});

test("un documento de paciente completo es rechazado por esquema, no por convencion", () => {
  // Exactamente lo que pasaria si alguien intentara indexar una fila del dataset:
  // los campos son los reales de `perfiles_pacientes_co.xlsx`.
  const documentoDePaciente = {
    doc_id: "pac_0042",
    title: "Perfil de paciente 0042",
    kind: "paciente",
    lang: "es",
    origin: "dataset del reto",
    effective_date: "2026-08-01",
    body: "Paciente post-operatorio de colecistectomia.",
    paciente_id: "p_0042",
    nombre_completo: "Nombre Apellido",
    documento_cc: "1000000000",
    eps: "EPS Ejemplo",
    ciudad: "Medellin",
  };

  const res = validateSourceDocument(documentoDePaciente);
  assert.equal(res.valid, false);

  const rutasProhibidas = res.issues
    .filter((i) => i.code === "campo_prohibido")
    .map((i) => i.path)
    .sort();

  assert.deepEqual(
    rutasProhibidas,
    ["ciudad", "documento_cc", "eps", "kind", "nombre_completo", "paciente_id"],
    "los cinco campos de identidad y el kind de paciente deben rechazarse TODOS, no solo el primero",
  );
});

test("rechaza identidad de paciente anidada, no solo en el primer nivel", () => {
  const doc = copiar(DOCUMENTO_VALIDO) as unknown as Record<string, unknown>;
  // Un metadato aparentemente inocente que arrastra al paciente dentro.
  doc["chunking"] = { strategy: "seccion", paciente_id: "p_0042" };

  const res = validateSourceDocument(doc);
  assert.ok(
    res.issues.some((i) => i.path === "chunking.paciente_id" && i.code === "campo_prohibido"),
    "la comprobacion de ADR-011 es recursiva: esconder el paciente un nivel mas adentro no lo hace pasar",
  );
});

test("el documento de conocimiento valido sigue pasando", () => {
  assert.deepEqual(validateSourceDocument(DOCUMENTO_VALIDO).issues, []);
});
