/**
 * WO-40 — la CONSOLA, que es la compuerta 5.
 *
 * Lo que la compuerta afirma es que el sistema APRENDE Y OLVIDA EN CALIENTE, y eso
 * es lo que se prueba: ingesta -> se recupera -> retiro -> deja de recuperarse, todo
 * en el mismo proceso y sin reiniciar nada.
 *
 * Las tres pruebas que la acompañan no son adorno: el rechazo del documento sin capa
 * de texto es lo que pasa si el jurado sube un escaneo, y la traza que sobrevive al
 * retiro es lo que hace auditable una decision de ayer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { SourceDocument } from "@techsphere/contracts";
import { AYUDA, ConsolaDeConocimiento, CORPUS_SEMILLA, descriptorDe, ESTRATEGIA_VIGENTE } from "../src/index.ts";

const CONSULTA = "fiebre dolor herida despues de la cirugia";

const NUEVO: SourceDocument = {
  doc_id: "protocolo-fiebre-postoperatoria",
  title: "Protocolo de fiebre post-operatoria",
  kind: "protocolo",
  lang: "es",
  origin: "DATOS SINTETICOS — sin validez clinica. Documento de demostracion.",
  effective_date: "2026-02-01",
  body:
    "DATOS SINTETICOS — sin validez clinica. " +
    "La fiebre post-operatoria que aparece tardiamente, cuando el paciente ya habia mejorado, se " +
    "valora distinto de la fiebre de las primeras horas. Interesa si coincide con cambios en la " +
    "herida quirurgica, con dolor que dejo de ceder al analgesico habitual, o con perdida del " +
    "apetito y del sueno.",
};

function consolaSembrada(): ConsolaDeConocimiento {
  const consola = new ConsolaDeConocimiento({ actor: "operadora" });
  for (const doc of CORPUS_SEMILLA) consola.ingest(doc);
  return consola;
}

const recuperados = (consola: ConsolaDeConocimiento, k = 5): string[] =>
  consola.indice.retrieve({ text: CONSULTA, k }).map((r) => r.doc_id);

// ---------------------------------------------------------------------------
// El ciclo de la compuerta, en un solo proceso
// ---------------------------------------------------------------------------

test("COMPUERTA 5 · ingest -> retrieve -> retire -> retrieve, sin reiniciar nada", () => {
  const consola = consolaSembrada();

  // 1. Aun no existe.
  assert.ok(!recuperados(consola).includes(NUEVO.doc_id));

  // 2. Se ingiere y el agente lo usa.
  const recibo = consola.ingest(NUEVO);
  assert.equal(recibo.indexed, true);
  assert.ok(recibo.chunks > 0, "un documento que entra sin fragmentos no es recuperable");
  assert.ok(recuperados(consola).includes(NUEVO.doc_id), "APRENDIO");

  // 3. Se retira y deja de usarlo.
  consola.retire(NUEVO.doc_id);
  assert.ok(!recuperados(consola).includes(NUEVO.doc_id), "OLVIDO");

  // 4. Y el resto del corpus nunca se movio.
  assert.ok(recuperados(consola).length > 0);
  assert.equal(consola.list().find((d) => d.doc_id === NUEVO.doc_id)?.status, "retired");
});

test("la traza historica resuelve el doc_id de un documento retirado", () => {
  const consola = consolaSembrada();
  consola.ingest(NUEVO);
  consola.retire(NUEVO.doc_id);

  assert.equal(consola.almacen.resolver(NUEVO.doc_id)?.title, NUEVO.title);
  assert.equal(consola.almacen.vigente(NUEVO.doc_id), null);
  // Sin esto, retirar un documento borraria la evidencia de todas las decisiones que
  // se apoyaron en el: un doc_id que no resuelve es peor que una traza vacia, porque
  // parece auditable y no lo es.
});

test("un documento sin capa de texto se rechaza nombrando su sidecar, y no entra nada", () => {
  const consola = consolaSembrada();
  const antes = consola.status().chunks;

  assert.throws(
    () =>
      consola.ingest(
        { ...NUEVO, doc_id: "poster-escaneado", body: "\n  \n\n" },
        { paginas: 1, ruta_original: "dataset/textos/Appendicitis/POSTER.pdf" },
      ),
    (e: unknown) => {
      const mensaje = (e as Error).message;
      assert.match(mensaje, /SIN CAPA DE TEXTO/);
      assert.match(mensaje, /docs\/corpus-texto\/Appendicitis\/POSTER\.txt/);
      return true;
    },
  );

  assert.equal(consola.status().chunks, antes, "nada entro al indice");
  assert.equal(consola.almacen.resolver("poster-escaneado"), null);
});

// ---------------------------------------------------------------------------
// La consola como superficie del puerto
// ---------------------------------------------------------------------------

test("status muestra documentos, fragmentos, estrategia vigente y ultimo cambio", () => {
  const consola = consolaSembrada();
  const antes = consola.status();

  consola.ingest(NUEVO);
  const despues = consola.status();

  assert.equal(despues.docs, antes.docs + 1);
  assert.ok(despues.chunks > antes.chunks);
  assert.equal(despues.embedding_model, descriptorDe(ESTRATEGIA_VIGENTE));
  assert.match(despues.last_change, /^\d{4}-\d{2}-\d{2}T/);
});

test("reindex queda en el registro como operacion de primera clase", () => {
  const consola = consolaSembrada();
  const informe = consola.reindex(descriptorDe(ESTRATEGIA_VIGENTE));

  assert.equal(informe.docs, CORPUS_SEMILLA.length);
  assert.ok(informe.chunks > 0);
  assert.ok(consola.registro().some((e) => e.operacion === "reindex"));
});

test("el registro muestra las cuatro operaciones con quien, que y cuando", () => {
  const consola = consolaSembrada();
  consola.ingest(NUEVO);
  consola.retire(NUEVO.doc_id);
  consola.reindex(descriptorDe(ESTRATEGIA_VIGENTE));

  const registro = consola.registro();
  assert.deepEqual(
    [...new Set(registro.map((e) => e.operacion))].sort(),
    ["ingest", "reindex", "retire"],
  );
  for (const entrada of registro) {
    assert.equal(entrada.actor, "operadora");
    assert.notEqual(entrada.detalle, "");
    assert.match(entrada.ts, /^\d{4}-\d{2}-\d{2}T/);
  }
  // Una decision solo es auditable si se sabe que conocimiento estaba vigente
  // cuando se tomo.
});

test("la ayuda declara la ASIMETRIA: el RAG en caliente, la taxonomia por version", () => {
  assert.match(AYUDA, /en caliente/i);
  assert.match(AYUDA, /TAXONOMIA DETERMINISTA/);
  assert.match(AYUDA, /ADR-010/);
  assert.match(AYUDA, /sidecar/);
  // Dos garantias distintas, dichas donde el operador podria esperar lo contrario.
});
