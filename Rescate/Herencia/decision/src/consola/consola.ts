/**
 * La consola de conocimiento — COMPUERTA 5 del reto.
 *
 * ============ Que demuestra, exactamente ============
 *
 * Que el sistema APRENDE Y OLVIDA EN CALIENTE: se sube un documento, el agente lo
 * usa en la siguiente consulta, se retira, y deja de usarlo. Sin reiniciar nada.
 *
 * La consola es la SUPERFICIE del puerto, no un producto aparte: cinco operaciones y
 * ninguna mas. Todo lo que hace lo hace `KnowledgeConsolePort`; lo que aporta es que
 * un humano pueda ejercerlo y ver la consecuencia.
 *
 * ====================================================
 *
 * ============ La asimetria, dicha donde el operador la ve ============
 *
 * Esto actualiza el RAG EN CALIENTE. La taxonomia determinista NO: cambia solo por
 * version (ADR-010). Son dos garantias distintas y conviene no confundirlas — el
 * conocimiento se corrige subiendo un documento, y el criterio estructural se
 * corrige publicando un dominio nuevo, que es una operacion con otro peso.
 *
 * Va en la ayuda de la consola porque es ahi donde alguien podria esperar lo
 * contrario.
 *
 * ====================================================================
 */

import type {
  DocumentListEntry,
  IngestReceipt,
  KnowledgeConsolePort,
  KnowledgeStatus,
  ReindexReport,
  SourceDocument,
} from "@techsphere/contracts";
import { AlmacenDeFuentes, type EntradaDeRegistro } from "../conocimiento/almacen.ts";
import type { OpcionesDeIngesta } from "../esquema.ts";
import { IndiceLexico } from "../conocimiento/indice.ts";

export interface OpcionesDeConsola {
  /** Quien opera. El puerto no lo transporta, asi que vive aqui: el registro lo exige. */
  actor: string;
  almacen?: AlmacenDeFuentes;
  indice?: IndiceLexico;
}

export class ConsolaDeConocimiento implements KnowledgeConsolePort {
  readonly almacen: AlmacenDeFuentes;
  readonly indice: IndiceLexico;
  private readonly actor: string;

  constructor(opciones: OpcionesDeConsola) {
    this.actor = opciones.actor;
    this.almacen = opciones.almacen ?? new AlmacenDeFuentes();
    this.indice = opciones.indice ?? new IndiceLexico(this.almacen);
  }

  /**
   * El documento entra por el estandar completo. Si no tiene capa de texto, se
   * RECHAZA NOMBRANDO LA RAZON y la ruta de su sidecar: el que ingiere el jurado
   * puede ser un escaneo, y aceptarlo en silencio dejaria al agente sin saber por
   * que no tiene su contenido.
   */
  ingest(doc: SourceDocument, opciones: OpcionesDeIngesta = {}): IngestReceipt {
    this.almacen.ingest(doc, { ...opciones, actor: this.actor });
    // No hay paso de indexado que ejecutar: el indice se sincroniza solo. Se le
    // pregunta cuantos fragmentos quedaron —una sola fuente para ese hecho, en vez
    // de una contabilidad aparte que se desincronice— porque es lo que el operador
    // necesita ver para creerse que el documento entro.
    return { doc_id: doc.doc_id, chunks: this.indice.fragmentosDe(doc.doc_id), indexed: true };
  }

  /** Sale del indice YA; el documento fuente queda archivado para auditoria. */
  retire(doc_id: string): void {
    this.almacen.retire(doc_id, this.actor);
  }

  list(): DocumentListEntry[] {
    return this.almacen.list();
  }

  /** ADR-015 — reconstruccion total desde los fuentes, sin re-ingesta. */
  reindex(embedding_model: string): ReindexReport {
    const informe = this.indice.reindex(embedding_model);
    this.almacen.anotar(
      new Date().toISOString(),
      "reindex",
      "(corpus completo)",
      this.actor,
      `${informe.docs} documentos · ${informe.chunks} fragmentos · ${embedding_model}`,
    );
    return informe;
  }

  status(): KnowledgeStatus {
    return this.indice.status();
  }

  registro(): readonly EntradaDeRegistro[] {
    return this.almacen.registro();
  }
}

/**
 * La asimetria de ADR-010, en el texto de ayuda. No es una nota al pie: es la
 * diferencia entre dos garantias, dicha donde el operador podria esperar lo
 * contrario.
 */
export const AYUDA = `
consola de conocimiento — compuerta 5

  status                     documentos, fragmentos, estrategia vigente y ultimo cambio
  list                       documentos del corpus, vigentes y retirados
  ingest <archivo.json>      ingiere un SourceDocument y queda recuperable EN CALIENTE
  retire <doc_id>            sale del indice YA; el fuente queda archivado
  reindex <descriptor>       reconstruye el indice entero desde los fuentes
  buscar <texto> [k]         consulta el indice como lo hace el decisor
  registro                   quien, que y cuando de cada operacion
  demo                       el ciclo completo de la compuerta 5, paso a paso

DOS GARANTIAS DISTINTAS, y conviene no confundirlas:

  El CONOCIMIENTO se actualiza en caliente. Lo que se ingiere aqui se recupera en la
  siguiente consulta, sin reiniciar nada, y lo que se retira deja de recuperarse.

  La TAXONOMIA DETERMINISTA no. Cambia solo por version (ADR-010): el criterio
  estructural se corrige publicando un dominio nuevo, no subiendo un documento. Es
  una operacion con otro peso, y por eso no vive en esta consola.

Un documento sin capa de texto se RECHAZA nombrando la razon y la ruta de su
sidecar. No se ingiere vacio: un documento aceptado que no aporta nada es peor que
uno rechazado con su razon, porque despues alguien pregunta por su contenido y el
agente no sabe por que no lo tiene.
`.trim();
