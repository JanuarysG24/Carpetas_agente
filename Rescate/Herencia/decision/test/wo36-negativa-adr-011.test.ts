/**
 * WO-36 · PRUEBA NEGATIVA 1 — ADR-011: ningun dato de paciente entra al RAG.
 *
 * La regla no es de una WO, es de todas, y se protege POR ESQUEMA: `SourceDocument`
 * no tiene campo de identidad y `kind` no admite tipos de paciente. Esta prueba
 * falla si alguna de esas dos ausencias desaparece.
 *
 * Por que importa que sea por esquema y no por convencion: la recuperacion por
 * similitud es el mecanismo EQUIVOCADO para datos de paciente —un caso "parecido"
 * recuperado por el RAG no es el caso del paciente al telefono, y mezclarlos
 * habilita exactamente ese error—. Ademas el conocimiento vivo implica subir y
 * quitar documentos en caliente: si el indice contuviera pacientes, cada operacion
 * de consola seria una operacion sobre datos personales.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011,
  DOCUMENT_KINDS,
  KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011,
} from "@techsphere/contracts";
import { exigirDocumentoIngestable, validarDocumentoIngestable } from "../src/index.ts";
import { documento } from "./fixtures/ayudas.ts";

test("el documento semilla del corpus pasa el estandar completo", () => {
  assert.deepEqual(validarDocumentoIngestable(documento()).issues, []);
});

test("NINGUN campo de identidad de paciente puede entrar al corpus", () => {
  for (const campo of CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011) {
    const contaminado = { ...documento(), [campo]: "lo que sea" };
    const r = validarDocumentoIngestable(contaminado);

    assert.equal(r.valid, false, `${campo} entro al corpus: ADR-011 esta roto`);
    assert.ok(
      r.issues.some((i) => i.code === "campo_prohibido" && i.path.includes(campo)),
      `${campo} tiene que rechazarse como campo PROHIBIDO, no como campo desconocido: la diferencia ` +
        `es la que le dice al operador que el problema no es un typo`,
    );
  }
});

test("un campo de paciente ANIDADO tambien se rechaza: la prohibicion es en profundidad", () => {
  const r = validarDocumentoIngestable({
    ...documento(),
    chunking: { strategy: "parrafo", paciente_id: "P-0042" },
  });
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === "campo_prohibido"));
});

test("NINGUN kind de paciente es admisible, y el rechazo dice por que", () => {
  for (const kind of KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011) {
    const r = validarDocumentoIngestable({ ...documento(), kind });
    assert.equal(r.valid, false, `kind "${kind}" entro al corpus`);

    const problema = r.issues.find((i) => i.path === "kind");
    assert.ok(problema, `kind "${kind}" no produjo problema en la ruta "kind"`);
    assert.match(
      problema.message,
      /tipo de paciente/,
      `el mensaje debe decir POR QUE se rechaza, no limitarse a "valor invalido": es la diferencia ` +
        `entre que el operador entienda la separacion conocimiento/estado o crea que es un enum corto`,
    );
  }
});

test("los cinco kind del corpus siguen siendo cinco, y ninguno es de paciente", () => {
  assert.deepEqual(
    [...DOCUMENT_KINDS],
    ["procedimiento", "cuidados", "complicaciones", "farmacologia", "protocolo"],
    "agregar un kind de paciente aqui exige un ADR que revierta ADR-011 explicitamente",
  );
  for (const kind of DOCUMENT_KINDS) {
    assert.ok(!(KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011 as readonly string[]).includes(kind));
    assert.deepEqual(validarDocumentoIngestable({ ...documento(), kind }).issues, []);
  }
});

test("la frontera de la consola LANZA: seguir con un documento contaminado es peor que caerse", () => {
  assert.throws(
    () => exigirDocumentoIngestable({ ...documento(), nombre_completo: "Ana Maria Restrepo" }),
    /campo_prohibido/,
  );
});
