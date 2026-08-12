/**
 * Costura DECISION <-> DETERMINISTA.
 *
 * Instancia `docs/Especificacion-Capa-Determinista.md` §6.2, §6.3 y §6.4.
 *
 * La regla que gobierna todo este archivo es ADR-007: el modulo determinista
 * NO pondera, entrega evidencia ponderable. Quien convierte esa evidencia en
 * voto es el decisor, con una tabla declarada y auditable regla a regla.
 */

import type { UnitResult } from "./conversational.ts";

// ---------------------------------------------------------------------------
// Entrada — spec determinista §6.2
// ---------------------------------------------------------------------------

/**
 * §7.3 — condicionan QUE reglas aplican y COMO se enuncia la lectura, sin alterar
 * el colapso. El catalogo concreto es del dominio cargado, no del contrato.
 * El tiempo post-operatorio es el de mayor impacto esperado: un mismo hallazgo
 * tiene lectura distinta a las 6 horas que a los 7 dias.
 */
export type DeterministicModifiers = Record<string, string | number | boolean | null>;

/**
 * §6.2 — lo que el decisor entrega al modulo, una sola vez por sesion, despues
 * de resolver `FrameVerdict.status = "sufficient"` y antes de construir la `Decision`.
 *
 * `units` son las MISMAS que el decisor recibio en `submitFrame`. No se re-tipan:
 * dos esquemas para el mismo objeto se desincronizan, por la misma razon que
 * `frame_delta` reutiliza `ContextFrame`.
 */
export interface DeterministicRequest {
  session_id: string;
  frame_id: string;
  units: UnitResult[];
  modifiers: DeterministicModifiers;
  /** Si no coincide con la taxonomia cargada, el modulo produce error explicito. */
  domain_version: string;
}

// ---------------------------------------------------------------------------
// Los tipos de hallazgo — spec determinista §6.4
// ---------------------------------------------------------------------------
//
// No son tres tipos arbitrarios: son los TRES EJES de ADR-006.
//   ClassHit       -> funcionalidad: lo que ocurre DENTRO de una unidad
//   CompositionHit -> interaccion:   lo que solo existe ENTRE unidades
//   StructureHit   -> integridad:    lo que se afirma DEL CASO COMPLETO
//
// Tres invariantes que estas formas imponen, y que estan probadas:
//   1. `rule_id` obligatorio en los tres — son la fuente unica de
//      `Decision.traces.rules_fired`. Un hallazgo sin `rule_id` no es reconstruible.
//   2. Ninguno lleva peso, score ni orden de gravedad. Un `ClassHit` con `severity`
//      reintroduciria por la puerta de atras justo lo que ADR-007 prohibe.
//   3. Todos llevan `origen_unit_ids`, CON ESE NOMBRE EXACTO en los tres
//      (correccion X-6, 7-ago). La distincion entre constituyente directo y origen
//      transitivo ya la carga el tipo — un ClassHit es por unidad por definicion,
//      un CompositionHit es entre unidades por definicion — y codificarla otra vez
//      en el nombre del campo obligaria a un mapa para probar la invariante.
// ---------------------------------------------------------------------------

/** Eje FUNCIONALIDAD — una clase presente, con las unidades que la produjeron. */
export interface ClassHit {
  /** Estable. Se transfiere a `Decision.traces.rules_fired`. */
  rule_id: string;
  /** Identificador de clase del dominio cargado. */
  clase: string;
  /** Que unidades colapsaron a esta clase. */
  origen_unit_ids: string[];
  /** Los `normalized` que mapearon. Misma union ancha que `UnitResult.normalized`. */
  origen_valores: Array<string | number | boolean>;
  /** `true` si llego por la clase de fallback y no por un mapeo declarado. */
  fallback: boolean;
}

/** Eje INTERACCION — una composicion declarada que se activo. */
export interface CompositionHit {
  rule_id: string;
  /** Lo que la regla exigia. */
  clases_requeridas: string[];
  /** Lo que la regla emite. */
  clase_producida: string;
  /** De donde salieron las clases requeridas. */
  origen_unit_ids: string[];
}

/** Eje INTEGRIDAD — una estructura del dominio con compromiso declarado. */
export interface StructureHit {
  rule_id: string;
  /** Nodo del arbol taxonomico del dominio. */
  estructura: string;
  /** Que clases sostienen la afirmacion. */
  clases_contribuyentes: string[];
  origen_unit_ids: string[];
}

/** Union de los tres ejes. Existe para que la invariante 3 se pruebe recorriendolos. */
export type DeterministicHit = ClassHit | CompositionHit | StructureHit;

/**
 * §6.4 — introspeccion del dominio cargado, para auditoria y para el README de metricas.
 *
 * `checksum` no es ceremonia: el dominio es dato cargado de archivo, y sin huella
 * el modulo no puede distinguir dos ejecuciones con la misma `domain_version` y
 * contenido distinto — que es exactamente el modo de fallo que romperia el
 * determinismo que este modulo promete.
 */
