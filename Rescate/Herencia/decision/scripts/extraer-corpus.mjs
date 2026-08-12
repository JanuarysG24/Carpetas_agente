#!/usr/bin/env node
/**
 * Extraccion FUERA DE LINEA del corpus real a texto plano.
 *
 * El reloj de la compuerta 2 no debe ver ningun trabajo que se pueda hacer antes:
 * extraer 107 PDF cuesta minutos, y hacerlo aqui —una vez, versionando el
 * resultado— lo baja a cero en el arranque. Es el mismo criterio del sidecar y del
 * indice preconstruido.
 *
 *   node scripts/extraer-corpus.mjs --seco    solo cuenta y diagnostica
 *   node scripts/extraer-corpus.mjs           escribe corpus/ y el manifiesto
 *
 * REGLA DEL SIDECAR (R2): un .txt en docs/corpus-texto/ con la misma ruta relativa
 * MANDA sobre el PDF. El doc_id y la cita siguen apuntando al original: el texto es
 * derivado, igual que el indice (ADR-015).
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PDFS = join(RAIZ, "MaterialReto", "ParticipantArtifacts", "dataset", "textos");
const SIDECARS = join(RAIZ, "docs", "corpus-texto");
const SALIDA = join(RAIZ, "decision", "corpus");

const seco = process.argv.includes("--seco");

// ---------------------------------------------------------------------------

function listarPdfs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...listarPdfs(ruta));
    else if (entrada.toLowerCase().endsWith(".pdf")) salida.push(ruta);
  }
  return salida.sort();
}

/**
 * pdftotext separa paginas con salto de pagina (\f): es la cuenta mas fiable que hay
 * sin pdfinfo.
 *
 * El `pdftotext` de Git for Windows NO abre rutas con caracteres no ASCII —pasa los
 * bytes sin usar la API ancha de Windows y devuelve "I/O Error: Couldn't open file"—
 * y medio corpus tiene acentos en el nombre. Se copia a un nombre ASCII temporal
 * antes de extraer. Uniforme para todos, no condicional: una rama que solo se toma
 * con acentos es una rama que se prueba la mitad de las veces.
 */
const TEMPORAL = join(process.env["TEMP"] ?? ".", "techsphere-extraccion.pdf");

