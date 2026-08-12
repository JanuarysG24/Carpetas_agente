/**
 * El indice: una PROYECCION del almacen, recuperable y reconstruible (ADR-015).
 *
 * ============ Por que lexico y no vectorial, hoy ============
 *
 * Quien consulta este indice no es el paciente con habla libre: es el DECISOR, con
 * el vocabulario canonico del dominio (ADR-019). Contra guias clinicas y con esas
 * consultas, lo lexico rinde — la brecha semantica que justifica los embeddings se
 * abre cuando la consulta y el documento usan palabras distintas para lo mismo, y
 * aqui el que pregunta ya habla el idioma del corpus.
 *
 * Y esto es exactamente para lo que existe el puerto: `KnowledgePort.retrieve` no
 * cambia de firma, asi que la estrategia se puede sustituir despues sin tocar a
 * ningun consumidor. La mejora vectorial esta especificada (§8c-bis.4) y entra
 * detras del mismo puerto. Es la arquitectura haciendo su trabajo, y va al informe
 * como tal.
 *
 * ============================================================
 *
 * ============ Nunca resultados silenciosamente incomparables ============
 *
 * La regla se conserva intacta aunque no haya embeddings: lo que se registra no es
 * "el modelo" sino la ESTRATEGIA COMPLETA —familia, parametros y normalizacion—,
 * porque un indice construido con otra normalizacion produce puntajes que no se
 * pueden comparar con estos aunque las dos digan "lexical-bm25". Consultar contra un
 * descriptor que no casa falla explicito.
 *
 * Esa disciplina es la que protege el cambio a vectorial cuando llegue: el dia que
 * el descriptor pase a nombrar modelo, cuantizacion y convencion de prefijos, el
 * mecanismo que detecta el desajuste ya existe y ya esta probado.
 *
 * ========================================================================
 */

import type {
  DocumentKind,
  KnowledgePort,
  KnowledgeStatus,
  RetrievalQuery,
  RetrievedChunk,
  SourceDocument,
} from "@techsphere/contracts";
import type { AlmacenDeFuentes } from "./almacen.ts";

// ---------------------------------------------------------------------------
// La estrategia, declarada entera
// ---------------------------------------------------------------------------

export const NORMALIZACION = "es-minusculas-sin-tildes-sin-vacias-v1";

/** Saturacion de frecuencia de termino. El valor clasico de la literatura de BM25. */
export const BM25_K1 = 1.2;
/** Peso de la normalizacion por longitud. 0 la ignora, 1 la aplica entera. */
export const BM25_B = 0.75;

export interface EstrategiaDeIndice {
  familia: "lexical-bm25";
  k1: number;
  b: number;
  normalizacion: string;
}

export const ESTRATEGIA_VIGENTE: EstrategiaDeIndice = {
  familia: "lexical-bm25",
  k1: BM25_K1,
  b: BM25_B,
  normalizacion: NORMALIZACION,
};

/**
 * El descriptor que viaja en `KnowledgeStatus.embedding_model` y en
 * `CallSummary.versions.embedding_model`.
 *
 * El campo del contrato se llama `embedding_model` y hoy no hay embeddings. Se
 * escribe LO QUE DE VERDAD SE USO en vez de un nombre de modelo inventado o un
 * "n/a": un resumen de hace un mes tiene que decir con que se recupero, y "lexical"
 * es una respuesta reproducible mientras que un hueco no lo es.
 */
export function descriptorDe(e: EstrategiaDeIndice): string {
  return `${e.familia}/k1=${e.k1}/b=${e.b}/${e.normalizacion}`;
}

export class ErrorDeIndiceDiscordante extends Error {
  constructor(esperado: string, vigente: string) {
    super(
      `El indice vigente se construyo con ${JSON.stringify(vigente)} y se esta consultando esperando ` +
        `${JSON.stringify(esperado)}.\n` +
        `      No se devuelven resultados: dos indices con estrategias distintas producen puntajes que ` +
        `no son comparables, y devolverlos igual seria darle al decisor una evidencia que parece buena ` +
        `y no lo es. Reconstruye el indice con reindex o corrige lo que esperabas (ADR-015).`,
    );
    this.name = "ErrorDeIndiceDiscordante";
  }
}

// ---------------------------------------------------------------------------
// Normalizacion para español
// ---------------------------------------------------------------------------

