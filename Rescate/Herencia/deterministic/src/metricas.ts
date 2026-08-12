/**
 * WO-33 — metricas del modulo. Alimenta el README de metricas del reto (RF-13).
 *
 * ================== La latencia se mide FUERA de `evaluate` ==================
 *
 * Un `Date.now()` dentro de la funcion pura la volveria impura justo para poder
 * medir que es pura. Por eso el cronometro vive en este decorador: envuelve el
 * puerto, mide la llamada desde afuera y deja `MotorDeterminista.evaluate` sin
 * reloj. El puerto que expone es el MISMO `DeterministicPort`, asi que el decisor
 * no se entera de si esta midiendo o no.
 *
 * ============================================================================
 *
 * TOKENS Y COSTO NO APLICAN, y hay que decirlo explicitamente en el reporte para
 * que la ausencia no se lea como omision: este modulo no invoca ningun modelo de
 * lenguaje. Su latencia es de orden milisegundos y contrasta con los ~12 s que
 * costaba una sola llamada de suficiencia — ese contraste es el argumento de la
 * arquitectura de dos votos, y por eso se mide.
 *
 * `fallback_rate` es la metrica de MANTENIMIENTO DEL DOMINIO: alto en uso real
 * significa taxonomia incompleta, no paciente raro. `coverage.ratio` es cuanto del
 * cuadro se pudo evaluar de verdad.
 *
 * Y una advertencia que costo casi una compuerta (hallazgo B3): TODO porcentaje va
 * con su denominador. Por eso cada agregado publica `n` al lado.
 */

import type {
  DeterministicPort,
  DeterministicReport,
  DeterministicRequest,
  DomainManifest,
} from "@techsphere/contracts";

export interface MuestraDeterminista {
  session_id: string;
  frame_id: string;
  domain_version: string;
  latencia_ms: number;
  fallback_rate: number;
  coverage_ratio: number;
  unidades_evaluadas: number;
  unidades_no_evaluadas: number;
  reglas_disparadas: number;
}

export interface MetricasDeterministas {
  domain_version: string;
  /** El denominador de todo lo que sigue (hallazgo B3). */
  n_invocaciones: number;
  latencia_ms: { media: number; p50: number; max: number };
  fallback_rate: { media: number; max: number };
  coverage_ratio: { media: number; min: number };
  /** Se declara explicitamente: la ausencia no es una omision. */
  tokens: null;
  costo: null;
  nota: string;
}

const NOTA =
  "Este modulo no invoca ningun modelo de lenguaje: tokens y costo no aplican, y su ausencia " +
  "es una propiedad del diseño, no un dato que falte. La latencia es de aritmetica pura.";

/** Decorador que mide sin tocar la pureza de lo medido. */
export class DeterministaMedido implements DeterministicPort {
  private readonly interno: DeterministicPort;
  private readonly muestras: MuestraDeterminista[] = [];

  constructor(interno: DeterministicPort) {
    this.interno = interno;
  }

  describeDomain(): DomainManifest {
    return this.interno.describeDomain();
  }

  evaluate(req: DeterministicRequest): DeterministicReport {
    const t0 = performance.now();
    const reporte = this.interno.evaluate(req);
    const latencia = performance.now() - t0;

    this.muestras.push({
      session_id: req.session_id,
      frame_id: req.frame_id,
      domain_version: reporte.domain_version,
      latencia_ms: latencia,
      fallback_rate: reporte.quality.fallback_rate,
      coverage_ratio: reporte.coverage.ratio,
      unidades_evaluadas: reporte.coverage.evaluadas.length,
      unidades_no_evaluadas: reporte.coverage.no_evaluadas.length,
      reglas_disparadas: new Set(reporte.trace.map((t) => t.rule_id)).size,
    });

    return reporte;
  }

  desglose(): MuestraDeterminista[] {
    return [...this.muestras];
  }

  /**
   * Las series solo son comparables DENTRO de la misma `domain_version`: dos
   * taxonomias distintas producen `fallback_rate` incomparables. Por eso la version
   * viaja en el agregado y se avisa si la corrida mezclo varias.
   */
  agregado(): MetricasDeterministas {
    const n = this.muestras.length;
    const versiones = [...new Set(this.muestras.map((m) => m.domain_version))].sort();
    const latencias = this.muestras.map((m) => m.latencia_ms).sort((a, b) => a - b);
    const fallbacks = this.muestras.map((m) => m.fallback_rate);
    const coberturas = this.muestras.map((m) => m.coverage_ratio);

    return {
      domain_version: versiones.join(" + ") || this.interno.describeDomain().domain_version,
      n_invocaciones: n,
      latencia_ms: {
        media: media(latencias),
        p50: percentil(latencias, 0.5),
        max: latencias.length === 0 ? 0 : latencias[latencias.length - 1]!,
      },
      fallback_rate: { media: media(fallbacks), max: fallbacks.length === 0 ? 0 : Math.max(...fallbacks) },
      coverage_ratio: { media: media(coberturas), min: coberturas.length === 0 ? 0 : Math.min(...coberturas) },
      tokens: null,
      costo: null,
      nota: versiones.length > 1 ? `${NOTA} ATENCION: la corrida mezcla ${versiones.length} versiones de dominio y las series no son comparables entre si.` : NOTA,
    };
  }
}

function media(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentil(ordenados: readonly number[], p: number): number {
  if (ordenados.length === 0) return 0;
  const i = Math.min(ordenados.length - 1, Math.floor(p * ordenados.length));
  return ordenados[i]!;
}
