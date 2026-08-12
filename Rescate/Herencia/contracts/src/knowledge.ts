/**
 * El RAG: CONOCIMIENTO clinico. Instancia `docs/Especificacion-Capa-Decision.md` §8.
 *
 * ================== ADR-011: el RAG no contiene pacientes ==================
 *
 * Este archivo y `patient.ts` estan separados a proposito, y la separacion es la
 * decision, no una comodidad de organizacion:
 *
 *   |                | RAG (conocimiento)          | Base de pacientes (estado)   |
 *   |----------------|-----------------------------|------------------------------|
 *   | Contiene       | Corpus clinico              | Identidad, caso, medicacion  |
 *   | Naturaleza     | General, atemporal          | Contextual, de la sesion     |
 *   | Recuperacion   | Similitud semantica         | Acceso exacto por clave      |
 *   | El paciente    | NUNCA                       | Siempre                      |
 *
 * Por que importa: la recuperacion por similitud es el mecanismo equivocado para
 * datos de paciente — un caso "parecido" recuperado por el RAG no es el caso del
 * paciente al telefono, y mezclarlos habilita exactamente ese error. Ademas, el
 * requisito de conocimiento vivo implica subir y quitar documentos en caliente:
 * si el indice contuviera pacientes, cada operacion de consola seria una operacion
 * sobre datos personales.
 *
 * Consecuencia en el tipo: `SourceDocument` NO tiene campo de identidad de paciente
 * y `kind` NO admite tipos de paciente. Esta protegido por prueba negativa —un
 * documento con datos de paciente se rechaza POR ESQUEMA, no por convencion.
 *
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// Estandar de ingesta — spec de decision §8.2
// ---------------------------------------------------------------------------

/**
 * ADR-011, por esquema: NINGUNO de estos valores es un tipo de paciente.
 * Agregar `paciente`, `historia_clinica`, `caso` o similar aqui rompe la
 * separacion conocimiento/estado y debe pasar por un ADR que revierta ADR-011.
 */
export const DOCUMENT_KINDS = [
  "procedimiento",
  "cuidados",
  "complicaciones",
  "farmacologia",
  "protocolo",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface ChunkingSpec {
  strategy: "seccion" | "parrafo" | "fijo";
  max_tokens?: number;
}

/**
 * §8.2 — todo documento entra con metadatos obligatorios; sin ellos, la ingesta
 * se rechaza.
 *
 * `doc_id` estable es lo que hace auditable la traza: el `doc_ids` de una decision
 * de hace un mes debe resolver al documento que la sustento, aunque haya sido
 * retirado despues.
 *
 * `effective_date` es la vigencia del CONOCIMIENTO, no la fecha de carga. Un
 * protocolo de 2019 cargado hoy sigue siendo un protocolo de 2019.
 */
export interface SourceDocument {
  /** Estable; es el que viaja en `Decision.traces.doc_ids`. */
  doc_id: string;
  title: string;
  kind: DocumentKind;
  /** "es" — el corpus del reto es español e ingles. */
  lang: string;
  /** Fuente bibliografica o institucional. */
  origin: string;
  /** Vigencia del conocimiento, NO fecha de carga. */
  effective_date: string;
  /** Texto plano; la conversion desde PDF u otros formatos es previa a la consola. */
  body: string;
  /** Default por `kind` si se omite. */
  chunking?: ChunkingSpec;
}

/**
 * Nombres de campo que delatan identidad de paciente y que `SourceDocument`
 * rechaza por esquema (ADR-011). Salen de los campos reales del dataset del reto
 * mas los alias mas probables.
 *
 * Se exporta como lista unica para que el validador y la prueba negativa lean
 * de la misma fuente: dos listas se desincronizan y la prohibicion se vuelve
 * decorativa.
 */
export const CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011 = [
  "paciente_id",
  "patient_id",
  "patient_ref",
  "nombre_completo",
  "nombre",
  "documento_cc",
  "documento",
  "cedula",
  "direccion",
  "ciudad",
  "departamento",
  "eps",
  "fecha_cirugia",
  "fecha_nacimiento",
  "edad",
  "comorbilidades",
] as const;

export type CampoDePacienteProhibido =
  (typeof CAMPOS_DE_PACIENTE_PROHIBIDOS_ADR_011)[number];

/**
 * Valores de `kind` que se rechazan con mensaje propio por ser tipos de paciente.
 * Cualquier `kind` fuera de `DOCUMENT_KINDS` se rechaza igual; esta lista solo
 * existe para que el mensaje diga por que, en vez de limitarse a "valor invalido".
 */
export const KINDS_DE_PACIENTE_PROHIBIDOS_ADR_011 = [
  "paciente",
  "pacientes",
  "historia_clinica",
  "historia",
  "caso",
  "caso_clinico",
  "perfil_paciente",
  "expediente",
] as const;

// ---------------------------------------------------------------------------
// Recuperacion — spec de decision §8.3
// ---------------------------------------------------------------------------

/** Lo consume el VP (voto probabilistico). Solo lectura. */
export interface RetrievalQuery {
  text: string;
  k?: number;
  kind?: DocumentKind[];
}

export interface RetrievedChunk {
  doc_id: string;
  chunk_id: string;
  text: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Administracion de la consola — spec de decision §8.3
// ---------------------------------------------------------------------------

export interface IngestReceipt {
  doc_id: string;
  chunks: number;
  indexed: boolean;
}

export interface DocumentListEntry {
  doc_id: string;
  title: string;
  kind: string;
  status: "indexed" | "retired";
}

/**
 * ADR-015 — el indice es una proyeccion DERIVADA y reconstruible. Cambiar de
 * modelo de embeddings es re-proyectar el mismo corpus, no re-ingestar conocimiento.
 * Por eso `reindex` es operacion de primera clase y no contingencia.
 */
export interface ReindexReport {
  docs: number;
  chunks: number;
  duration_ms: number;
}

export interface KnowledgeStatus {
  docs: number;
  chunks: number;
  /** Con que modelo se construyo el indice vigente. Consultar con otro es error explicito. */
  embedding_model: string;
  last_change: string;
}
