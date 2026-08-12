/**
 * El almacen canonico de documentos fuente: la verdad de la que el indice es proyeccion.
 *
 * ============ ADR-015: el documento es la verdad, el indice es derivado ============
 *
 * De ahi las dos propiedades que este archivo sostiene y que no son obvias:
 *
 *   1. `retire` ARCHIVA, no borra. Es ADR-004 aplicado al conocimiento: la traza de
 *      una `Decision` de hace un mes tiene que resolver su `doc_id` aunque el
 *      documento ya no este vigente. Un `doc_ids` que no resuelve es peor que una
 *      traza vacia, porque parece auditable y no lo es.
 *   2. La historia NO se reescribe. Un `doc_id` vigente no se puede sobrescribir: una
 *      correccion es RETIRAR e ingerir version nueva. Asi la revision que sustento
 *      una decision sigue existiendo tal como era cuando la sustento.
 *
 * ==================================================================================
 *
 * Toda operacion queda registrada con quien, que y cuando. Una decision solo es
 * auditable si se sabe que conocimiento estaba vigente cuando se tomo — el registro
 * no es contabilidad, es parte de la trazabilidad.
 */

import type { ChunkingSpec, DocumentKind, DocumentListEntry, SourceDocument } from "@techsphere/contracts";
import { avisoDeDensidad, exigirDocumentoIngestable, type OpcionesDeIngesta } from "../esquema.ts";

/**
 * Chunking por defecto segun `kind`, si el documento no lo declara.
 *
 * ============ De donde sale el techo, y por que cambio ============
 *
 * H9 lo fijo en 150 tokens por LATENCIA: en la ruta local, dos chunks de 2000
 * caracteres eran 1474 tokens de prompt y 72 s de prefill. Ese techo ya no manda —
 * la ruta local se retiro (ADR-025) y la recuperacion es lexica, sin ventana de
 * modelo de embedding que trunque en silencio.
 *
 * Lo que SIGUE acotandolo es el techo de 12 000 tokens por minuto de la ruta
 * primaria: cada chunk recuperado viaja en el prompt del decisor. Con k=3 y 350
 * tokens son ~1050 tokens de evidencia por llamada, que cabe de sobra.
 *
 * Asi que el techo dejo de ser presupuesto de prefill y paso a ser presupuesto de
 * TPM, que es un orden de magnitud mas holgado. Conviene que quede escrito cual de
 * los dos manda hoy, porque el numero es el mismo tipo de numero y la razon no.
 *
 * ==================================================================================
 */
const TECHO_DE_CHUNK_TOKENS = 350;

const CHUNKING_POR_KIND: Readonly<Record<DocumentKind, ChunkingSpec>> = {
  // Un protocolo y un procedimiento vienen seccionados de origen: respetar la
  // seccion conserva el paso completo, que es la unidad que se cita.
  procedimiento: { strategy: "seccion", max_tokens: TECHO_DE_CHUNK_TOKENS },
  protocolo: { strategy: "seccion", max_tokens: TECHO_DE_CHUNK_TOKENS },
  farmacologia: { strategy: "seccion", max_tokens: TECHO_DE_CHUNK_TOKENS },
  // Los cuidados y las complicaciones son prosa continua dirigida al paciente.
  cuidados: { strategy: "parrafo", max_tokens: TECHO_DE_CHUNK_TOKENS },
  complicaciones: { strategy: "parrafo", max_tokens: TECHO_DE_CHUNK_TOKENS },
};

export type OperacionDeCorpus = "ingest" | "retire" | "reindex";

/** Quien, que y cuando. El registro es parte de la trazabilidad, no contabilidad. */
export interface EntradaDeRegistro {
  ts: string;
  operacion: OperacionDeCorpus;
  doc_id: string;
  actor: string;
  detalle: string;
}

