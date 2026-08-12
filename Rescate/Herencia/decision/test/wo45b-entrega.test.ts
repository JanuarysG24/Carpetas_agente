/**
 * WO-45b — la entrega del resumen a sus dos destinos.
 *
 * Lo que se prueba es la politica y el modo de fallo, que es donde esta el riesgo:
 * el archivo recibe SIEMPRE, el canal solo cuando escala, y si el canal se cae el
 * resumen NO se pierde y la falla queda escrita.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateSummaryDelivery, type CallSummary } from "@techsphere/contracts";
import { ArchivoDeSesiones, CanalDeAlerta, SumideroDeResumenes } from "../src/index.ts";

function resumen(session_id: string, escalate: boolean): CallSummary {
  return {
    session_id,
    generated_at: "2026-08-08T22:00:00.000Z",
    patient_ref: "pref-9f2c41ab",
    identity_status: "identificado",
    frame: { provenance: "inferred", rounds: 1, context_complete: true },
    findings: [{ unit_id: "fiebre", state: 3, raw: "me dio calentura", normalized: 38.6 }],
    decision: {
      escalate,
      criticality: escalate ? "rojo" : "verde",
      reason: escalate ? "VP y VD coinciden en escalar." : "Los dos votos callan.",
      reason_code: "evaluado",
      branch: "or",
      traces: { doc_ids: ["doc-1"], rules_fired: escalate ? ["CO-02"] : [] },
    },
    versions: { domain_version: "postop-0.1.0", vd_version: "vd-tabla-0.2.0", embedding_model: "lexical-bm25/x" },
  };
}

const raiz = () => mkdtempSync(join(tmpdir(), "techsphere-sesiones-"));

test("el archivo recibe SIEMPRE; el canal solo cuando escala", () => {
  const archivo = new ArchivoDeSesiones(raiz());
  const canal = new CanalDeAlerta();
  const sink = new SumideroDeResumenes(archivo, canal);

  const sinAlerta = sink.deliver(resumen("s-verde", false), ["session_archive"]);
  assert.deepEqual(sinAlerta, { delivered: ["session_archive"], failed: [] });
  assert.equal(canal.recibidos.length, 0);

  const conAlerta = sink.deliver(resumen("s-rojo", true), ["session_archive", "alert_channel"]);
  assert.deepEqual(conAlerta, { delivered: ["session_archive", "alert_channel"], failed: [] });
  assert.equal(canal.recibidos.length, 1);
});

test("el personal alertado recibe EL CASO, no un timbre", () => {
  const lineas: string[] = [];
  const canal = new CanalDeAlerta({ escribir: (l) => lineas.push(l) });
  new SumideroDeResumenes(new ArchivoDeSesiones(raiz()), canal).deliver(resumen("s-rojo", true), [
    "session_archive",
    "alert_channel",
  ]);

  assert.match(lineas[0]!, /rojo/);
  assert.match(lineas[0]!, /coinciden en escalar/);
  assert.match(lineas[0]!, /unidades con valor/);
});

test("con el canal CAIDO el resumen NO se pierde, y la falla queda escrita", () => {
  const dir = raiz();
  const archivo = new ArchivoDeSesiones(dir);
  const sink = new SumideroDeResumenes(archivo, new CanalDeAlerta({ caido: true }));

  const recibo = sink.deliver(resumen("s-rojo", true), ["session_archive", "alert_channel"]);

  assert.deepEqual(recibo.delivered, ["session_archive"]);
  assert.deepEqual(recibo.failed, ["alert_channel"]);

  // El resumen persiste en disco...
  const enDisco = JSON.parse(readFileSync(join(dir, "s-rojo.json"), "utf8")) as CallSummary;
  assert.equal(enDisco.session_id, "s-rojo");
  // ...y la falla no desaparece: un fallo de entrega sin rastro es indistinguible de
  // una entrega que nunca hizo falta.
  assert.equal(sink.fallas.length, 1);
  assert.equal(sink.fallas[0]!.destino, "alert_channel");
  assert.match(sink.fallas[0]!.motivo, /no responde/);
});

test("el archivo se puede releer: el resumen de una llamada vieja se encuentra por su id", () => {
  const dir = raiz();
  const archivo = new ArchivoDeSesiones(dir);
  new SumideroDeResumenes(archivo, new CanalDeAlerta()).deliver(resumen("s-vieja", false), ["session_archive"]);

  assert.equal(new ArchivoDeSesiones(dir).leer("s-vieja")?.session_id, "s-vieja");
  assert.equal(archivo.leer("no-existe"), null);
});

test("session_archive se añade aunque no lo pidan: perder el registro auditable no es una opcion", () => {
  const archivo = new ArchivoDeSesiones(raiz());
  const sink = new SumideroDeResumenes(archivo, new CanalDeAlerta());

  const recibo = sink.deliver(resumen("s-solo-canal", true), ["alert_channel"]);

  assert.ok(recibo.delivered.includes("session_archive"));
  assert.ok(archivo.leer("s-solo-canal"));
  // El contrato tambien lo exige: una lista sin session_archive es incoherente.
  assert.equal(validateSummaryDelivery(resumen("s", true), ["alert_channel"]).valid, false);
});

test("el archivo va PRIMERO: una alerta sin caso que la sustente es peor que una alerta tardia", () => {
  const orden: string[] = [];
  const dir = raiz();
  const archivo = new ArchivoDeSesiones(dir);
  const original = archivo.entregar.bind(archivo);
  archivo.entregar = (r) => {
    orden.push("archivo");
    original(r);
  };
  const canal = new CanalDeAlerta({ escribir: () => orden.push("canal") });

  new SumideroDeResumenes(archivo, canal).deliver(resumen("s-orden", true), [
    "session_archive",
    "alert_channel",
  ]);

  assert.deepEqual(orden, ["archivo", "canal"]);
});
