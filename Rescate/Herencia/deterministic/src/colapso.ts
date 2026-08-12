/**
 * WO-28 — COLAPSO CLASIFICATORIO. El nucleo del modulo.
 *
 *   colapso(S) = { clase(v) : v ∈ S }
 *
 * Un conjunto, no una lista: la deduplicacion es parte de la operacion y no un
 * detalle de implementacion (Motor A §4.1). Se pierde a proposito la identidad
 * individual del valor y se gana comparabilidad — dos unidades que no se parecen
 * en nada pasan a hablar el mismo vocabulario de clases, y solo por eso pueden
 * relacionarse entre si. El colapso es la condicion de posibilidad de la
 * convergencia de clase.
 *
 * ================== Cierre total: aqui NO se lanza nunca ==================
 *
 * Todo valor sin mapeo declarado cae a la clase de fallback (Motor A §4.3). Ni
 * excepcion ni hueco: un valor imprevisto del paciente no puede tumbar una
 * evaluacion. El fallback ademas tiene valor diagnostico SOBRE EL PROPIO MODULO —
 * un `fallback_rate` alto en uso real dice que la taxonomia no cubre lo que la
 * gente reporta, y es la metrica natural de mantenimiento del dominio (spec §9).
 *
 * =========================================================================
 *
 * Una entrada por REGLA activada, no por clase. La cardinalidad sigue contando
 * clases distintas —es el conjunto colapsado— pero dos unidades que llegan a la
 * misma clase por cortes distintos son dos hallazgos con dos `rule_id`, y
 * fundirlos obligaria a elegir cual de los dos identificadores citar. La
 * trazabilidad termino a termino es la razon de existir de esta capa.
 */

import type { ClassHit } from "@techsphere/contracts";
import type { Corte, Dominio, Operador } from "./dominio.ts";
import type { UnidadElegible } from "./elegibilidad.ts";

export interface ContextoDeModificadores {
  /** id del modificador -> tramo vigente, `null` si el valor no cae en ningun tramo. */
  tramoVigente: Map<string, string | null>;
  warnings: string[];
}

export interface Colapso {
  /** Un `ClassHit` por regla activada, ordenado por `rule_id`. */
  hits: ClassHit[];
  /** unidad -> clases presentes en ella. Es la matriz de incidencia de Motor A §5.1. */
  clasesPorUnidad: Map<string, Set<string>>;
  /** unidad -> valor normalizado que entro al calculo. Para las trazas. */
  valorPorUnidad: Map<string, string | number | boolean>;
  /** Cuantos valores elegibles cayeron al fallback. Alimenta `quality.fallback_rate`. */
  fallbacks: number;
  warnings: string[];
}

/**
 * Los modificadores transversales condicionan QUE reglas aplican y COMO se enuncia
 * la lectura, sin alterar el colapso (Motor A §2.1). El dominio C1 no declara
 * ninguna regla condicionada —la lectura temporal del post-operatorio vive en la
 * tabla del decisor, no aqui— pero el mecanismo esta y esta probado: sin el, el
 * primer dominio que lo necesite obligaria a tocar el motor.
 */
export function resolverModificadores(
  modifiers: Record<string, string | number | boolean | null>,
  dominio: Dominio,
): ContextoDeModificadores {
  const tramoVigente = new Map<string, string | null>();
  const warnings: string[] = [];

  for (const id of [...dominio.modificadores.keys()].sort()) {
    const declarado = dominio.modificadores.get(id)!;
    const recibido = modifiers[id];
    if (recibido === undefined || recibido === null) {
      tramoVigente.set(id, null);
      warnings.push(`modificador ${id} no recibido; ninguna regla condicionada por el aplica.`);
      continue;
    }
    if (typeof recibido === "boolean" || !declarado.valores.includes(recibido)) {
      tramoVigente.set(id, null);
      warnings.push(
        `modificador ${id} llego con el valor ${JSON.stringify(recibido)}, que no esta entre los declarados (${declarado.valores.join(", ")}).`,
      );
      continue;
    }
    const tramo = declarado.tramos.find((t) => t.valores.includes(recibido));
    tramoVigente.set(id, tramo?.id ?? null);
  }

  for (const id of Object.keys(modifiers).sort()) {
    if (!dominio.modificadores.has(id)) {
      warnings.push(`modificador ${id} no esta declarado en el dominio ${dominio.version}; se ignora.`);
    }
  }

  return { tramoVigente, warnings };
}