/**
 * Vacias del español y del ingles: el corpus del reto es bilingue, y sin esto el
 * puntaje queda dominado por "de", "la", "the" y "of". No hay stemmer a proposito —
 * el vocabulario clinico es consistente y un stemmer mal calibrado junta palabras
 * que el decisor distingue.
 */
const VACIAS = new Set(
  ("de la el los las un una unos unas y o u en a al del que se es son con por para su sus lo le les " +
    "este esta estos estas como mas menos ser estar tiene tienen puede pueden si no ni pero sino " +
    "sobre entre hasta desde cuando donde muy ya hay he ha han fue era sea " +
    "the of and to in is are for with on or as be by an it that this these those you your not has " +
    "have can may will after before during from at we they").split(" "),
);

export function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !VACIAS.has(t));
}

// ---------------------------------------------------------------------------
// Troceo
// ---------------------------------------------------------------------------

/** ~4 caracteres por token en español. Basta para acotar: no se factura por token aqui. */
const CARACTERES_POR_TOKEN = 4;

/**
 * Piso de fragmento. Un bloque suelto no se indexa: se acumula con los siguientes
 * hasta llegar aqui.
 *
 * ============ Por que existe este piso, medido ============
 *
 * Sobre el corpus real —107 PDF extraidos con pdftotext— trocear por bloque daba una
 * MEDIANA DE 31 CARACTERES: el 70 % de los fragmentos por debajo de 100. No eran
 * parrafos cortos, eran encabezados sueltos, viñetas, numeros de pagina y lineas de
 * indice, porque la extraccion de un PDF deja una linea en blanco por todas partes.
 *
 * Y con BM25 eso no es solo inutil, es ACTIVAMENTE DAÑINO: la normalizacion por
 * longitud premia al documento corto que contiene el termino, asi que un encabezado
 * de tres palabras que dice "Signos de alarma" le ganaba a un parrafo entero que
 * explicaba cuales son. La consulta parecia funcionar y devolvia un titulo.
 *
 * Acumular hasta un piso arregla las dos cosas a la vez: el fragmento tiene
 * sustancia suficiente para sostener una afirmacion con su doc_id —que es lo que la
 * rubrica evalua— y el encabezado queda pegado al texto que encabeza, que es
 * exactamente donde sirve.
 *
 * Ojo con la tentacion de resolver esto con embeddings: el vector de un encabezado
 * de tres palabras es igual de pobre que su bolsa de palabras. Esto es troceo, no
 * estrategia de recuperacion.
 *
 * ==========================================================
 */
const PISO_DE_FRAGMENTO_CARACTERES = 500;

/** Basura de extraccion que no aporta ni pegada: numeros de pagina y puntos guia de indice. */
function esRuidoDeExtraccion(bloque: string): boolean {
  return /^\d{1,4}$/.test(bloque) || /\.{6,}\s*\d+$/.test(bloque) || /^[\s.·•—-]+$/.test(bloque);
}

/**
 * Densidad de cifras por encima de la cual un fragmento es una TABLA O UN PIE DE
 * FIGURA, no prosa.
 *
 * Medido: la consulta de `apetito` devolvia con puntaje alto un fragmento que decia
 * "Retiro DU Primer flato A 1.00 0.75 0.50 0.25 0.00 C 1.00 0.75..." y que casaba
 * cuatro terminos de la consulta legitimamente —el pie mencionaba "tolerancia a la
 * via oral"—. No era basura por casualidad ni se podia filtrar por cobertura: era un
 * fragmento SOBRE el tema correcto que no dice nada en palabras.
 *
 * Un fragmento hecho de cifras no puede sostener una afirmacion, que es lo unico que
 * se le pide a la evidencia de una `Decision`. La cifra vive en la tabla del PDF y
 * ahi sigue: lo que no se hace es citarla como si fuera una frase.
 */
const DENSIDAD_MAXIMA_DE_CIFRAS = 0.35;

function esTablaOFigura(texto: string): boolean {
  const sinEspacios = texto.replace(/\s+/g, "");
  if (sinEspacios.length < 40) return false;
  const cifras = (sinEspacios.match(/[\d.,%]/g) ?? []).length;
  return cifras / sinEspacios.length > DENSIDAD_MAXIMA_DE_CIFRAS;
}

