/**
 * WO-38 — el almacen de fuentes: la verdad de la que el indice es proyeccion.
 *
 * Dos propiedades sostienen este archivo, y ninguna es obvia:
 *
 *   `retire` archiva y no borra — la traza de una `Decision` de hace un mes tiene que
 *   resolver su `doc_id` aunque el documento ya no este vigente. Un `doc_ids` que no
 *   resuelve es PEOR que una traza vacia: parece auditable y no lo es.
 *
 *   La historia no se reescribe — una correccion es retirar e ingerir version nueva,
 *   de modo que la revision que sustento una decision siga existiendo tal como era.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { SourceDocument } from "@techsphere/contracts";
import {
  AlmacenDeFuentes,
  CHUNKING_POR_KIND,
  CORPUS_SEMILLA,
  ErrorDeAlmacen,
  validarDocumentoIngestable,
} from "../src/index.ts";
import { documento } from "./fixtures/ayudas.ts";

const T0 = new Date("2026-08-08T09:00:00Z");
const T1 = new Date("2026-08-08T09:30:00Z");
const T2 = new Date("2026-08-08T10:00:00Z");

function almacenSembrado(): AlmacenDeFuentes {
  const almacen = new AlmacenDeFuentes();
  for (const doc of CORPUS_SEMILLA) almacen.ingest(doc, { actor: "semilla", ahora: T0 });
  return almacen;
}

// ---------------------------------------------------------------------------
// El corpus semilla
// ---------------------------------------------------------------------------

test("los tres documentos semilla pasan el estandar de ingesta", () => {
  for (const doc of CORPUS_SEMILLA) {
    assert.deepEqual(validarDocumentoIngestable(doc).issues, [], `${doc.doc_id} no pasa el estandar`);
  }
});

test("la semilla declara su invalidez donde se lee sin contexto", () => {
  for (const doc of CORPUS_SEMILLA) {
    assert.match(doc.origin, /DATOS SINTETICOS/);
    assert.match(doc.body, /DATOS SINTETICOS/, "el cuerpo tambien: es lo que se trocea y se recupera");
  }
});

test("la semilla no trae umbrales clinicos", () => {
  // Un umbral sintetico acabaria citado con doc_id en una Decision, que es la forma
  // que tiene un supuesto de disfrazarse de evidencia (ADR-020).
  for (const doc of CORPUS_SEMILLA) {
    assert.ok(
      !/\d+[.,]?\d*\s*(°|grados|mg|ml)\b/i.test(doc.body),
      `${doc.doc_id} trae una magnitud clinica; la semilla habla del proceso, no del cuadro`,
    );
  }
});

// ---------------------------------------------------------------------------
// El estandar se aplica EN la ingesta, no antes ni a mano
// ---------------------------------------------------------------------------

test("un documento sin metadatos obligatorios no entra al almacen", () => {
  const almacen = new AlmacenDeFuentes();
  const sinOrigen = { ...documento(), origin: "" };
  assert.throws(() => almacen.ingest(sinOrigen, { actor: "operador" }), /Ingesta rechazada/);
  assert.deepEqual(almacen.list(), [], "nada se guarda a medias");
});

test("R3 · un documento SIN CAPA DE TEXTO se rechaza nombrando la razon", () => {
  // El que ingiere el jurado en la compuerta 5 puede ser un escaneo, y ahi la
  // consola habla: aceptarlo en silencio dejaria al agente sin saber por que no
  // tiene su contenido.
  const almacen = new AlmacenDeFuentes();
  const escaneado = { ...documento(), doc_id: "poster-escaneado", body: "\n  \n\n  \n" };

  assert.throws(
    () =>
      almacen.ingest(escaneado, {
        actor: "jurado",
        paginas: 1,
        ruta_original: "dataset/textos/Appendicitis/POSTER.pdf",
      }),
    (e: unknown) => {
      const mensaje = (e as Error).message;
      assert.match(mensaje, /SIN CAPA DE TEXTO/);
      assert.match(mensaje, /docs\/corpus-texto\/Appendicitis\/POSTER\.txt/);
      return true;
    },
  );
  assert.equal(almacen.resolver("poster-escaneado"), null);
});

test("un documento con datos de paciente no entra al corpus (ADR-011)", () => {
  const almacen = new AlmacenDeFuentes();
  assert.throws(
    () => almacen.ingest({ ...documento(), eps: "Sura" } as SourceDocument, { actor: "operador" }),
    /campo_prohibido/,
  );
});

test("un documento de densidad baja entra, y el AVISO queda en el registro", () => {
  const almacen = new AlmacenDeFuentes();
  const guia = {
    ...documento(),
    doc_id: "plan-casero-rodilla",
    body: "DATOS SINTETICOS. " + "Camine con el andador. Doble la rodilla despacio. ".repeat(12),
  };

  const recibo = almacen.ingest(guia, { actor: "operador", paginas: 2, ahora: T0 });

  assert.equal(recibo.avisos.length, 1);
  assert.match(recibo.avisos[0]!, /densidad baja/);
  assert.match(almacen.registro()[0]!.detalle, /AVISO/, "el operador tiene que verlo dicho");
  assert.equal(almacen.vigente("plan-casero-rodilla")?.doc_id, "plan-casero-rodilla");
});

// ---------------------------------------------------------------------------
// Chunking por defecto segun kind
// ---------------------------------------------------------------------------

test("sin chunking declarado se aplica el defecto del kind", () => {
  const almacen = almacenSembrado();

  assert.deepEqual(almacen.vigente("semilla-cuidados-herida")?.chunking, CHUNKING_POR_KIND.cuidados);
  assert.deepEqual(almacen.vigente("semilla-movilidad-y-reposo")?.chunking, CHUNKING_POR_KIND.procedimiento);
  assert.equal(CHUNKING_POR_KIND.cuidados.strategy, "parrafo");
  assert.equal(CHUNKING_POR_KIND.procedimiento.strategy, "seccion");
});

test("el techo de chunk es uniforme, y hoy lo acota el TPM y no el prefill", () => {
  // H9 lo habia fijado en 150 por latencia de prefill en la ruta local. Esa ruta se
  // retiro (ADR-025) y la recuperacion es lexica, sin ventana de modelo que trunque.
  // Lo que sigue acotandolo es el techo de 12 000 tokens por minuto de la primaria:
  // cada chunk recuperado viaja en el prompt del decisor.
  for (const spec of Object.values(CHUNKING_POR_KIND)) {
    assert.equal(spec.max_tokens, 350);
  }
});

test("un chunking declarado por el documento manda sobre el defecto", () => {
  const almacen = new AlmacenDeFuentes();
  const doc = { ...documento(), chunking: { strategy: "fijo", max_tokens: 90 } as const };
  almacen.ingest(doc, { actor: "operador", ahora: T0 });

  assert.deepEqual(almacen.vigente(doc.doc_id)?.chunking, { strategy: "fijo", max_tokens: 90 });
  assert.match(almacen.registro()[0]!.detalle, /chunking declarado/);
});

// ---------------------------------------------------------------------------
// retire ARCHIVA, no borra
// ---------------------------------------------------------------------------

test("un documento retirado deja de estar vigente pero su doc_id SIGUE resolviendo", () => {
  const almacen = almacenSembrado();
  almacen.retire("semilla-cuidados-herida", "operador", T1);

  assert.equal(almacen.vigente("semilla-cuidados-herida"), null);
  assert.ok(!almacen.vigentes().some((d) => d.doc_id === "semilla-cuidados-herida"));

  const archivado = almacen.resolver("semilla-cuidados-herida");
  assert.equal(archivado?.title, "Cuidados de la herida quirurgica en casa");
  // Sin esto, retirar un documento borraria la evidencia de todas las decisiones
  // que se apoyaron en el.
});

test("el listado distingue vigente de retirado", () => {
  const almacen = almacenSembrado();
  almacen.retire("semilla-signos-de-alarma", "operador", T1);

  const lista = almacen.list();
  assert.equal(lista.length, 3);
  assert.equal(lista.find((d) => d.doc_id === "semilla-signos-de-alarma")?.status, "retired");
  assert.equal(lista.find((d) => d.doc_id === "semilla-cuidados-herida")?.status, "indexed");
});

test("retirar algo que no esta vigente falla en vez de fingir que hizo algo", () => {
  const almacen = almacenSembrado();
  almacen.retire("semilla-cuidados-herida", "operador", T1);

  assert.throws(() => almacen.retire("semilla-cuidados-herida", "operador", T2), ErrorDeAlmacen);
  assert.throws(() => almacen.retire("no-existe", "operador", T2), ErrorDeAlmacen);
});

// ---------------------------------------------------------------------------
// La historia no se reescribe
// ---------------------------------------------------------------------------

test("un doc_id vigente no se puede sobrescribir", () => {
  const almacen = almacenSembrado();
  assert.throws(
    () => almacen.ingest(CORPUS_SEMILLA[0]!, { actor: "operador", ahora: T1 }),
    /La historia no se reescribe/,
  );
});

test("retirar e ingerir version nueva crea revision 2 y conserva la 1 intacta", () => {
  const almacen = almacenSembrado();
  const original = almacen.vigente("semilla-cuidados-herida")!;

  almacen.retire("semilla-cuidados-herida", "operador", T1);
  const corregido: SourceDocument = {
    ...original,
    title: "Cuidados de la herida quirurgica en casa (corregido)",
    effective_date: "2026-06-01",
  };
  const recibo = almacen.ingest(corregido, { actor: "operador", ahora: T2 });

  assert.equal(recibo.revision, 2);

  const historial = almacen.historial("semilla-cuidados-herida");
  assert.equal(historial.length, 2);
  assert.equal(historial[0]!.doc.title, original.title, "la revision 1 no se toco");
  assert.equal(historial[0]!.retired_at, T1.toISOString());
  assert.equal(historial[1]!.retired_at, null);
  assert.equal(almacen.vigente("semilla-cuidados-herida")?.effective_date, "2026-06-01");
});

test("el almacen guarda copias, no referencias vivas al objeto que le pasaron", () => {
  const almacen = new AlmacenDeFuentes();
  const doc = documento();
  almacen.ingest(doc, { actor: "operador", ahora: T0 });

  doc.title = "titulo cambiado por fuera";
  assert.notEqual(almacen.vigente(doc.doc_id)?.title, "titulo cambiado por fuera");
});

// ---------------------------------------------------------------------------
// El registro: quien, que y cuando
// ---------------------------------------------------------------------------

test("el registro muestra la historia completa del corpus, en orden", () => {
  const almacen = almacenSembrado();
  almacen.retire("semilla-cuidados-herida", "auditora", T1);
  almacen.ingest({ ...CORPUS_SEMILLA[0]!, effective_date: "2026-06-01" }, { actor: "auditora", ahora: T2 });

  const registro = almacen.registro();
  assert.equal(registro.length, 5);
  assert.deepEqual(
    registro.map((e) => e.operacion),
    ["ingest", "ingest", "ingest", "retire", "ingest"],
  );

  const retiro = registro[3]!;
  assert.equal(retiro.actor, "auditora");
  assert.equal(retiro.doc_id, "semilla-cuidados-herida");
  assert.equal(retiro.ts, T1.toISOString());
  assert.match(retiro.detalle, /el doc_id sigue resolviendo/);

  // Una decision solo es auditable si se sabe que conocimiento estaba vigente
  // cuando se tomo: el registro es parte de la trazabilidad, no contabilidad.
  for (const entrada of registro) {
    assert.notEqual(entrada.actor, "");
    assert.notEqual(entrada.detalle, "");
    assert.match(entrada.ts, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("un rechazo no deja rastro en el registro: no paso nada que registrar", () => {
  const almacen = new AlmacenDeFuentes();
  assert.throws(() => almacen.ingest({ ...documento(), body: " " }, { actor: "operador", paginas: 1 }));
  assert.deepEqual(almacen.registro(), []);
});
