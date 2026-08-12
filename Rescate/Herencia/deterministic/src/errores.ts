/**
 * Los dos unicos errores que este modulo lanza, y ninguno ocurre durante el calculo.
 *
 * ================== Donde SI se lanza y donde JAMAS ==================
 *
 * Se lanza al CARGAR el dominio (taxonomia incoherente) y en la FRONTERA de
 * `evaluate` (peticion malformada o `domain_version` discordante). Nunca durante
 * el colapso: ahi rige el cierre total —todo valor sin mapeo cae a la clase de
 * fallback (Motor A §4.3)— y un valor raro del paciente jamas tumba la evaluacion.
 *
 * La razon de la asimetria: un dominio roto o una version discordante producirian
 * un reporte que PARECE valido y no lo es, y ese es el peor fallo posible de una
 * capa cuya unica promesa es la reproducibilidad (spec §9). Un valor no mapeado,
 * en cambio, es informacion legitima: sube `fallback_rate` y se reporta.
 *
 * =====================================================================
 */

import { formatear, type ValidationIssue } from "@techsphere/contracts";

/** Taxonomia incoherente. Falla al CARGAR, no al calcular (WO-26). */
export class ErrorDeDominio extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(fuente: string, issues: readonly ValidationIssue[]) {
    super(
      `Dominio invalido (${fuente}): ${issues.length} problema(s).\n${formatear(issues)}\n` +
        `El dominio es DATO, no codigo: se valida al cargar y no al calcular, para que ` +
        `una taxonomia rota nunca produzca un reporte que parezca valido.`,
    );
    this.name = "ErrorDeDominio";
    this.issues = issues;
  }
}

/**
 * `request.domain_version` no coincide con la taxonomia cargada (spec §9).
 *
 * Se falla en vez de calcular con la version disponible: un reporte producido con
 * una taxonomia distinta a la esperada es peor que ningun reporte, porque no hay
 * nada en su forma que delate la sustitucion.
 */
export class ErrorDeVersionDeDominio extends Error {
  readonly esperada: string;
  readonly cargada: string;

  constructor(esperada: string, cargada: string) {
    super(
      `La peticion exige domain_version ${JSON.stringify(esperada)} y el modulo tiene cargada ` +
        `${JSON.stringify(cargada)}. No se calcula.\n` +
        `-> Recarga el dominio de la version exigida o corrige la peticion. Calcular con la ` +
        `version disponible produciria un reporte indistinguible de uno correcto (spec §9).`,
    );
    this.name = "ErrorDeVersionDeDominio";
    this.esperada = esperada;
    this.cargada = cargada;
  }
}