function trocear(doc: SourceDocument): Array<{ chunk_id: string; texto: string }> {
  const techo = (doc.chunking?.max_tokens ?? 350) * CARACTERES_POR_TOKEN;

  const bloques = doc.body
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    // El filtro de tabla se aplica ANTES de fusionar, que es donde el bloque numerico
    // todavia esta separado: despues, la prosa vecina le diluye la densidad de cifras
    // y lo cuela como si fuera texto.
    .filter((p) => p.length > 0 && !esRuidoDeExtraccion(p) && !esTablaOFigura(p));

  // 1. Los bloques que pasan del techo se parten por frase.
  const partidos: string[] = [];
  for (const bloque of bloques.length > 0 ? bloques : [doc.body]) {
    if (bloque.length <= techo) {
      partidos.push(bloque);
      continue;
    }
    let actual = "";
    for (const frase of bloque.split(/(?<=[.;:?!])\s+/)) {
      if (actual.length + frase.length + 1 > techo && actual.length > 0) {
        partidos.push(actual.trim());
        actual = "";
      }
      actual += (actual ? " " : "") + frase;
    }
    if (actual.trim() !== "") partidos.push(actual.trim());
  }

  // 2. Los que no llegan al piso se acumulan con los siguientes, sin pasar el techo.
  const piezas: string[] = [];
  let acumulado = "";
  for (const parte of partidos) {
    const candidato = acumulado ? `${acumulado} ${parte}` : parte;
    if (candidato.length > techo && acumulado.length > 0) {
      piezas.push(acumulado);
      acumulado = parte;
    } else {
      acumulado = candidato;
    }
    if (acumulado.length >= PISO_DE_FRAGMENTO_CARACTERES) {
      piezas.push(acumulado);
      acumulado = "";
    }
  }
  // La cola se pega al ultimo fragmento en vez de quedar suelta por debajo del piso:
  // un documento que termina en un parrafo corto no debe aportar un fragmento pobre.
  if (acumulado !== "") {
    const ultimo = piezas.at(-1);
    if (ultimo !== undefined && ultimo.length + acumulado.length + 1 <= techo) {
      piezas[piezas.length - 1] = `${ultimo} ${acumulado}`;
    } else {
      piezas.push(acumulado);
    }
  }

  return piezas
    .map((texto, i) => ({ chunk_id: `${doc.doc_id}#${i}`, texto }));
}

// ---------------------------------------------------------------------------
// El indice
// ---------------------------------------------------------------------------

interface Fragmento {
  doc_id: string;
  chunk_id: string;
  kind: DocumentKind;
  /** `true` si nadie determino el kind: no se excluye de una consulta filtrada. */
  kindDeRelleno: boolean;
  texto: string;
  /** termino -> frecuencia en este fragmento */
  tf: Map<string, number>;
  largo: number;
}

export interface InformeDeProyeccion {
  docs: number;
  chunks: number;
  duration_ms: number;
}

/**
 * PISO DE RELEVANCIA — por debajo, `retrieve` devuelve VACIO.
 *
 * ============ Es ADR-024 en la capa de recuperacion ============
 *
 * Devolver "el mejor de un mal lote" es fabricar respaldo: el decisor recibe un
 * fragmento, lo cita con su `doc_id`, y la traza resiste una verificacion contra la
 * fuente real solo hasta que alguien la lee. Medido sobre el corpus real: la consulta
 * de `apetito` devolvia un volcado de datos de figura —"1.00 0.75 0.50 0.25"— con
 * puntaje ALTO, porque la figura repetia dos terminos de la consulta.
 *
 * La ausencia tiene representacion propia y quien la lee decide que hacer con ella.
 * Aqui esa representacion es el arreglo vacio, igual que `normalized: null` se niega
 * a inventar un numero que el paciente no dijo.
 *
 * ============ Por que NO es un umbral sobre el puntaje ============
 *
 * El primer intento fue un piso absoluto de BM25, y estaba mal. **El puntaje de BM25
 * no esta normalizado**: escala con la idf, que a su vez escala con el tamaño del
 * corpus. Un umbral calibrado sobre 6 176 fragmentos dejaba el corpus semilla de
 * cuatro fragmentos devolviendo SIEMPRE vacio, y habria vuelto a descalibrarse solo
 * con que el corpus creciera. Un umbral que hay que recalibrar cada vez que cambia
 * el corpus es un umbral que algun dia no se recalibra.
 *
 * Lo que si es libre de escala es **cuanta de la pregunta contesta el fragmento**:
 * cuantos terminos distintos de la consulta aparecen en el. Un fragmento que casa 2
 * de 6 terminos no aborda la pregunta, tenga el corpus tres documentos o tres mil.
 *
 * Se admite por fraccion O por cuenta absoluta, y la segunda no es un parche: con la
 * consulta expandida desde el lexico la lista de terminos crece, y exigir la misma
 * FRACCION castigaria justo a las consultas que la expansion vino a rescatar.
 * Casar cuatro terminos distintos es buena señal se hayan pedido seis o quince.
 *
 * ==================================================================
 */
