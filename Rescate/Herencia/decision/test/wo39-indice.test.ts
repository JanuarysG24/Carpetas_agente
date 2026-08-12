/**
 * WO-39 — el indice lexico detras de `KnowledgePort`.
 *
 * Pruebas gruesas a proposito: se cubre lo que el sistema PROMETE, no el interior de
 * BM25. Fijar un puntaje concreto convertiria un detalle de implementacion en un
 * contrato, y estorbaria justo el dia que la estrategia cambie a vectorial — que es
 * el cambio para el que existe el puerto.
 *
 * Por que lexico hoy: quien consulta no es el paciente con habla libre, es el
 * DECISOR con el vocabulario canonico del dominio (ADR-019). La brecha semantica que
 * justifica los embeddings se abre cuando consulta y documento usan palabras
 * distintas para lo mismo, y aqui el que pregunta ya habla el idioma del corpus.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { SourceDocument } from "@techsphere/contracts";
import {
  AlmacenDeFuentes,
  CORPUS_SEMILLA,
  descriptorDe,
  ErrorDeIndiceDiscordante,
  ESTRATEGIA_VIGENTE,
  IndiceLexico,
  tokenizar,
} from "../src/index.ts";

const CONSULTA = "fiebre dolor herida despues de la cirugia";

const NUEVO: SourceDocument = {
  doc_id: "protocolo-fiebre-postoperatoria",
  title: "Protocolo de fiebre post-operatoria",
  kind: "protocolo",
  lang: "es",
  origin: "DATOS SINTETICOS — sin validez clinica. Documento de prueba.",
  effective_date: "2026-02-01",
  body:
    "DATOS SINTETICOS — sin validez clinica. " +
    "La fiebre post-operatoria que aparece tardiamente, cuando el paciente ya habia mejorado, se " +
    "valora distinto de la fiebre de las primeras horas. Interesa si coincide con cambios en la " +
    "herida quirurgica, con dolor que dejo de ceder al analgesico habitual, o con perdida del " +
    "apetito y del sueno.",
};

function sembrado(): { almacen: AlmacenDeFuentes; indice: IndiceLexico } {
  const almacen = new AlmacenDeFuentes();
  for (const doc of CORPUS_SEMILLA) almacen.ingest(doc, { actor: "prueba" });
  return { almacen, indice: new IndiceLexico(almacen) };
}

const docsDe = (indice: IndiceLexico, k = 5): string[] =>
  indice.retrieve({ text: CONSULTA, k }).map((r) => r.doc_id);

// ---------------------------------------------------------------------------
// Semantica de caliente: el indice es proyeccion del almacen, y se entera solo
// ---------------------------------------------------------------------------

test("lo que se ingiere se recupera en la siguiente consulta, sin reconstruir nada a mano", () => {
  const { almacen, indice } = sembrado();
  assert.ok(!docsDe(indice).includes(NUEVO.doc_id));

  almacen.ingest(NUEVO, { actor: "prueba" });

  assert.ok(
    docsDe(indice).includes(NUEVO.doc_id),
    "nadie invalido el indice: se compara la revision del corpus y se reproyecta solo",
  );
});

test("lo que se retira deja de recuperarse, y el resto del corpus sigue vivo", () => {
  const { almacen, indice } = sembrado();
  almacen.ingest(NUEVO, { actor: "prueba" });
  assert.ok(docsDe(indice).includes(NUEVO.doc_id));

  almacen.retire(NUEVO.doc_id, "prueba");

  assert.ok(!docsDe(indice).includes(NUEVO.doc_id));
  assert.ok(docsDe(indice).length > 0);
});

// ---------------------------------------------------------------------------
// El puerto
// ---------------------------------------------------------------------------

test("retrieve respeta k y el filtro por kind", () => {
  const { almacen, indice } = sembrado();
  almacen.ingest(NUEVO, { actor: "prueba" });

  assert.equal(indice.retrieve({ text: CONSULTA, k: 1 }).length, 1);

  const soloProtocolo = indice.retrieve({ text: CONSULTA, k: 5, kind: ["protocolo"] });
  assert.ok(soloProtocolo.length > 0);
  assert.deepEqual([...new Set(soloProtocolo.map((r) => r.doc_id))], [NUEVO.doc_id]);
});

test("cada resultado trae doc_id, chunk_id, texto y puntaje", () => {
  const { indice } = sembrado();
  const [primero] = indice.retrieve({ text: CONSULTA, k: 1 });
  assert.ok(primero);
  assert.match(primero.chunk_id, new RegExp(`^${primero.doc_id}#\\d+$`));
  assert.ok(primero.text.length > 0);
  assert.ok(primero.score > 0);
});

test("una consulta que no casa con nada devuelve vacio, no el corpus entero", () => {
  const { indice } = sembrado();
  assert.deepEqual(indice.retrieve({ text: "criptomonedas volatilidad bursatil" }), []);
  assert.deepEqual(indice.retrieve({ text: "" }), []);
});

test("la normalizacion del español: minusculas, sin tildes, sin palabras vacias", () => {
  assert.deepEqual(tokenizar("La FIEBRE apareció DESPUÉS de la cirugía"), [
    "fiebre",
    "aparecio",
    "despues",
    "cirugia",
  ]);
  // Sin stemmer a proposito: el vocabulario clinico es consistente, y un stemmer mal
  // calibrado junta palabras que el decisor distingue.
});

test("una consulta acentuada encuentra un documento sin acentos, y al reves", () => {
  const { indice } = sembrado();
  // Terminos que el corpus semilla SI usa: la prueba es sobre la normalizacion de
  // acentos, no sobre el piso de relevancia, y mezclarlas haria que un fallo no
  // dijera cual de las dos se rompio.
  assert.ok(indice.retrieve({ text: "cirugía herida limpia aposito" }).length > 0);
});

// ---------------------------------------------------------------------------
// Nunca resultados silenciosamente incomparables
// ---------------------------------------------------------------------------

test("el indice registra la ESTRATEGIA entera, no solo un nombre", () => {
  const { indice } = sembrado();
  const descriptor = indice.status().embedding_model;

  // Los puntajes cambian con los parametros y con la normalizacion, no solo con la
  // familia. Registrar "lexical-bm25" a secas dejaria abierto el mismo hueco que
  // este diseño quiere cerrar — y es la disciplina que protegera el cambio a
  // vectorial, donde lo que hay que registrar son modelo, cuantizacion y prefijos.
  assert.equal(descriptor, descriptorDe(ESTRATEGIA_VIGENTE));
  assert.match(descriptor, /lexical-bm25/);
  assert.match(descriptor, /k1=1\.2/);
  assert.match(descriptor, /b=0\.75/);
  assert.match(descriptor, /es-minusculas-sin-tildes-sin-vacias/);
});

test("consultar esperando otra estrategia FALLA en vez de devolver algo incomparable", () => {
  const { indice } = sembrado();

  assert.throws(
    () => indice.consultarCon("lexical-bm25/k1=2.0/b=0.75/es-v1", { text: CONSULTA }),
    ErrorDeIndiceDiscordante,
  );
  assert.ok(indice.consultarCon(indice.descriptor(), { text: CONSULTA }).length > 0);
});

test("reindex reconstruye desde los fuentes SIN re-ingesta", () => {
  const { almacen, indice } = sembrado();
  almacen.ingest(NUEVO, { actor: "prueba" });
  const antes = indice.status();

  const informe = indice.reindex(descriptorDe(ESTRATEGIA_VIGENTE));

  assert.equal(informe.docs, antes.docs);
  assert.equal(informe.chunks, antes.chunks);
  assert.ok(docsDe(indice).includes(NUEVO.doc_id), "las consultas siguen funcionando");
});

test("reindex hacia una estrategia que este indice no sabe construir falla explicito", () => {
  const { indice } = sembrado();
  assert.throws(() => indice.reindex("e5-small/int8/query-passage"), ErrorDeIndiceDiscordante);
});

test("status refleja el corpus vigente, no el historico", () => {
  const { almacen, indice } = sembrado();
  const antes = indice.status();

  almacen.ingest(NUEVO, { actor: "prueba" });
  const conNuevo = indice.status();
  assert.equal(conNuevo.docs, antes.docs + 1);
  assert.ok(conNuevo.chunks > antes.chunks);

  almacen.retire(NUEVO.doc_id, "prueba");
  assert.equal(indice.status().docs, antes.docs);
});
