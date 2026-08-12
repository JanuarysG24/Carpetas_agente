/**
 * WO-43 — el VOTO DETERMINISTA. Tabla declarada y versionada sobre el reporte.
 *
 * ============ Por que esto NO puede ser el modelo ============
 *
 * Esta prohibido delegar esta lectura al modelo de lenguaje. Si el VD fuera
 * probabilistico, el sistema perderia el segundo mecanismo independiente que es lo
 * unico que justifica la disyuncion de ADR-013 — dos votos correlacionados no son
 * dos votos. Y es de donde viene la consistencia del sistema: temperatura cero no da
 * determinismo en un modelo hospedado, pero esta tabla es identica ante el mismo caso.
 *
 * ============================================================
 *
 * ============ La tabla es la del DOMINIO, no la del andamio ============
 *
 * Instancia `referencia_tabla_vd` de `dominio-postop-v0.1.json`, que discrimina por
 * CLASE PRESENTE. La tabla de la rebanada leia `integridad.lectura === "comprometida"`
 * y con el dominio real eso se puebla en cuanto CUALQUIER eje tiene compromiso:
 * verificado, el caso amarillo del dataset tambien sale `comprometida`, asi que esa
 * tabla habria pintado de rojo casi todo (hallazgo D7).
 *
 * ======================================================================
 *
 * ============ Y NO usa `dia_postop` (E6-R) ============
 *
 * Tres razones, y la primera manda: meter el dia separaria la banda amarilla, y
 * `_limites_declarados` lo prohibe — si el VD resolviera lo dudoso, el voto
 * probabilistico sobraria. El amarillo es ambiguo POR DISEÑO, no por limite.
 * Segunda: serian 5 positivos, ajuste al generador sintetico. Tercera: por ADR-007 el
 * dia es contexto de juicio, no regla, asi que lo pondera el decisor — y le llega por
 * la proyeccion del caso, no por el reporte.
 *
 * ======================================================
 */

import type { Criticality, DeterministicReport, Vote } from "@techsphere/contracts";

/**
 * Se versiona con la misma disciplina que `domain_version`: un voto producido con
 * una tabla distinta a la esperada es ERROR, no aproximacion.
 */
export const VD_VERSION = "vd-tabla-0.2.0";

/** El dominio contra el que esta tabla fue escrita. Otro dominio, otra tabla. */
export const DOMINIO_ESPERADO = "postop-0.1.0";

export interface ReglaVD {
  vd_rule: string;
  /** Clase del dominio cuya PRESENCIA dispara la regla. `null` = por defecto. */
  si_clase_presente: string | null;
  lectura: Criticality;
  porque: string;
}

/**
 * Orden significativo: la PRIMERA que casa gana. Es el orden declarado en el dominio,
 * y va de lo mas grave a lo mas leve para que "la primera que casa" y "la mas grave"
 * sean la misma cosa.
 */
export const TABLA_VD: readonly ReglaVD[] = [
  {
    vd_rule: "VD-01",
    si_clase_presente: "convergencia_sistemica",
    lectura: "rojo",
    porque:
      "La integridad cedida coincide con respuesta sistemica: el organismo dejo de sostener funciones " +
      "basales Y hay respuesta que atraviesa el cuerpo. Es la composicion que captura los 12 rojos.",
  },
  {
    vd_rule: "VD-02",
    si_clase_presente: "estructura_declarada",
    lectura: "rojo",
    porque: "Signo estructural inequivoco en la zona intervenida.",
  },
  {
    vd_rule: "VD-03",
    si_clase_presente: "integridad_comprometida",
    lectura: "amarillo",
    porque:
      "El organismo dejo de sostener funciones basales, pero sin respuesta sistemica. Es el tramo " +
      "ambiguo: el VD no lo resuelve limpio y no debe intentarlo.",
  },
  {
    vd_rule: "VD-04",
    si_clase_presente: "estructura_incipiente",
    lectura: "amarillo",
    porque: "Signo estructural inicial en la zona intervenida.",
  },
  {
    vd_rule: "VD-05",
    si_clase_presente: null,
    lectura: "verde",
    porque: "Ninguna clase del dominio con lectura declarada esta presente.",
  },
];

export class ErrorDeVersionDeTablaVD extends Error {
  constructor(esperado: string, recibido: string) {
    super(
      `La tabla VD ${VD_VERSION} se escribio contra el dominio ${JSON.stringify(esperado)} y el reporte ` +
        `viene de ${JSON.stringify(recibido)}.\n` +
        `      No se emite voto: las reglas nombran clases de un dominio concreto, y leer un reporte de ` +
        `otro produciria un voto que parece valido y no lo es. Un voto con tabla distinta a la esperada ` +
        `es error, no aproximacion (ADR-013).`,
    );
    this.name = "ErrorDeVersionDeTablaVD";
  }
}

export interface LecturaVD {
  vote: Vote;
  /** La regla que caso. Va a `SummaryDecision.traces.vd_rule`. */
  vd_rule: string;
  /** `rule_id` de los hallazgos del reporte. Evidencia del VD, no del VP. */
  rules_fired: string[];
  vd_version: string;
}

/**
 * Las clases PRESENTES en el reporte: las que colapsaron por unidad y las que
 * produjo una composicion. `integridad.comprometidas[].estructura` NO entra — son
 * nodos de eje, no clases, y confundirlos es lo que rompia la tabla del andamio.
 */
export function clasesPresentes(r: DeterministicReport): Set<string> {
  return new Set<string>([
    ...r.funcionalidad.clases.map((c) => c.clase),
    ...r.interaccion.convergentes.map((c) => c.clase),
    ...r.interaccion.composiciones.map((c) => c.clase_producida),
  ]);
}

/** ADR-018 — el voto transporta su ACCION y su LECTURA, y son campos distintos. */
const ESCALA_POR_LECTURA: Record<Criticality, boolean> = {
  rojo: true,
  // El amarillo escala, con razon `vigilancia`: un amarillo que no escala es un
  // falso negativo potencial; uno que escala cuesta la revision de un humano.
  amarillo: true,
  verde: false,
};

export function leerVotoDeterminista(r: DeterministicReport): LecturaVD {
  if (r.domain_version !== DOMINIO_ESPERADO) {
    throw new ErrorDeVersionDeTablaVD(DOMINIO_ESPERADO, r.domain_version);
  }

  const presentes = clasesPresentes(r);
  const regla =
    TABLA_VD.find((x) => x.si_clase_presente !== null && presentes.has(x.si_clase_presente)) ??
    TABLA_VD[TABLA_VD.length - 1]!;

  return {
    vote: {
      escalate: ESCALA_POR_LECTURA[regla.lectura],
      criticality: regla.lectura,
      reason: `[${regla.vd_rule}] ${regla.porque}`,
    },
    vd_rule: regla.vd_rule,
    rules_fired: [...new Set(r.trace.map((t) => t.rule_id))],
    vd_version: VD_VERSION,
  };
}
