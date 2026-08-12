/**
 * WO-36 — el estandar de ingesta: metadatos obligatorios y CUERPO APROVECHABLE.
 *
 * La parte de metadatos la da el contrato. Lo que se prueba aqui de nuevo es lo que
 * el contrato no puede saber solo: si el cuerpo trae texto.
 *
 * ============ El caso que esto cubre, dicho con nombre y apellido ============
 *
 * El jurado prueba la compuerta 5 subiendo un documento suyo. Si resulta ser un
 * escaneo, la consola tiene que DECIRLO en ese momento. Un documento que se acepta
 * y no aporta nada es peor que uno rechazado con su razon, porque despues alguien
 * pregunta por su contenido y el agente no sabe por que no lo tiene.
 *
 * ============================================================================
 *
 * Los umbrales salen de medir el corpus real con dos extractores, no de intuicion
 * (`docs/corpus-texto/README.md`), y el sesgo esta puesto a proposito hacia ACEPTAR:
 * tres de los cuatro documentos de densidad baja son planes de cuidado dirigidos al
 * paciente, que es el material mas pertinente que hay para este agente.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  avisoDeDensidad,
  exigirDocumentoIngestable,
  leerCuerpo,
  rutaDeSidecar,
  validarDocumentoIngestable,
} from "../src/index.ts";
import { documento } from "./fixtures/ayudas.ts";

// ---------------------------------------------------------------------------
// Metadatos obligatorios
// ---------------------------------------------------------------------------

test("un documento sin effective_date u origin se rechaza", () => {
  for (const campo of ["doc_id", "title", "kind", "lang", "origin", "effective_date"] as const) {
    const incompleto = { ...documento() };
    delete incompleto[campo];
    const r = validarDocumentoIngestable(incompleto);
    assert.equal(r.valid, false, `falto ${campo} y el documento paso igual`);
    assert.ok(r.issues.some((i) => i.path === campo));
  }
});

test("effective_date es la vigencia del CONOCIMIENTO, y el mensaje lo dice", () => {
  const r = validarDocumentoIngestable({ ...documento(), effective_date: "" });
  assert.match(r.issues.find((i) => i.path === "effective_date")?.hint ?? "", /no fecha de carga/);
});

test("todos los problemas se acumulan: el operador arregla el documento de una vez", () => {
  const r = validarDocumentoIngestable({ body: "x", kind: "historia_clinica" });
  assert.ok(
    r.issues.length >= 5,
    "un problema por ejecucion obliga a ingerir cinco veces para descubrir cinco errores",
  );
});

// ---------------------------------------------------------------------------
// Cuerpo aprovechable: la regla nueva
// ---------------------------------------------------------------------------

test("un PDF sin capa de texto se rechaza CON RAZON y con la instruccion del sidecar", () => {
  // Lo que suelta un escaneo: saltos de linea, algun artefacto, ningun contenido.
  const escaneado = { ...documento(), body: "\n\n  \n  \n\n" };

  const r = validarDocumentoIngestable(escaneado, {
    paginas: 1,
    ruta_original: "dataset/textos/Appendicitis/POSTER.pdf",
  });

  assert.equal(r.valid, false);
  // El contrato ya dice "la cadena llego vacia", que es cierto e inutil frente a un
  // escaneo. Lo que se exige aqui es que ADEMAS este el problema que dice que hacer.
  const problema = r.issues.find((i) => i.path === "body" && /SIN CAPA DE TEXTO/.test(i.message));
  assert.ok(problema, "un cuerpo sin texto tiene que rechazarse con la instruccion del sidecar");
  assert.match(problema.message, /SIN CAPA DE TEXTO/);
  assert.match(problema.hint, /docs\/corpus-texto\/Appendicitis\/POSTER\.txt/);
  assert.match(problema.hint, /FUERA DE LINEA/);
  assert.match(
    problema.hint,
    /doc_id y la cita siguen apuntando al original/,
    "el texto es derivado, igual que el indice: la fuente sigue siendo el documento (ADR-015)",
  );
});

test("un cuerpo con residuo de extraccion tampoco pasa por tener unos caracteres sueltos", () => {
  const r = validarDocumentoIngestable(
    { ...documento(), body: "Figura 1. Tabla 2. 14%" },
    { paginas: 1 },
  );
  assert.equal(r.valid, false);
});

test("sin declarar paginas, el piso es absoluto", () => {
  assert.equal(leerCuerpo("corto").veredicto, "sin_texto_aprovechable");
  assert.equal(leerCuerpo("x".repeat(200)).veredicto, "utilizable");
});

// ---------------------------------------------------------------------------
// Lo que NO se rechaza, y es lo que mas importa acertar
// ---------------------------------------------------------------------------

test("un documento de DENSIDAD BAJA se ingiere normal: no es un defecto de extraccion", () => {
  // Medido: 165-766 caracteres por pagina en cuatro documentos del corpus, y son
  // guias visuales para pacientes, hechas de ilustraciones. Se comprobo ademas que
  // OCR sobre uno de ellos daba EXACTAMENTE los mismos caracteres que la extraccion
  // directa: no habia texto atrapado en imagenes.
  const guia = {
    ...documento(),
    doc_id: "plan-casero-reemplazo-rodilla",
    body: "DATOS SINTETICOS. " + "Camine con el andador. Doble la rodilla despacio. ".repeat(12),
  };

  const r = validarDocumentoIngestable(guia, { paginas: 2 });
  assert.deepEqual(r.issues, [], "excluirlos habria quitado lo mas on-target del corpus");

  const lectura = leerCuerpo(guia.body, 2);
  assert.equal(lectura.veredicto, "densidad_baja");

  const aviso = avisoDeDensidad(guia, 2);
  assert.ok(aviso, "se ingiere, pero el operador merece verlo dicho");
  assert.match(aviso, /Se ingiere igual/);
});

test("un documento normal no genera aviso ninguno", () => {
  assert.equal(avisoDeDensidad(documento(), 1), null);
});

// ---------------------------------------------------------------------------
// La correspondencia del sidecar
// ---------------------------------------------------------------------------

test("el sidecar es la MISMA ruta relativa, sin catalogo intermedio", () => {
  assert.equal(
    rutaDeSidecar("dataset/textos/Appendicitis/REVISION DE LA LITERATURA.pdf"),
    "docs/corpus-texto/Appendicitis/REVISION DE LA LITERATURA.txt",
  );
  assert.equal(
    rutaDeSidecar("textos/cholecystitis/PLAN DE CUIDADO.pdf"),
    "docs/corpus-texto/cholecystitis/PLAN DE CUIDADO.txt",
  );
  // Un mapa de rutas seria una cosa mas que se puede desincronizar del disco.
});

test("la consola LANZA en la frontera, con el problema formateado", () => {
  assert.throws(
    () => exigirDocumentoIngestable({ ...documento(), body: " " }, { paginas: 3 }),
    /Ingesta rechazada/,
  );
});