function extraer(rutaPdf) {
  copyFileSync(rutaPdf, TEMPORAL);
  try {
    const crudo = execFileSync("pdftotext", ["-enc", "UTF-8", "-q", TEMPORAL, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const paginas = Math.max(1, crudo.split("\f").filter((p) => p.trim() !== "").length);
    return { texto: crudo, paginas };
  } finally {
    rmSync(TEMPORAL, { force: true });
  }
}

/** Espacios colapsados y guiones de corte de linea unidos: el PDF parte palabras al final de renglon. */
function limpiar(texto) {
  return texto
    .replace(/\r/g, "")
    .replace(/-\n(?=[a-záéíóúñ])/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slug(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * `kind` por CONTENIDO, no por nombre de carpeta.
 *
 * La advertencia venia del material: `textos/breast_cancer/` contiene documentos de
 * cuello uterino. Aqui la carpeta no se usa para nada — la clasificacion sale de
 * terminos del propio texto, y queda registrada en el manifiesto para que sea
 * auditable en vez de creible.
 *
 * Es clasificacion documental, no criterio clinico: decide en que cajon del corpus
 * cae un documento, no que significa para un paciente.
 */
const REGLAS_DE_KIND = [
  ["farmacologia", /\b(dosis|mg\/kg|posolog|farmacocin|antibiotic prophylaxis|profilaxis antibiotica|analgesi[ac] multimodal|opioid|paracetamol|metamizol)\b/gi],
  ["protocolo", /\b(protocolo|guideline|guia de practica|consensus|consenso|recommendation|recomendaciones|eras\b|pathway|via clinica)\b/gi],
  ["complicaciones", /\b(complicac|infeccion del sitio quirurgico|surgical site infection|ssi\b|dehiscenc|absces|reoperac|readmis|morbidity|mortality|sepsis|fistula)\b/gi],
  ["cuidados", /\b(cuidados en casa|home care|postoperative care|cuidado de la herida|wound care|alta hospitalaria|discharge instruction|plan de cuidado|autocuidado|recuperacion en casa)\b/gi],
  ["procedimiento", /\b(tecnica quirurgica|surgical technique|procedimiento|laparoscop|resecc|anastomosis|abordaje|incision|operative)\b/gi],
];

function clasificar(texto) {
  const muestra = texto.slice(0, 20000);
  const puntajes = REGLAS_DE_KIND.map(([kind, re]) => [kind, (muestra.match(re) ?? []).length]);
  puntajes.sort((a, b) => b[1] - a[1]);
  const [mejor, puntos] = puntajes[0];
  // Sin señal suficiente cae a `procedimiento`, que es el cajon mas neutro del
  // enumerado, y el manifiesto lo marca para que se vea cuantos cayeron ahi por
  // defecto en vez de por evidencia.
  return { kind: puntos >= 2 ? mejor : "procedimiento", puntos, por_defecto: puntos < 2 };
}

/** Idioma por palabras funcionales. Basta: solo alimenta el metadato `lang`. */
function idioma(texto) {
  const m = texto.slice(0, 8000).toLowerCase();
  const es = (m.match(/\b(de|que|los|para|con|una|del|las)\b/g) ?? []).length;
  const en = (m.match(/\b(the|of|and|with|for|were|that|this)\b/g) ?? []).length;
  return es >= en ? "es" : "en";
}

// ---------------------------------------------------------------------------

const pdfs = listarPdfs(PDFS);
const registros = [];
const sinTexto = [];
const conSidecar = [];

for (const rutaPdf of pdfs) {
  const rel = relative(PDFS, rutaPdf).split(sep).join("/");
  const rutaSidecar = join(SIDECARS, rel.replace(/\.pdf$/i, ".txt"));

  let texto;
  let paginas;
  let fuente;

  if (existsSync(rutaSidecar)) {
    texto = readFileSync(rutaSidecar, "utf8");
    // El sidecar no tiene paginas propias: se leen del PDF original para que el
    // diagnostico de densidad siga siendo sobre el documento y no sobre el derivado.
    paginas = extraer(rutaPdf).paginas;
    fuente = "sidecar";
    conSidecar.push(rel);
  } else {
    const r = extraer(rutaPdf);
    texto = r.texto;
    paginas = r.paginas;
    fuente = "pdftotext";
  }

  const limpio = limpiar(texto);
  const caracteres = limpio.replace(/\s+/g, " ").trim().length;
  const densidad = caracteres / paginas;
  const { kind, puntos, por_defecto } = clasificar(limpio);

  const registro = {
    doc_id: slug(rel.replace(/^.*\//, "")),
    ruta_original: `dataset/textos/${rel}`,
    carpeta: rel.split("/")[0],
    title: rel.split("/").pop().replace(/\.pdf$/i, ""),
    kind,
    kind_por_defecto: por_defecto,
    kind_puntos: puntos,
    lang: idioma(limpio),
    fuente,
    paginas,
    caracteres,
    densidad: Number(densidad.toFixed(1)),
  };

  if (densidad < 40) sinTexto.push(registro);
  registros.push({ ...registro, texto: limpio });
}

// --- Diagnostico -----------------------------------------------------------

const duplicados = new Map();
for (const r of registros) duplicados.set(r.doc_id, (duplicados.get(r.doc_id) ?? 0) + 1);
const repetidos = [...duplicados].filter(([, n]) => n > 1);

console.log(`PDF encontrados            : ${pdfs.length}`);
console.log(`Con sidecar (manda el txt) : ${conSidecar.length}${conSidecar.length ? ` -> ${conSidecar.join(", ")}` : ""}`);
console.log(`Sin capa de texto (<40/pag): ${sinTexto.length}`);
for (const r of sinTexto) console.log(`   RECHAZADO ${r.ruta_original} (${r.caracteres} car. / ${r.paginas} pag = ${r.densidad})`);
console.log(`Densidad baja (40-800/pag) : ${registros.filter((r) => r.densidad >= 40 && r.densidad < 800).length}`);
console.log(`doc_id repetidos           : ${repetidos.length}${repetidos.length ? ` -> ${repetidos.map(([d, n]) => `${d} x${n}`).join(", ")}` : ""}`);

const porKind = {};
for (const r of registros) porKind[r.kind] = (porKind[r.kind] ?? 0) + 1;
console.log(`Reparto por kind           : ${JSON.stringify(porKind)} (sobre ${registros.length} documentos, incluidos los que se rechazaran)`);
console.log(`kind por defecto           : ${registros.filter((r) => r.kind_por_defecto).length}`);
console.log(`Idioma                     : es=${registros.filter((r) => r.lang === "es").length} en=${registros.filter((r) => r.lang === "en").length}`);
console.log(`Texto total                : ${(registros.reduce((a, r) => a + r.texto.length, 0) / 1e6).toFixed(2)} MB`);

if (seco) process.exit(0);

// --- Escritura -------------------------------------------------------------

mkdirSync(SALIDA, { recursive: true });
const manifiesto = [];
for (const r of registros) {
  const { texto, ...meta } = r;
  writeFileSync(join(SALIDA, `${r.doc_id}.txt`), texto, "utf8");
  manifiesto.push(meta);
}
writeFileSync(
  join(SALIDA, "manifiesto.json"),
  JSON.stringify(
    {
      _declaracion:
        "Texto DERIVADO de los PDF del reto, extraido fuera de linea con pdftotext (poppler). " +
        "La fuente sigue siendo el PDF: el doc_id y la cita apuntan al original (ADR-015). " +
        "El kind se clasifico por CONTENIDO, nunca por nombre de carpeta, y su puntaje queda " +
        "registrado para que la clasificacion sea auditable en vez de creible.",
      generado: new Date().toISOString(),
      extractor: "pdftotext (poppler, Git for Windows)",
      documentos: manifiesto.length,
      docs: manifiesto,
    },
    null,
    2,
  ),
  "utf8",
);
console.log(`\nEscritos ${manifiesto.length} textos + manifiesto en decision/corpus/`);
