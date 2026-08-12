/**
 * WO-30 — el ensamblador. Ejecuta la secuencia FIJA de la spec §7.2 y produce el
 * `DeterministicReport` completo.
 *
 *   1. elegibilidad  ->  2. colapso  ->  3. cardinalidad
 *   4. convergencia de clase  ->  5. composiciones  ->  6. ensamblado
 *
 * Sin ramificaciones y sin orden variable. Los motores solo EJECUTAN la secuencia
 * y entregan resultado: no evaluan, no priorizan, no deciden.
 *
 * ================== Lo que este modulo NO hace, por norma ==================
 *
 * No diagnostica, no puntua, no recomienda, no decide, no interpreta lenguaje
 * natural, no consulta documentos y no aprende en runtime. Su valor en el sistema
 * es exactamente ese: ser el mecanismo cuyo MODO DE FALLO es distinto al del
 * modelo de lenguaje. Dos votos correlacionados no son dos votos (ADR-013).
 *
 * `lectura` es un enumerado en los tres ejes. El modulo NO redacta: la
 * verbalizacion clinica es del decisor y la verbalizacion al paciente es de la
 * conversacional. Y `alert`, `score`, `risk`, `severity`, `recommendation` y
 * `diagnosis` estan AUSENTES por norma (ADR-006, ADR-007), protegidos por prueba
 * negativa y no por la memoria de quien edite.
 *
 * ==========================================================================
 *
 * PUREZA. `evaluate` es sincrona, sin red, sin reloj, sin aleatoriedad y sin estado
 * entre invocaciones: misma peticion, mismo reporte, byte a byte. Por eso la
 * latencia se mide FUERA (ver `metricas.ts`) — un `Date.now()` dentro de la funcion
 * pura la volveria impura para poder medir que es pura.
 */

import {
  exigirValido,
  validateDeterministicRequest,
  type DeterministicPort,
  type DeterministicQuality,
  type DeterministicReport,
  type DeterministicRequest,
  type DeterministicTraceEntry,
  type DomainManifest,
  type FuncionalidadLectura,
  type IntegridadLectura,
  type InteraccionLectura,
} from "@techsphere/contracts";
import { manifiestoDe, type Dominio } from "./dominio.ts";
import { repartirPorElegibilidad } from "./elegibilidad.ts";
import { colapsar, compararValores, resolverModificadores } from "./colapso.ts";
import { evaluarInteraccion } from "./interaccion.ts";
import { evaluarIntegridad } from "./integridad.ts";
import { ErrorDeVersionDeDominio } from "./errores.ts";

export class MotorDeterminista implements DeterministicPort {
  private readonly dominio: Dominio;

  constructor(dominio: Dominio) {
    this.dominio = dominio;
  }

  describeDomain(): DomainManifest {
    return manifiestoDe(this.dominio);
  }

