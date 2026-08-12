/**
 * Carga del corpus REAL del reto desde el texto derivado y versionado.
 *
 * ============ Por que el texto va versionado y el PDF no ============
 *
 * `MaterialReto/` no se versiona —son 128 MB del organizador— asi que este texto
 * derivado es lo unico que hace el repositorio AUTOCONTENIDO: el jurado clona y
 * tiene el corpus, sin descargar nada.
 *
 * Y saca la extraccion del reloj de la compuerta 2, que es el mismo criterio del
 * sidecar y del indice preconstruido: extraer 107 PDF cuesta minutos y cargar 107
 * `.txt` cuesta milisegundos. El reloj de G2 no debe ver ningun trabajo que se pueda
 * hacer antes.
 *
 * La fuente sigue siendo el PDF: `origin` apunta al original y el `doc_id` resuelve
 * a el. El texto es derivado, igual que el indice (ADR-015).
 *
 * ====================================================================
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SourceDocument } from "@techsphere/contracts";
import type { AlmacenDeFuentes } from "./almacen.ts";
import { RAIZ_PAQUETE } from "../rutas.ts";

/**
 * Desde la raiz del paquete, no desde este modulo: relativa al modulo daba
 * `dist/corpus` al ejecutar compilado, y las pruebas —que corren sobre `src/`— no lo
 * veian nunca.
 */
export const CORPUS_REAL = join(RAIZ_PAQUETE, "corpus");

export interface EntradaDeManifiesto {
  doc_id: string;
  ruta_original: string;
  carpeta: string;
  title: string;
  kind: SourceDocument["kind"];
  /** ADR-024: el clasificador no tuvo señal y se puso el valor mas neutro. */
  kind_por_defecto: boolean;
  kind_puntos: number;
  lang: string;
  fuente: "pdftotext" | "sidecar";
  paginas: number;
  caracteres: number;
  densidad: number;
}

export interface Manifiesto {
  _declaracion: string;
  generado: string;
  extractor: string;
  documentos: number;
  docs: EntradaDeManifiesto[];
}

export function leerManifiesto(raiz = CORPUS_REAL): Manifiesto {
  return JSON.parse(readFileSync(join(raiz, "manifiesto.json"), "utf8")) as Manifiesto;
}

export interface InformeDeCarga {
  ingeridos: number;
  rechazados: Array<{ doc_id: string; motivo: string }>;
  kind_por_defecto: number;
}

/**
 * Ingiere el corpus real por la MISMA puerta que cualquier documento: el estandar
 * completo, incluida la comprobacion de cuerpo aprovechable. Un corpus que entrara
 * por una puerta trasera no probaria nada sobre la puerta que usa el jurado.
 */
export function cargarCorpusReal(
  almacen: AlmacenDeFuentes,
  opciones: { actor?: string; raiz?: string; max_tokens?: number } = {},
): InformeDeCarga {
  const raiz = opciones.raiz ?? CORPUS_REAL;
  const actor = opciones.actor ?? "corpus-del-reto";
  const manifiesto = leerManifiesto(raiz);

  const rechazados: InformeDeCarga["rechazados"] = [];
  let ingeridos = 0;

  for (const meta of manifiesto.docs) {
    const doc: SourceDocument = {
      doc_id: meta.doc_id,
      title: meta.title,
      kind: meta.kind,
      lang: meta.lang,
      origin:
        `Corpus del reto — ${meta.ruta_original}` +
        (meta.fuente === "sidecar" ? " (texto por sidecar OCR; la cita apunta al PDF)" : ""),
      // El corpus no trae fecha de vigencia por documento. Se declara la del dataset
      // en vez de inventar una por documento: una fecha fabricada por documento seria
      // exactamente el tipo de dato que parece preciso y no lo es.
      effective_date: "2024-01-01",
      body: readFileSync(join(raiz, `${meta.doc_id}.txt`), "utf8"),
      chunking: { strategy: "parrafo", max_tokens: opciones.max_tokens ?? 350 },
    };

    try {
      almacen.ingest(doc, {
        actor,
        paginas: meta.paginas,
        ruta_original: meta.ruta_original,
        kind_source: meta.kind_por_defecto ? "defecto" : "contenido",
      });
      ingeridos++;
    } catch (e) {
      rechazados.push({ doc_id: meta.doc_id, motivo: (e as Error).message.split("\n")[0] ?? "" });
    }
  }

  return {
    ingeridos,
    rechazados,
    kind_por_defecto: manifiesto.docs.filter((d) => d.kind_por_defecto).length,
  };
}
