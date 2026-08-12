/**
 * OFFLINE — convierte el dataset del reto en el fixture de las 160 trayectorias.
 *
 * No entra al camino evaluable: se ejecuta a mano, escribe un JSON y ahi termina.
 * El motor determinista jamas lee un .xlsx.
 *
 *   node scripts/trayectorias-a-fixture.mjs
 *
 * Lee `trayectorias_postop_silver.xlsx` (los valores por dia) y `dataset_final.xlsx`
 * (que es donde vive `label_ground_truth`, una etiqueta por caso), los cruza por
 * `caso_id = "caso_" + trayectoria_id` y escribe `test/fixtures/trayectorias-160.json`.
 *
 * Sin dependencias: un .xlsx es un ZIP de XML, y `node:zlib` basta. Añadir una
 * libreria de hojas de calculo a esta capa por un script de un solo uso habria
 * metido superficie de dependencia en el paquete que la compuerta G3 audita.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATASET = resolve(AQUI, "../../MaterialReto/ParticipantArtifacts/dataset");
const SALIDA = resolve(AQUI, "../test/fixtures/trayectorias-160.json");

// --- ZIP -------------------------------------------------------------------

function leerZip(ruta) {
  const buf = readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${ruta}: no parece un ZIP (sin EOCD).`);

  const entradas = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const archivos = new Map();

  for (let i = 0; i < entradas; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("directorio central corrupto");
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const nombreLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + nombreLen).toString("utf8");

    const nombreLocalLen = buf.readUInt16LE(offsetLocal + 26);
    const extraLocalLen = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nombreLocalLen + extraLocalLen;
    const datos = buf.subarray(inicio, inicio + comprimido);

    archivos.set(nombre, metodo === 0 ? datos : inflateRawSync(datos));
    p += 46 + nombreLen + extraLen + comentarioLen;
  }

  return archivos;
}

// --- XML de hoja -----------------------------------------------------------

const desescapar = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

function textoDe(fragmento) {
  const partes = [...fragmento.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1]));
  return partes.join("");
}

function leerHoja(archivos) {
  const compartidas = [];
  const ss = archivos.get("xl/sharedStrings.xml");
  if (ss) {
    for (const m of ss.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDe(m[1]));
  }

  const nombreHoja = [...archivos.keys()].filter((n) => n.startsWith("xl/worksheets/sheet")).sort()[0];
  const xml = archivos.get(nombreHoja).toString("utf8");
  const filas = [];

  for (const fila of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const c of fila[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? "";
      const cuerpo = c[2] ?? "";
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      if (t === "inlineStr") {
        celdas.push(textoDe(cuerpo));
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
        celdas.push(v === undefined ? null : t === "s" ? compartidas[Number(v)] : desescapar(v));
      }
    }
    if (celdas.length > 0) filas.push(celdas);
  }

  return filas;
}

function comoObjetos(filas) {
  const cabecera = filas[0];
  return filas.slice(1).map((f) => Object.fromEntries(cabecera.map((c, i) => [c, f[i] ?? null])));
}

// --- Cruce -----------------------------------------------------------------

const trayectorias = comoObjetos(leerHoja(leerZip(resolve(DATASET, "trayectorias_postop_silver.xlsx"))));
const dialogos = comoObjetos(leerHoja(leerZip(resolve(DATASET, "dataset_final.xlsx"))));

const etiquetas = new Map();
for (const d of dialogos) {
  const previa = etiquetas.get(d.caso_id);
  if (previa !== undefined && previa !== d.label_ground_truth) {
    throw new Error(`El caso ${d.caso_id} tiene dos etiquetas distintas: ${previa} y ${d.label_ground_truth}.`);
  }
  etiquetas.set(d.caso_id, d.label_ground_truth);
}

const casos = trayectorias.map((t) => {
  const etiqueta = etiquetas.get(`caso_${t.trayectoria_id}`);
  if (etiqueta === undefined) throw new Error(`Sin label_ground_truth para ${t.trayectoria_id}.`);
  return {
    trayectoria_id: t.trayectoria_id,
    paciente_id: t.paciente_id,
    dia_postop: Number(t.dia_postop),
    arquetipo_trayectoria: t.arquetipo_trayectoria,
    dolor_nrs: Number(t.dolor_nrs),
    fiebre_c: Number(t.fiebre_c),
    movilidad: t.movilidad,
    herida: t.herida,
    apetito: t.apetito,
    sueno: t.sueno,
    label_ground_truth: etiqueta,
  };
});

casos.sort((a, b) => (a.trayectoria_id < b.trayectoria_id ? -1 : 1));

const reparto = casos.reduce((acc, c) => ({ ...acc, [c.label_ground_truth]: (acc[c.label_ground_truth] ?? 0) + 1 }), {});

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(
  SALIDA,
  JSON.stringify(
    {
      _declaracion:
        "DATOS SINTETICOS DEL RETO — sin validez clinica. Extraido de trayectorias_postop_silver.xlsx cruzado con label_ground_truth de dataset_final.xlsx. Regenerar con scripts/trayectorias-a-fixture.mjs.",
      n: casos.length,
      reparto,
      casos,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

console.log(`${casos.length} trayectorias -> ${SALIDA}`);
console.log(`reparto (n=${casos.length}): ${JSON.stringify(reparto)}`);