  evaluate(req: DeterministicRequest): DeterministicReport {
    // Frontera: peticion malformada -> error accionable, nunca `undefined` silencioso.
    exigirValido("DeterministicRequest", validateDeterministicRequest(req));

    // Version obligatoria: se falla en vez de calcular con la version disponible.
    if (req.domain_version !== this.dominio.version) {
      throw new ErrorDeVersionDeDominio(req.domain_version, this.dominio.version);
    }

    const dominio = this.dominio;

    // 1 — elegibilidad y cobertura (ADR-009)
    const reparto = repartirPorElegibilidad(req.units, dominio);

    // modificadores transversales: condicionan que reglas aplican, NO el colapso
    const ctx = resolverModificadores(req.modifiers, dominio);

    // 2 y 3 — colapso clasificatorio y cardinalidad
    const colapso = colapsar(reparto.elegibles, dominio, ctx);
    const clasesDistintas = new Set(colapso.hits.map((h) => h.clase));

    // 4 y 5 — convergencia de clase y composiciones
    const interaccion = evaluarInteraccion(
      colapso.clasesPorUnidad,
      colapso.valorPorUnidad,
      dominio,
      ctx,
    );

    // integridad sistemica — lo que se afirma del caso completo
    const comprometidas = evaluarIntegridad(colapso.hits, interaccion.composiciones, dominio);

    // 6 — ensamblado
    const evaluadas = reparto.elegibles.map((u) => u.id).sort();
    const noEvaluadas = [...reparto.noEvaluadas].sort((a, b) =>
      a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0,
    );
    const total = evaluadas.length + noEvaluadas.length;

    const valorDe = (unidades: readonly string[]): Array<string | number | boolean> =>
      unidades
        .map((u) => colapso.valorPorUnidad.get(u))
        .filter((v): v is string | number | boolean => v !== undefined)
        .sort(compararValores);

    // Toda afirmacion del reporte deja su entrada de traza, y en el mismo orden en
    // que se produjo: hallazgos por unidad, clases convergentes, composiciones y
    // afirmaciones estructurales. Son la fuente UNICA de `Decision.traces.rules_fired`.
    const trace: DeterministicTraceEntry[] = [
      ...colapso.hits.map((h) => ({
        rule_id: h.rule_id,
        clase: h.clase,
        origen_unit_ids: h.origen_unit_ids,
        origen_valores: h.origen_valores,
      })),
      ...interaccion.convergentes.map((h) => ({
        rule_id: h.rule_id,
        clase: h.clase,
        origen_unit_ids: h.origen_unit_ids,
        origen_valores: h.origen_valores,
      })),
      ...interaccion.composiciones.map((h) => ({
        rule_id: h.rule_id,
        clase: h.clase_producida,
        origen_unit_ids: h.origen_unit_ids,
        origen_valores: valorDe(h.origen_unit_ids),
      })),
      // En las afirmaciones de integridad, `clase` porta el NODO ESTRUCTURAL
      // afirmado. Es la unica forma de que un `ST-*` llegue a `rules_fired`, y sin
      // eso el decisor no podria citar la regla que sostiene "integridad comprometida".
      ...comprometidas.map((h) => ({
        rule_id: h.rule_id,
        clase: h.estructura,
        origen_unit_ids: h.origen_unit_ids,
        origen_valores: valorDe(h.origen_unit_ids),
      })),
    ];

    const quality: DeterministicQuality = {
      fallback_rate:
        reparto.elegibles.length === 0 ? 0 : colapso.fallbacks / reparto.elegibles.length,
      unidades_condicionadas: [...reparto.condicionadas].sort(),
      warnings: [...reparto.warnings, ...ctx.warnings, ...colapso.warnings, ...interaccion.warnings],
    };

    return {
      domain_version: dominio.version,
      frame_id: req.frame_id,

      funcionalidad: {
        clases: colapso.hits,
        cardinalidad: clasesDistintas.size,
        lectura: lecturaFuncionalidad(clasesDistintas.size),
      },

      interaccion: {
        convergentes: interaccion.convergentes,
        composiciones: interaccion.composiciones,
        lectura: lecturaInteraccion(
          reparto.elegibles.length,
          clasesDistintas.size,
          interaccion.convergentes.length + interaccion.composiciones.length,
        ),
      },

      integridad: {
        comprometidas,
        lectura: lecturaIntegridad(comprometidas.length, reparto.elegibles.length),
      },

      coverage: {
        evaluadas,
        no_evaluadas: noEvaluadas,
        ratio: total === 0 ? 0 : evaluadas.length / total,
      },

      trace,
      quality,
    };
  }
}

/** `1 = patron puro`, `>1 = coexistencia de mecanismos` (Motor A §4.4). */
function lecturaFuncionalidad(cardinalidad: number): FuncionalidadLectura {
  if (cardinalidad === 0) return "sin_hallazgo";
  return cardinalidad === 1 ? "patron_unico" : "coexistencia";
}

/**
 * La ausencia se enuncia AFIRMATIVAMENTE: `hallazgos_independientes` es una lectura
 * con etiqueta propia, no una lista vacia. Que dos hallazgos no compartan mecanismo
 * es informacion, y representarla por omision la haria indistinguible de no haber
 * mirado.
 *
 * Con una sola unidad elegible no se declara patron compartido (Motor A §5.4):
 * seria enunciar como sistemico lo que es un caso unico.
 */
function lecturaInteraccion(
  elegibles: number,
  clasesDistintas: number,
  compartidos: number,
): InteraccionLectura {
  if (clasesDistintas === 0) return "sin_hallazgo";
  if (elegibles < 2) return "hallazgos_independientes";
  return compartidos > 0 ? "patron_compartido" : "hallazgos_independientes";
}

/**
 * `no_determinable` cuando no hubo nada que mirar. No se degrada por cobertura
 * parcial: mezclar "no vi" con "vi y esta bien" en esta etiqueta le quitaria al
 * decisor la posibilidad de aplicar su propio umbral, y "cobertura antes del
 * silencio" es guardarrail del decisor, no de este modulo (spec §9).
 */
function lecturaIntegridad(comprometidas: number, elegibles: number): IntegridadLectura {
  if (comprometidas > 0) return "comprometida";
  return elegibles === 0 ? "no_determinable" : "integra";
}