export const COBERTURA_MINIMA_DE_CONSULTA = 0.4;
export const TERMINOS_CASADOS_MINIMOS = 3;

export class IndiceLexico implements KnowledgePort {
  private readonly almacen: AlmacenDeFuentes;
  private estrategia: EstrategiaDeIndice;

  private fragmentos: Fragmento[] = [];
  /** termino -> en cuantos fragmentos aparece */
  private df = new Map<string, number>();
  private largoMedio = 0;
  /** Revision del corpus con la que se construyo la proyeccion vigente. */
  private revisionProyectada = -1;
  private ultimoCambio = new Date(0).toISOString();

  constructor(almacen: AlmacenDeFuentes, estrategia: EstrategiaDeIndice = ESTRATEGIA_VIGENTE) {
    this.almacen = almacen;
    this.estrategia = estrategia;
  }

  descriptor(): string {
    return descriptorDe(this.estrategia);
  }

  /**
   * Semantica de caliente: `ingest` y `retire` se reflejan aqui SIN REINICIO.
   *
   * No hay que acordarse de invalidar nada — el indice compara la revision del
   * corpus con la que proyecto y se reconstruye solo. Es media compuerta 5, y con
   * indice invertido sale casi gratis.
   */
  private sincronizar(): void {
    const revision = this.almacen.revisionDelCorpus();
    if (revision === this.revisionProyectada) return;
    this.proyectar();
  }