export function colapsar(
  elegibles: readonly UnidadElegible[],
  dominio: Dominio,
  ctx: ContextoDeModificadores,
): Colapso {
  const clasesPorUnidad = new Map<string, Set<string>>();
  const valorPorUnidad = new Map<string, string | number | boolean>();
  const warnings: string[] = [];
  let fallbacks = 0;

  /** rule_id -> hallazgo en construccion. Agrupar por regla es lo que dedupe. */
  const porRegla = new Map<string, { clase: string; unidades: Set<string>; valores: Array<string | number | boolean>; fallback: boolean }>();

  const anotar = (
    rule_id: string,
    clase: string,
    unidad: string,
    valor: string | number | boolean,
    fallback: boolean,
  ): void => {
    let h = porRegla.get(rule_id);
    if (!h) {
      h = { clase, unidades: new Set(), valores: [], fallback };
      porRegla.set(rule_id, h);
    }
    h.unidades.add(unidad);
    if (!h.valores.some((v) => v === valor)) h.valores.push(valor);
    let clases = clasesPorUnidad.get(unidad);
    if (!clases) {
      clases = new Set();
      clasesPorUnidad.set(unidad, clases);
    }
    clases.add(clase);
  };

  for (const u of elegibles) {
    valorPorUnidad.set(u.id, u.valor);
    const fn = dominio.funcionDeClase.get(u.id);

    if (!fn) {
      fallbacks += 1;
      warnings.push(`la unidad ${u.id} no existe en el dominio ${dominio.version}: su valor cae al fallback.`);
      anotar(reglaDeFallback(dominio), dominio.claseFallback, u.id, u.valor, true);
      continue;
    }

    const resultado =
      fn.tipo === "quantity" || fn.tipo === "scale"
        ? clasePorCorte(fn.cortes, u.valor, ctx)
        : clasePorMapa(fn.mapa, u.valor, ctx);

    if (!resultado) {
      fallbacks += 1;
      warnings.push(
        `${u.id}: el valor ${JSON.stringify(u.valor)} no tiene mapeo declarado en el dominio ${dominio.version}.`,
      );
      anotar(reglaDeFallback(dominio), dominio.claseFallback, u.id, u.valor, true);
      continue;
    }

    anotar(resultado.rule_id, resultado.clase, u.id, u.valor, false);
  }

  const hits: ClassHit[] = [...porRegla.entries()]
    .map(([rule_id, h]) => ({
      rule_id,
      clase: h.clase,
      origen_unit_ids: [...h.unidades].sort(),
      origen_valores: [...h.valores].sort(compararValores),
      fallback: h.fallback,
    }))
    .filter((h) => esHallazgo(h.clase, dominio))
    .sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));

  return { hits, clasesPorUnidad, valorPorUnidad, fallbacks, warnings };
}

/**
 * Una clase SIN eje no afirma nada sobre ningun eje de ADR-006 y por tanto no es
 * hallazgo: es como el dominio dice "esto esta dentro de lo esperado" sin que el
 * motor tenga que conocer ningun identificador clinico. La excepcion es la clase de
 * fallback, que tampoco tiene eje pero si se reporta — no afirma nada del paciente,
 * afirma que la taxonomia no cubrio el valor, y callarlo esconderia el unico dato
 * que permite mantener el dominio.
 */
export function esHallazgo(clase: string, dominio: Dominio): boolean {
  const declarada = dominio.clases.get(clase);
  if (!declarada) return true;
  return declarada.eje !== null || declarada.es_fallback;
}

export function reglaDeFallback(dominio: Dominio): string {
  return `FB-${dominio.claseFallback}`;
}

function clasePorCorte(
  cortes: readonly Corte[],
  valor: string | number | boolean,
  ctx: ContextoDeModificadores,
): { clase: string; rule_id: string } | null {
  // Sin coercion: un "38" en texto NO se convierte en 38. Coaccionar aqui seria
  // interpretar, y este modulo no interpreta — el valor cae al fallback y el
  // `fallback_rate` deja ver que la extraccion esta entregando magnitudes en texto.
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  for (const c of cortes) {
    if (!aplicaConModificador(c.modificador, ctx)) continue;
    if (compara(valor, c.operador, c.valor)) return { clase: c.clase, rule_id: c.rule_id };
  }
  return null;
}

function clasePorMapa(
  mapa: readonly { valor: string; clase: string; rule_id: string; modificador?: { id: string; tramo: string } }[],
  valor: string | number | boolean,
  ctx: ContextoDeModificadores,
): { clase: string; rule_id: string } | null {
  const clave = typeof valor === "string" ? valor : String(valor);
  for (const m of mapa) {
    if (m.valor !== clave) continue;
    if (!aplicaConModificador(m.modificador, ctx)) continue;
    return { clase: m.clase, rule_id: m.rule_id };
  }
  return null;
}

function aplicaConModificador(
  mod: { id: string; tramo: string } | undefined,
  ctx: ContextoDeModificadores,
): boolean {
  if (!mod) return true;
  return ctx.tramoVigente.get(mod.id) === mod.tramo;
}

function compara(valor: number, operador: Operador, corte: number): boolean {
  switch (operador) {
    case ">=":
      return valor >= corte;
    case ">":
      return valor > corte;
    case "<=":
      return valor <= corte;
    case "<":
      return valor < corte;
    case "==":
      return valor === corte;
  }
}

/** Orden total sobre la union ancha de `normalized`. Sin el, dos corridas podrian diferir. */
export function compararValores(a: string | number | boolean, b: string | number | boolean): number {
  const ra = rango(a);
  const rb = rango(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function rango(v: string | number | boolean): number {
  return typeof v === "boolean" ? 0 : typeof v === "number" ? 1 : 2;
}
