/**
 * El lexico destilado, traducido a `ContextFrame.lexicon` por unidad.
 *
 * Fuente: `docs/dominio/lexico-postop-v0.1.json`, derivado de 948 turnos reales de
 * `capa2_ruidosa`. No es vocabulario inventado: cada entrada lleva su conteo.
 *
 * ============ Las tres categorias no se mezclan ============
 *
 *   `synonyms`            expresion -> valor canonico. PRODUCE `normalized`.
 *   `requires_precision`  toca la unidad y NO la cuantifica. Deja `normalized: null`,
 *                         conserva el `raw` y dispara reflejo (ADR-004, ADR-024).
 *   `atenuadores`         NO son valores: modulan `confidence`. Van APARTE, y por eso
 *                         este modulo no los mete en ninguna unidad — quien los usa es
 *                         el motor de estados de la conversacional, sobre su propio
 *                         campo. Meterlos en el marco los convertiria en vocabulario
 *                         de extraccion, que es lo contrario de lo que son.
 *
 * ==========================================================
 *
 * ADR-019 + ADR-023: al prompt entra SOLO el lexico de la unidad en foco. Este modulo
 * entrega el marco completo —el marco es del decisor y lo transporta entero— y quien
 * arma el prompt toma de el la unidad que toca.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { UnitLexicon, UnitType } from "@techsphere/contracts";
import { RAIZ_REPO } from "../rutas.ts";

/** El lexico es del PROYECTO, no del paquete: vive junto al dominio del que se derivo. */
export const RUTA_LEXICO = join(RAIZ_REPO, "docs", "dominio", "lexico-postop-v0.1.json");

interface EntradaContada {
  expr: string;
  n: number;
}

interface UnidadDelLexico {
  tipo: UnitType;
  unidad?: string;
  synonyms?: Record<string, EntradaContada[]>;
  requiere_precision?: EntradaContada[];
  patrones_numericos?: string[];
}

export interface LexicoDestilado {
  lexicon_version: string;
  unidades: Record<string, UnidadDelLexico>;
  atenuadores: Record<string, EntradaContada[] | string>;
}

let cache: LexicoDestilado | null = null;

export function cargarLexico(ruta = RUTA_LEXICO): LexicoDestilado {
  if (cache && ruta === RUTA_LEXICO) return cache;
  const leido = JSON.parse(readFileSync(ruta, "utf8")) as LexicoDestilado;
  if (ruta === RUTA_LEXICO) cache = leido;
  return leido;
}

/**
 * Traduce la entrada del lexico a `UnitLexicon`.
 *
 * `values` son los canonicos DECLARADOS —las claves de `synonyms`—, no las
 * expresiones: el decisor declara COMO quiere recibir el dato, y lo que recibe es el
 * canonico. Para unidades numericas va vacio, que es lo que el contrato prevee.
 */
export function lexiconDeUnidad(unidad: UnidadDelLexico): UnitLexicon | undefined {
  // El lexico trae entradas que son SOLO anotacion —`{ "_nota": "sin evidencia en el
  // corpus" }`— sin expresion. Son documentacion del destilado, no vocabulario, y
  // colarlas produciria un `undefined` dentro del marco. Lo cazo el validador de
  // contratos al construir el primer marco, que es exactamente donde debia cazarlo.
  const expresiones = (entradas: readonly EntradaContada[] | undefined): string[] =>
    (entradas ?? []).map((e) => e.expr).filter((e): e is string => typeof e === "string" && e !== "");

  const synonyms: Record<string, string[]> = {};
  for (const [canonico, entradas] of Object.entries(unidad.synonyms ?? {})) {
    const exprs = expresiones(entradas);
    if (exprs.length > 0) synonyms[canonico] = exprs;
  }
  const requiere = expresiones(unidad.requiere_precision);

  const lexicon: UnitLexicon = { values: Object.keys(synonyms) };
  if (Object.keys(synonyms).length > 0) lexicon.synonyms = synonyms;
  if (requiere.length > 0) lexicon.requires_precision = requiere;
  if (unidad.unidad !== undefined) lexicon.unit = unidad.unidad;

  return lexicon;
}

/**
 * Los atenuadores, para quien module `confidence`. Se exponen APARTE y en plano
 * porque no pertenecen a ninguna unidad: el mismo "poquito" atenua un dolor y un
 * apetito, y duplicarlo por unidad invitaria a tratarlo como valor de esa unidad.
 */
export function atenuadores(lexico: LexicoDestilado = cargarLexico()): string[] {
  const salida: string[] = [];
  for (const valor of Object.values(lexico.atenuadores)) {
    if (Array.isArray(valor)) salida.push(...valor.map((e) => e.expr));
  }
  return [...new Set(salida)];
}
