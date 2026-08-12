#!/usr/bin/env node
/**
 * Mide la recuperacion sobre el corpus REAL a tres techos de chunk.
 *
 * No busca una metrica bonita. La pregunta es una sola y es la de la rubrica:
 * ¿los fragmentos que vuelven SOSTIENEN una afirmacion con su doc_id? Un puntaje
 * alto sobre fragmentos que no dicen nada util es peor que un puntaje bajo, porque
 * induce confianza.
 *
 *   node scripts/medir-recuperacion.mjs           tabla comparativa
 *   node scripts/medir-recuperacion.mjs --ver     ademas, los fragmentos a ojo
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AlmacenDeFuentes, IndiceLexico } from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(AQUI, "..", "corpus");
const K = 3;
const TECHOS = [150, 350, 600];

/**
 * Consultas del VOCABULARIO DEL DOMINIO, que es como consulta el decisor (ADR-019),
 * no como habla el paciente. Doce: las seis unidades y seis situaciones compuestas
 * que son las que de verdad tiene que sostener una afirmacion.
 */
const CONSULTAS = [
  { id: "secrecion_purulenta", texto: "secrecion purulenta en la herida quirurgica, exudado, pus" },
  { id: "dehiscencia", texto: "dehiscencia de la herida quirurgica, apertura de bordes" },
  { id: "fiebre", texto: "fiebre postoperatoria, temperatura elevada despues de la cirugia" },
  { id: "dolor_intensidad", texto: "dolor postoperatorio intensidad control analgesia" },
  { id: "movilidad", texto: "movilizacion temprana deambulacion despues de la cirugia" },
  { id: "aspecto_herida", texto: "aspecto de la herida eritema enrojecimiento inflamacion" },
  { id: "apetito", texto: "tolerancia oral apetito alimentacion despues de la cirugia" },
  { id: "sueno", texto: "descanso sueño recuperacion postoperatoria en casa" },
  { id: "infeccion_sitio_quirurgico", texto: "infeccion del sitio quirurgico diagnostico y manejo" },
  { id: "signos_alarma_alta", texto: "signos de alarma cuando consultar despues del alta hospitalaria" },
  { id: "cuidado_herida_casa", texto: "cuidado de la herida en casa curacion aposito" },
  { id: "complicacion_apendicectomia", texto: "complicaciones despues de apendicectomia absceso" },
];

// ---------------------------------------------------------------------------

const manifiesto = JSON.parse(readFileSync(join(CORPUS, "manifiesto.json"), "utf8"));

function almacenCon(techo) {
  const almacen = new AlmacenDeFuentes();
  let rechazados = 0;
  for (const meta of manifiesto.docs) {
    const body = readFileSync(join(CORPUS, `${meta.doc_id}.txt`), "utf8");
    try {
      almacen.ingest(
        {
          doc_id: meta.doc_id,
          title: meta.title,
          kind: meta.kind,
          lang: meta.lang,
          origin: `Corpus del reto — ${meta.ruta_original} (texto derivado con ${manifiesto.extractor})`,
          effective_date: "2024-01-01",
          body,
          chunking: { strategy: "parrafo", max_tokens: techo },
        },
        { actor: "extraccion", paginas: meta.paginas, ruta_original: meta.ruta_original },
      );
    } catch {
      rechazados++;
    }
  }
  return { almacen, rechazados };
}

const filas = [];
const detalle = {};

for (const techo of TECHOS) {
  const { almacen, rechazados } = almacenCon(techo);
  const indice = new IndiceLexico(almacen);
  const status = indice.status();

  let conResultados = 0;
  let sumaTop = 0;
  const docsDistintos = new Set();
  detalle[techo] = [];

  for (const consulta of CONSULTAS) {
    const r = indice.retrieve({ text: consulta.texto, k: K });
    if (r.length > 0) {
      conResultados++;
      sumaTop += r[0].score;
      for (const x of r) docsDistintos.add(x.doc_id);
    }
    detalle[techo].push({ consulta, resultados: r });
  }

  filas.push({
    techo,
    docs: status.docs,
    rechazados,
    chunks: status.chunks,
    car_por_chunk: Math.round(
      (manifiesto.docs.reduce((a, m) => a + m.caracteres, 0) || 0) / Math.max(1, status.chunks),
    ),
    consultas_con_resultado: `${conResultados}/${CONSULTAS.length}`,
    top1_medio: Number((sumaTop / Math.max(1, conResultados)).toFixed(2)),
    docs_distintos: docsDistintos.size,
  });
}

console.log(`\nCorpus: ${manifiesto.documentos} documentos · k=${K} · ${CONSULTAS.length} consultas del vocabulario del dominio\n`);
console.table(filas);

console.log(
  `\nEl puntaje BM25 NO es comparable entre techos —cambia la longitud media, que es el denominador\n` +
    `de la normalizacion—, asi que "top1_medio" sirve para ver dispersion dentro de un techo y no\n` +
    `para elegir entre techos. Lo que decide es mirar los fragmentos (--ver).\n`,
);

if (process.argv.includes("--ver")) {
  for (const techo of TECHOS) {
    console.log(`\n${"=".repeat(78)}\nTECHO ${techo} tokens\n${"=".repeat(78)}`);
    for (const { consulta, resultados } of detalle[techo]) {
      console.log(`\n[${consulta.id}]`);
      if (resultados.length === 0) {
        console.log("   (sin resultados)");
        continue;
      }
      for (const r of resultados.slice(0, 2)) {
        console.log(`   ${r.score.toFixed(2)}  ${r.doc_id}`);
        console.log(`        ${r.text.replace(/\s+/g, " ").slice(0, 300)}`);
      }
    }
  }
}