/**
 * De donde salio el `kind` del documento.
 *
 * ============ ADR-024 en la clasificacion del corpus ============
 *
 * `SourceDocument.kind` es obligatorio y su enumerado no admite "no se sabe", asi
 * que un documento sin señal suficiente recibe igualmente un valor. Eso es fabricar
 * un dato para tapar un hueco, y tiene consecuencia funcional: `retrieve` filtra por
 * `kind`, de modo que un documento mal clasificado queda SILENCIOSAMENTE EXCLUIDO de
 * toda consulta filtrada.
 *
 * La ausencia se marca aqui, fuera del contrato, y el indice la usa para incluir a
 * los no clasificados en vez de excluirlos — mismo sesgo hacia aceptar que el umbral
 * de densidad. Sobre el corpus real son 24 de 107.
 *
 * ================================================================
 */
export type ProcedenciaDeKind = "contenido" | "defecto";

/** Una version del documento, congelada tal como entro. */
export interface RevisionArchivada {
  revision: number;
  doc: SourceDocument;
  /** `defecto` = el `kind` no se pudo determinar y se puso el mas neutro. */
  kind_source: ProcedenciaDeKind;
  ingested_at: string;
  ingested_by: string;
  retired_at: string | null;
}

export interface ReciboDeAlmacen {
  doc_id: string;
  revision: number;
  chunking: ChunkingSpec;
  /** No bloquean la ingesta; existen para que el operador los VEA. */
  avisos: string[];
}

export interface OpcionesDeAlmacenamiento extends OpcionesDeIngesta {
  actor: string;
  /** Inyectable para que el registro sea reproducible en prueba. */
  ahora?: Date;
  /** `defecto` cuando el clasificador no tuvo señal. Por omision se asume `contenido`. */
  kind_source?: ProcedenciaDeKind;
}

export class ErrorDeAlmacen extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeAlmacen";
  }
}

export class AlmacenDeFuentes {
  private readonly documentos = new Map<string, RevisionArchivada[]>();
  private readonly bitacora: EntradaDeRegistro[] = [];
  private revision = 0;

  /**
   * Sube con cada `ingest` y cada `retire`, y con nada mas.
   *
   * Es lo que hace la semantica de caliente casi gratis: el indice compara este
   * numero con el de su ultima proyeccion y se reconstruye solo si cambio. Sin el,
   * "subir un documento y que el agente lo use" exigiria que alguien se acordara de
   * invalidar el indice a mano — y el dia que se olvide, la compuerta 5 falla
   * delante del jurado sin que nada proteste.
   */
  revisionDelCorpus(): number {
    return this.revision;
  }

  /**
   * Ingesta con el estandar completo: contrato, ADR-011 y cuerpo aprovechable.
   *
   * Un documento sin capa de texto se RECHAZA NOMBRANDO LA RAZON. El que ingiere el
   * jurado en la compuerta 5 puede ser un escaneo, y ahi la consola habla: aceptarlo
   * en silencio dejaria al agente sin saber por que no tiene su contenido.
   */
  ingest(doc: SourceDocument, opciones: OpcionesDeAlmacenamiento): ReciboDeAlmacen {
    exigirDocumentoIngestable(doc, opciones);

    const historial = this.documentos.get(doc.doc_id) ?? [];
    const vigente = historial.find((r) => r.retired_at === null);
    if (vigente) {
      throw new ErrorDeAlmacen(
        `El doc_id ${JSON.stringify(doc.doc_id)} ya esta vigente en la revision ${vigente.revision}. ` +
          `La historia no se reescribe: una correccion es RETIRAR e ingerir version nueva, para que la ` +
          `revision que sustento una decision siga existiendo tal como era cuando la sustento (ADR-015).`,
      );
    }

    const ahora = (opciones.ahora ?? new Date()).toISOString();
    const chunking = doc.chunking ?? CHUNKING_POR_KIND[doc.kind];
    const guardado: SourceDocument = { ...doc, chunking };

    const revision = (historial.at(-1)?.revision ?? 0) + 1;
    historial.push({
      revision,
      doc: guardado,
      kind_source: opciones.kind_source ?? "contenido",
      ingested_at: ahora,
      ingested_by: opciones.actor,
      retired_at: null,
    });
    this.documentos.set(doc.doc_id, historial);
    this.revision++;

    const avisos: string[] = [];
    const densidad = avisoDeDensidad(guardado, opciones.paginas);
    if (densidad) avisos.push(densidad);

    this.anotar(ahora, "ingest", doc.doc_id, opciones.actor,
      `revision ${revision} · ${doc.kind} · ${chunking.strategy}` +
        (doc.chunking ? " (chunking declarado)" : " (chunking por defecto del kind)") +
        (avisos.length ? ` · AVISO: ${avisos.join(" ")}` : ""));

    return { doc_id: doc.doc_id, revision, chunking, avisos };
  }

