/**
 * VISTA DE IDENTIDAD — la unica visible a la capa conversacional (F0).
 *
 * ============ Este modulo NO exporta `getCase`, y es la decision ============
 *
 * La separacion de vistas no es documental: la conversacional no puede filtrar lo
 * que no recibe. `verifyIdentity` devuelve un veredicto y una referencia OPACA,
 * jamas datos, y el modulo que lo expone no tiene forma de llegar al caso — ni
 * siquiera importa el modulo que la tiene.
 *
 * Verificable por la superficie del paquete y no por convencion: hay una prueba que
 * recorre lo que este archivo exporta y falla si aparece cualquier acceso al caso.
 *
 * ==========================================================================
 *
 * ============ Por que un nombre no basta ============
 *
 * Identificacion FUERTE: nombre completo declarado MAS un verificador contrastado.
 * La razon es directa y no es de privacidad: el marco contextual es especifico del
 * caso quirurgico, asi que hidratar el marco equivocado no produce una conversacion
 * imperfecta — produce una decision clinica sobre el paciente equivocado. Los dos
 * homonimos de la base de desarrollo existen para que eso no se pueda olvidar.
 *
 * ====================================================
 */

import type { IdentityClaim, IdentityVerdict, VerifierKind } from "@techsphere/contracts";
import { REGISTROS, type RegistroDePaciente } from "./datos.ts";

/**
 * Orden de preferencia del verificador. Es politica del decisor, no del tipo:
 *   `fecha_procedimiento` — el mas amable con un paciente recien operado
 *   `documento`           — el de mayor entropia
 *   `eps`                 — debil por si solo; el universo colombiano es pequeño
 */
export const PREFERENCIA_DE_VERIFICADOR: readonly VerifierKind[] = [
  "fecha_procedimiento",
  "documento",
  "eps",
];

/** Sin acentos, sin dobles espacios, sin mayusculas. Un paciente no deletrea. */
function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarVerificador(kind: VerifierKind, valor: string): string {
  if (kind === "documento") return valor.replace(/\D+/g, "");
  if (kind === "fecha_procedimiento") {
    const digitos = valor.replace(/\D+/g, "");
    // Acepta 2026-08-01, 01/08/2026 y 20260801 sin pedirle formato al paciente.
    if (digitos.length === 8) {
      return digitos.startsWith("20")
        ? digitos
        : `${digitos.slice(4)}${digitos.slice(2, 4)}${digitos.slice(0, 2)}`;
    }
    return digitos;
  }
  return normalizarNombre(valor);
}

function coincideVerificador(registro: RegistroDePaciente, claim: IdentityClaim): boolean {
  const esperado = normalizarVerificador(
    claim.verifier.kind,
    registro.verificadores[claim.verifier.kind],
  );
  return esperado !== "" && esperado === normalizarVerificador(claim.verifier.kind, claim.verifier.value);
}

/**
 * La vista de identidad. Se construye sobre los registros pero no los deja salir:
 * su unica operacion devuelve `IdentityVerdict`, que son un enum y una referencia.
 */
export class VistaDeIdentidad {
  private readonly registros: readonly RegistroDePaciente[];

  constructor(registros: readonly RegistroDePaciente[] = REGISTROS) {
    this.registros = registros;
  }

  /**
   * F0 — nombre + verificador contra la base.
   *
   * Tres veredictos y ninguna enumeracion:
   *
   *   `identificado`  exactamente un registro casa nombre Y verificador
   *   `ambiguo`       varios casan ambos: el verificador no discrimino
   *   `no_encontrado` ninguno casa
   *
   * ============ Por que un verificador equivocado sale `no_encontrado` ============
   *
   * Cuando el nombre existe en la base pero el verificador no casa, la respuesta es
   * `no_encontrado`, NO `ambiguo`. Distinguir esos dos casos le diria a quien
   * pregunta que el nombre SI esta en la base, que es exactamente el dato que la
   * regla de no divulgacion protege: convertiria la verificacion en un oraculo de
   * pertenencia con el que se puede sondear la base un nombre a la vez.
   *
   * ==============================================================================
   */
  verifyIdentity(claim: IdentityClaim): IdentityVerdict {
    const nombre = normalizarNombre(claim.name);
    if (nombre === "") return { status: "no_encontrado" };

    const porNombre = this.registros.filter((r) => normalizarNombre(r.nombre) === nombre);
    const casan = porNombre.filter((r) => coincideVerificador(r, claim));

    if (casan.length === 1) return { status: "identificado", patient_ref: casan[0]!.patient_ref };

    // Ambiguedad REAL: dos registros indistinguibles con lo aportado. La respuesta
    // no enumera opciones — pedirle al paciente que elija entre dos fechas de
    // cirugia ajenas seria divulgar, y ademas invita a acertar por eliminacion.
    if (casan.length > 1) return { status: "ambiguo" };

    return { status: "no_encontrado" };
  }
}

/**
 * ============================================================================
 * NO AÑADIR AQUI NINGUNA OPERACION QUE DEVUELVA DATOS DEL CASO.
 *
 * `getCase` vive en `./casos.ts` y es exclusiva de la capa de decision. Si alguna
 * vez este archivo necesita importarlo, la separacion de privilegio se rompio y la
 * prueba de superficie lo dira antes de que llegue a produccion.
 * ============================================================================
 */
