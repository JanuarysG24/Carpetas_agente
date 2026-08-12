/**
 * La base de pacientes: ESTADO por caso. Instancia `docs/Especificacion-Capa-Decision.md` §4.
 *
 * Archivo separado de `knowledge.ts` por ADR-011: conocimiento y estado tienen
 * naturaleza, acceso y ciclo de vida distintos, y la separacion se sostiene en la
 * estructura del modulo, no solo en la prosa.
 *
 * PRIVILEGIO MINIMO POR VISTA. El puerto expone dos operaciones que no son
 * intercambiables: `verifyIdentity` es la unica visible a la capa conversacional
 * (F0), y `getCase` es exclusiva de la capa de decision. La conversacional no
 * puede filtrar lo que no recibe — por eso `verifyIdentity` devuelve un veredicto
 * y una referencia opaca, NUNCA datos.
 */

/**
 * §4, correccion X-3 (7-ago) — el enum perdio `fecha_nacimiento`, que no existe
 * en el dataset: solo hay `edad`, y la edad no sirve como verificador porque su
 * entropia es casi nula.
 *
 * Orden de preferencia, que es de politica del decisor y no del tipo:
 *   `fecha_procedimiento` — el mas amable con un paciente recien operado
 *   `documento`           — el de mayor entropia
 *   `eps`                 — debil por si solo: el universo colombiano es pequeño
 */
export const VERIFIER_KINDS = ["fecha_procedimiento", "documento", "eps"] as const;

export type VerifierKind = (typeof VERIFIER_KINDS)[number];

/**
 * §7.1 de la conversacional — identificacion FUERTE: nombre completo declarado
 * MAS un dato verificador contrastado contra la base.
 *
 * La razon de exigir dos datos es directa: el marco contextual es especifico del
 * caso quirurgico. Hidratar el marco equivocado no produce una conversacion
 * imperfecta, produce una decision clinica sobre el paciente equivocado.
 */
export interface IdentityClaim {
  name: string;
  verifier: { kind: VerifierKind; value: string };
}

/**
 * Veredicto de UNA consulta a la base. No confundir con `IdentityStatus`, que es
 * el resultado de la fase F0 completa y es lo unico que cruza la costura:
 * `ambiguo` y `no_encontrado` son estados intermedios y no viajan al decisor.
 *
 * La respuesta jamas incluye datos del paciente. `patient_ref` es una referencia
 * OPACA: sostiene la regla de no divulgacion (conversacional §7.3) por construccion.
 */
export interface IdentityVerdict {
  status: "identificado" | "ambiguo" | "no_encontrado";
  patient_ref?: string;
}

/**
 * §4 — el caso quirurgico. Vista exclusiva de la capa de decision.
 *
 * La estructura se DERIVA de los archivos de perfil del dataset del reto
 * (`perfiles_clinicos_pacientes_silver_contest.xlsx`); el puerto es independiente
 * de ella. La instanciacion fiel al dataset es de WO-47: aqui solo estan los
 * campos que la spec nombra, que son los que la capa de decision necesita para
 * generar el marco (ADR-012: procedimiento + tiempo transcurrido acotan las
 * complicaciones plausibles).
 *
 * `patient_ref` es la clave opaca, no un dato del paciente: es lo que devuelve
 * `verifyIdentity` y lo unico que la conversacional llega a ver.
 */
export interface PatientCase {
  patient_ref: string;
  procedimiento: string;
  /** ISO-8601. Con `dia_postop` derivado es el modificador transversal de mayor impacto. */
  fecha_cirugia: string;
  edad: number;
  genero: string;
  /** En el dataset viaja como lista JSON dentro de una celda de texto; aqui ya parseada. */
  comorbilidades: string[];
}