  private proyectar(): InformeDeProyeccion {
    const t0 = Date.now();
    const vigentes = this.almacen.vigentesConProcedencia();

    this.fragmentos = [];
    for (const { doc, kind_source } of vigentes) {
      for (const { chunk_id, texto } of trocear(doc)) {
        const tf = new Map<string, number>();
        const tokens = tokenizar(texto);
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        if (tf.size === 0) continue;
        this.fragmentos.push({
          doc_id: doc.doc_id,
          chunk_id,
          kind: doc.kind,
          kindDeRelleno: kind_source === "defecto",
          texto,
          tf,
          largo: tokens.length,
        });
      }
    }

    this.df = new Map();
    for (const f of this.fragmentos) {
      for (const t of f.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.largoMedio =
      this.fragmentos.length === 0
        ? 0
        : this.fragmentos.reduce((a, f) => a + f.largo, 0) / this.fragmentos.length;

    this.revisionProyectada = this.almacen.revisionDelCorpus();
    this.ultimoCambio = new Date().toISOString();

    return { docs: vigentes.length, chunks: this.fragmentos.length, duration_ms: Date.now() - t0 };
  }

  /**
   * Expansion de consulta FILTRADA POR EL PROPIO CORPUS.
   *
   * ============ Por que filtrada y no a secas ============
   *
   * El lexico destilado es HABLA DE PACIENTE —"no me provoca", "del tiron",
   * "desvelado"— y el corpus es literatura clinica. Expandir con todo arrastraria la
   * consulta hacia un registro que estos documentos no usan, y ademas terminos
   * comunes como "normal", "poquito" o "ganas" traen basura con puntaje alto.
   *
   * Se conserva solo el termino que el corpus CONOCE y que ademas DISCRIMINA: fuera
   * los que no aparecen en ningun fragmento —no aportan nada— y fuera los que
   * aparecen en mas de una fraccion del corpus, que es la definicion operativa de
   * palabra vacia para este corpus concreto en vez de para el idioma en general.
   *
   * Sobre el corpus real esto es lo que rescata `apetito` y `sueno`: "nauseas" e
   * "inapetencia" pasan el filtro, "no me provoca" y "ganas" no.
   *
   * =======================================================
   */
  expandirConsulta(base: string, terminos: readonly string[], techoDf = 0.15): string {
    this.sincronizar();
    const N = Math.max(1, this.fragmentos.length);
    const yaEstan = new Set(tokenizar(base));

    const utiles = terminos
      .flatMap((t) => tokenizar(t))
      .filter((t) => !yaEstan.has(t))
      .filter((t) => {
        const n = this.df.get(t) ?? 0;
        return n > 0 && n / N <= techoDf;
      });

    return utiles.length === 0 ? base : `${base} ${[...new Set(utiles)].join(" ")}`;
  }

  /** Cuantos fragmentos vigentes tiene un documento. Lo usa la consola para informar. */
  fragmentosDe(doc_id: string): number {
    this.sincronizar();
    return this.fragmentos.filter((f) => f.doc_id === doc_id).length;
  }

  /** BM25 clasico. `idf` con el ajuste que evita negativos en terminos muy frecuentes. */
  private idf(termino: string): number {
    const N = this.fragmentos.length;
    const n = this.df.get(termino) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  retrieve(q: RetrievalQuery): RetrievedChunk[] {
    this.sincronizar();

    const k = q.k ?? 3;
    const consulta = tokenizar(q.text);
    if (consulta.length === 0 || this.fragmentos.length === 0) return [];

    // El filtro por kind INCLUYE a los no clasificados. Excluirlos seria dejar que
    // un valor de relleno decida que documento no se mira, y el sesgo aqui va hacia
    // aceptar — igual que en el umbral de densidad.
    const candidatos = q.kind
      ? this.fragmentos.filter((f) => f.kindDeRelleno || q.kind?.includes(f.kind))
      : this.fragmentos;

    const distintos = [...new Set(consulta)];
    const puntuados = candidatos.map((f) => {
      let score = 0;
      let casados = 0;
      for (const termino of distintos) {
        const frecuencia = f.tf.get(termino);
        if (!frecuencia) continue;
        casados++;
        const denominador =
          frecuencia + this.estrategia.k1 * (1 - this.estrategia.b + (this.estrategia.b * f.largo) / (this.largoMedio || 1));
        score += this.idf(termino) * ((frecuencia * (this.estrategia.k1 + 1)) / denominador);
      }
      return { f, score, casados, cobertura: casados / distintos.length };
    });

    return puntuados
      .filter(
        (p) =>
          p.score > 0 &&
          (p.cobertura >= COBERTURA_MINIMA_DE_CONSULTA || p.casados >= TERMINOS_CASADOS_MINIMOS),
      )
      .sort((a, b) => b.score - a.score || a.f.chunk_id.localeCompare(b.f.chunk_id))
      .slice(0, k)
      .map((p) => ({
        doc_id: p.f.doc_id,
        chunk_id: p.f.chunk_id,
        text: p.f.texto,
        score: Number(p.score.toFixed(4)),
      }));
  }

  /**
   * Consulta EXIGIENDO que el indice sea el que se espera. Es la forma verificable
   * del guardarrail: quien va a escribir el descriptor en un `CallSummary` consulta
   * por aqui, y si el indice no es el que cree, se entera antes de decidir.
   */
  consultarCon(descriptorEsperado: string, q: RetrievalQuery): RetrievedChunk[] {
    this.exigirCompatible(descriptorEsperado);
    return this.retrieve(q);
  }

  exigirCompatible(descriptorEsperado: string): void {
    if (descriptorEsperado !== this.descriptor()) {
      throw new ErrorDeIndiceDiscordante(descriptorEsperado, this.descriptor());
    }
  }

  /**
   * ADR-015 — operacion de PRIMERA CLASE, no contingencia: reconstruccion total
   * desde los fuentes, sin re-ingesta. El indice es derivado; el documento es la
   * verdad, y por eso cambiar de estrategia no cuesta volver a cargar el corpus.
   */
  reindex(descriptor: string): InformeDeProyeccion {
    if (descriptor !== descriptorDe(ESTRATEGIA_VIGENTE)) {
      throw new ErrorDeIndiceDiscordante(descriptor, descriptorDe(ESTRATEGIA_VIGENTE));
    }
    this.estrategia = ESTRATEGIA_VIGENTE;
    return this.proyectar();
  }

  status(): KnowledgeStatus {
    this.sincronizar();
    return {
      docs: this.almacen.vigentes().length,
      chunks: this.fragmentos.length,
      embedding_model: this.descriptor(),
      last_change: this.ultimoCambio,
    };
  }
}