  /** Sale de lo vigente YA; el documento fuente queda archivado para auditoria. */
  retire(doc_id: string, actor: string, ahora?: Date): void {
    const historial = this.documentos.get(doc_id);
    const vigente = historial?.find((r) => r.retired_at === null);
    if (!historial || !vigente) {
      throw new ErrorDeAlmacen(
        `No hay revision vigente de ${JSON.stringify(doc_id)} que retirar. ` +
          `Retirar dos veces no es idempotente aqui: si el documento ya salio, alguien esta operando ` +
          `sobre un estado que no es el que cree.`,
      );
    }
    const ts = (ahora ?? new Date()).toISOString();
    vigente.retired_at = ts;
    this.revision++;
    this.anotar(ts, "retire", doc_id, actor, `revision ${vigente.revision} retirada · el doc_id sigue resolviendo`);
  }

  /** Lo que el indice debe proyectar. Solo revisiones vigentes. */
  vigentes(): SourceDocument[] {
    return this.vigentesConProcedencia().map((v) => v.doc);
  }

  /**
   * Igual que `vigentes`, pero diciendo si el `kind` es de verdad o de relleno. Lo
   * consume el indice para no excluir de una consulta filtrada a un documento cuyo
   * `kind` nadie determino.
   */
  vigentesConProcedencia(): Array<{ doc: SourceDocument; kind_source: ProcedenciaDeKind }> {
    const salida: Array<{ doc: SourceDocument; kind_source: ProcedenciaDeKind }> = [];
    for (const historial of this.documentos.values()) {
      const vigente = historial.find((r) => r.retired_at === null);
      if (vigente) salida.push({ doc: vigente.doc, kind_source: vigente.kind_source });
    }
    return salida;
  }

  /** La revision vigente, o `null` si el documento esta retirado o no existe. */
  vigente(doc_id: string): SourceDocument | null {
    return this.documentos.get(doc_id)?.find((r) => r.retired_at === null)?.doc ?? null;
  }

  /**
   * Resuelve un `doc_id` AUNQUE ESTE RETIRADO. Es la operacion que hace auditable una
   * `Decision` vieja: sin ella, retirar un documento borraria la evidencia de todas
   * las decisiones que se apoyaron en el.
   *
   * Devuelve la ultima revision conocida; el historial completo esta en `historial()`.
   */
  resolver(doc_id: string): SourceDocument | null {
    return this.documentos.get(doc_id)?.at(-1)?.doc ?? null;
  }

  historial(doc_id: string): readonly RevisionArchivada[] {
    return this.documentos.get(doc_id) ?? [];
  }

  list(): DocumentListEntry[] {
    const salida: DocumentListEntry[] = [];
    for (const [doc_id, historial] of this.documentos) {
      const ultima = historial.at(-1)!;
      salida.push({
        doc_id,
        title: ultima.doc.title,
        kind: ultima.doc.kind,
        status: ultima.retired_at === null ? "indexed" : "retired",
      });
    }
    return salida.sort((a, b) => a.doc_id.localeCompare(b.doc_id));
  }

  /** La historia completa del corpus, en orden. */
  registro(): readonly EntradaDeRegistro[] {
    return this.bitacora;
  }

  /** WO-39 anota aqui su `reindex`: el registro del corpus es uno solo. */
  anotar(ts: string, operacion: OperacionDeCorpus, doc_id: string, actor: string, detalle: string): void {
    this.bitacora.push({ ts, operacion, doc_id, actor, detalle });
  }
}

export { CHUNKING_POR_KIND, TECHO_DE_CHUNK_TOKENS };
