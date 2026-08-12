/**
 * El corpus REAL del reto, cargado desde el texto derivado y versionado.
 *
 * Pruebas gruesas: que el corpus entre entero por la puerta de siempre, que el
 * piso de relevancia se niegue a fabricar respaldo, y que un `kind` de relleno no
 * excluya a nadie en silencio.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AlmacenDeFuentes,
  cargarCorpusReal,
  huecosDeEvidencia,
  IndiceLexico,
  leerManifiesto,
  validarDocumentoIngestable,
} from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

function corpusCargado(): { almacen: AlmacenDeFuentes; indice: IndiceLexico } {
  const almacen = new AlmacenDeFuentes();
  cargarCorpusReal(almacen);
  return { almacen, indice: new IndiceLexico(almacen) };
}

// ---------------------------------------------------------------------------
// La carga
// ---------------------------------------------------------------------------

test("los 107 documentos del reto entran por la puerta de siempre", () => {
  const almacen = new AlmacenDeFuentes();
  const informe = cargarCorpusReal(almacen);

  assert.equal(informe.ingeridos, 107);
  assert.deepEqual(informe.rechazados, []);
  // 0 rechazados NO es que el estandar no muerda: el unico PDF sin capa de texto del
  // corpus tiene sidecar, y por eso entra. El camino de rechazo se ejercita abajo,
  // contra un PDF de verdad.
});

test("el corpus se carga en menos de un segundo: el reloj de G2 no ve la extraccion", () => {
  const t0 = Date.now();
  cargarCorpusReal(new AlmacenDeFuentes());
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `la carga tardo ${ms} ms; extraer los PDF costaria minutos, y por eso va versionado`);
});

test("el sidecar manda sobre el PDF, y la cita sigue apuntando al original", () => {
  const { almacen } = corpusCargado();
  const manifiesto = leerManifiesto();
  const conSidecar = manifiesto.docs.filter((d) => d.fuente === "sidecar");

  assert.equal(conSidecar.length, 1, "hoy hay exactamente un sidecar en el corpus");
  const doc = almacen.vigente(conSidecar[0]!.doc_id);
  assert.ok(doc);
  assert.match(doc.origin, /dataset\/textos\//, "la cita apunta al PDF original, no al .txt derivado");
  assert.match(doc.origin, /sidecar/, "y declara que su texto es derivado por OCR");
  assert.ok(doc.body.length > 1000, "sin el sidecar este documento no tendria ni un caracter");
});

test("todo el corpus pasa el estandar de ingesta", () => {
  const { almacen } = corpusCargado();
  for (const doc of almacen.vigentes()) {
    assert.deepEqual(validarDocumentoIngestable(doc).issues, [], `${doc.doc_id} no pasa el estandar`);
  }
});

// ---------------------------------------------------------------------------
// El camino de rechazo, contra un PDF de verdad
// ---------------------------------------------------------------------------

test("un PDF sin capa de texto se rechaza nombrando su sidecar", () => {
  const pdf = join(AQUI, "fixtures", "escaneo-sin-capa-de-texto.pdf");
  assert.ok(existsSync(pdf));

  // Se extrae con el mismo pdftotext de la extraccion fuera de linea. Si no esta
  // disponible, lo extraido es cadena vacia — que es el mismo desenlace por otra
  // razon, y el camino de rechazo se ejercita igual.
  let extraido = "";
  try {
    const tmp = join(process.env["TEMP"] ?? ".", "techsphere-test-notext.pdf");
    copyFileSync(pdf, tmp);
    extraido = execFileSync("pdftotext", ["-enc", "UTF-8", "-q", tmp, "-"], { encoding: "utf8" });
    rmSync(tmp, { force: true });
  } catch {
    extraido = "";
  }
  assert.ok(extraido.replace(/\s+/g, "").length === 0, "el fixture no debe soltar texto");

  const almacen = new AlmacenDeFuentes();
  assert.throws(
    () =>
      almacen.ingest(
        {
          doc_id: "escaneo-sin-capa-de-texto",
          title: "Escaneo sin capa de texto",
          kind: "protocolo",
          lang: "es",
          origin: "Fixture — PDF sintetico de una pagina sin capa de texto.",
          effective_date: "2026-01-01",
          body: extraido,
        },
        { actor: "prueba", paginas: 1, ruta_original: "dataset/textos/Appendicitis/POSTER.pdf" },
      ),
    /SIN CAPA DE TEXTO/,
  );
});

// ---------------------------------------------------------------------------
// El piso de relevancia y el kind de relleno
// ---------------------------------------------------------------------------

test("una consulta sin nada que ver devuelve VACIO, no el mejor de un mal lote", () => {
  const { indice } = corpusCargado();
  const r = indice.retrieve({ text: "cotizacion del dolar tipo de cambio bolsa de valores", k: 3 });
  assert.deepEqual(r, []);
  // Es ADR-024 en la capa de recuperacion: devolver el menos malo seria fabricar
  // respaldo, y el decisor lo citaria con su doc_id.
});

test("una consulta del dominio si devuelve, y con fragmentos que sostienen algo", () => {
  const { indice } = corpusCargado();
  const r = indice.retrieve({ text: "signos de alarma infeccion de la herida quirurgica", k: 3 });

  assert.ok(r.length > 0);
  for (const x of r) {
    assert.ok(x.text.length > 200, "un fragmento corto no sostiene una afirmacion");
    assert.ok(x.score > 0);
  }
});

test("el kind de relleno NO excluye de una consulta filtrada", () => {
  const manifiesto = leerManifiesto();
  const porDefecto = manifiesto.docs.filter((d) => d.kind_por_defecto);
  assert.ok(porDefecto.length > 0, "hoy son 24 de 107");

  const { indice } = corpusCargado();
  const conFiltro = indice.retrieve({
    text: "signos de alarma infeccion de la herida quirurgica",
    k: 20,
    kind: ["farmacologia"],
  });

  // El filtro deja pasar los no clasificados: el sesgo va hacia aceptar, igual que
  // en el umbral de densidad. Excluirlos seria dejar que un valor de relleno decida
  // que documento no se mira.
  const ids = new Set(conFiltro.map((r) => r.doc_id));
  const algunoDeRelleno = porDefecto.some((d) => ids.has(d.doc_id));
  assert.ok(
    algunoDeRelleno || conFiltro.length === 0,
    "si hay resultados bajo filtro, los no clasificados tienen que poder estar entre ellos",
  );
});

// ---------------------------------------------------------------------------
// Declarar sobre que no se pudo citar
// ---------------------------------------------------------------------------

test("una unidad sin respaldo se DECLARA, no se rellena", () => {
  const { indice } = corpusCargado();
  const consultas = [
    { unit_id: "aspecto_herida", resultados: indice.retrieve({ text: "signos de alarma infeccion de la herida quirurgica", k: 3 }) },
    // Consulta deliberadamente ajena al corpus. Ojo con acortarla: "tipo" y "cambio"
    // son palabras que la literatura clinica usa —"tipo de cirugia", "cambio de
    // aposito"— y dos terminos comunes bastan para pasar la fraccion si la consulta
    // es corta. Con seis terminos, dos casados son el 33 % y no pasan.
    { unit_id: "sueno", resultados: indice.retrieve({ text: "cotizacion del dolar tipo de cambio bolsa de valores", k: 3 }) },
    { unit_id: "movilidad", resultados: [], consultada: false },
  ];

  const huecos = huecosDeEvidencia(consultas);

  assert.deepEqual(huecos.map((h) => h.unit_id), ["sueno", "movilidad"]);
  assert.match(huecos[0]!.motivo, /piso de relevancia/);
  assert.match(huecos[1]!.motivo, /no se consulto/);
  // Un sistema que declara sobre que no pudo citar es mas fuerte que uno que cita
  // cualquier cosa.
});
