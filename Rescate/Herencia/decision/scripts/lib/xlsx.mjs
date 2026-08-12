/**
 * Lector de .xlsx SIN DEPENDENCIAS. Un .xlsx es un ZIP de XML y `node:zlib` basta.
 *
 * Copiado de `deterministic/scripts/trayectorias-a-fixture.mjs` por la misma razon por
 * la que se escribio alli: añadir una libreria de hojas de calculo a un paquete que la
 * compuerta G3 audita, por un script de un solo uso, seria meter superficie de
 * dependencia donde mas cara sale.
 *
 * OFFLINE: no entra al camino evaluable. Ningun modulo del sistema lee un .xlsx.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export function leerZip(ruta) {
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

const desescapar = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

function textoDe(fragmento) {
  return [...fragmento.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1])).join("");
}

export function leerHoja(archivos) {
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

/** Filas a objetos, usando la primera fila como encabezado. */
export function comoObjetos(filas) {
  const [cabecera, ...resto] = filas;
  return resto.map((f) => Object.fromEntries(cabecera.map((k, i) => [k, f[i] ?? null])));
}