export interface DomainManifest {
  domain_version: string;
  domain_name: string;
  checksum: string;
  clases: number;
  composiciones: number;
  modificadores: string[];
  /** ADR-010 — obligatorio y legible fuera de contexto. */
  validez_clinica: "sin_validez_clinica_dominio_sintetico" | "validado_por_experto";
}

// ---------------------------------------------------------------------------
// El reporte — spec determinista §6.3
// ---------------------------------------------------------------------------

export type FuncionalidadLectura = "patron_unico" | "coexistencia" | "sin_hallazgo";
export type InteraccionLectura =
  | "patron_compartido"
  | "hallazgos_independientes"
  | "sin_hallazgo";
export type IntegridadLectura = "integra" | "comprometida" | "no_determinable";

/** Los tres ejes de ADR-006, tal como los nombra la cobertura de ADR-009. */
export type DeterministicAxis = "funcionalidad" | "interaccion" | "integridad";

/**
 * ADR-009 — la no evaluabilidad es RESULTADO, no vacio. Obligatoria en todo reporte:
 * que se pudo mirar y que no, con la causa heredada de `UnitResult.cause`.
 *
 * Es lo que sostiene el guardarrail "cobertura antes del silencio" de la spec de
 * decision §10: antes de emitir `escalate: false`, el decisor mira aqui.
 */
export interface DeterministicCoverage {
  /** Unit ids que entraron al calculo. */
  evaluadas: string[];
  no_evaluadas: Array<{
    unit_id: string;
    /** Heredada de `UnitResult.cause`, o `sin_normalizar` (§7.1). */
    causa: string;
    eje_afectado: DeterministicAxis[];
  }>;
  /** `evaluadas / total`. */
  ratio: number;
}

/** §6.3 — trazabilidad completa: toda afirmacion reconstruible hasta la entrada. */
export interface DeterministicTraceEntry {
  /** Estable. Se transfiere a `Decision.traces.rules_fired`. */
  rule_id: string;
  clase: string;
  origen_unit_ids: string[];
  /** Los `normalized` que dispararon la regla. */
  origen_valores: Array<string | number | boolean>;
}

/** §6.3 — salud del PROPIO MODULO, no del paciente. La distincion importa. */
export interface DeterministicQuality {
  /** Proporcion de valores caidos a la clase de fallback. */
  fallback_rate: number;
  /** Unidades `cubierta_condicionada` con dependencias abiertas. */
  unidades_condicionadas: string[];
  warnings: string[];
}

/**
 * §6.3 — la salida del modulo determinista.
 *
 * ================== ADR-007: campos deliberadamente AUSENTES ==================
 *
 * Este tipo NO admite `alert`, `score`, `risk`, `severity`, `recommendation` ni
 * `diagnosis`. Su ausencia es NORMATIVA, no un olvido: implementa ADR-006 y ADR-007.
 * El modulo entrega evidencia ponderable; quien la convierte en voto es el decisor,
 * con una tabla declarada. Agregar cualquiera de esos campos aqui devolveria la
 * autoridad clinica a un componente que por diseño no la tiene.
 *
 * La ausencia esta protegida por test, no por memoria: hay una prueba negativa a
 * nivel de tipo (rompe la compilacion) y otra en ejecucion (el validador rechaza
 * el objeto). Cualquier propuesta de añadirlos debe pasar por un ADR que revierta
 * ADR-006 y ADR-007 explicitamente.
 *
 * ==============================================================================
 *
 * `lectura` en cada eje es una etiqueta enumerada, no prosa: el modulo NO redacta.
 * La verbalizacion clinica es del decisor (`Decision.reason`) y la verbalizacion
 * al paciente es de la conversacional (`Decision.say_to_patient`).
 */
export interface DeterministicReport {
  domain_version: string;
  frame_id: string;

  funcionalidad: {
    clases: ClassHit[];
    /** `|clases|` — 1 = patron puro, >1 = coexistencia. */
    cardinalidad: number;
    lectura: FuncionalidadLectura;
  };

  interaccion: {
    /** Clases presentes en mas de una unidad. */
    convergentes: ClassHit[];
    composiciones: CompositionHit[];
    lectura: InteraccionLectura;
  };

  integridad: {
    comprometidas: StructureHit[];
    lectura: IntegridadLectura;
  };

  /** ADR-009 — obligatorio. */
  coverage: DeterministicCoverage;

  trace: DeterministicTraceEntry[];

  quality: DeterministicQuality;
}

/**
 * Los seis nombres que ADR-007 prohibe en el reporte y en los tipos de hallazgo.
 * Se exporta para que el validador y las pruebas negativas usen UNA sola lista:
 * dos listas se desincronizan y la prohibicion se vuelve decorativa.
 */
export const CAMPOS_PROHIBIDOS_ADR_007 = [
  "alert",
  "score",
  "risk",
  "severity",
  "recommendation",
  "diagnosis",
] as const;

export type CampoProhibidoADR007 = (typeof CAMPOS_PROHIBIDOS_ADR_007)[number];
