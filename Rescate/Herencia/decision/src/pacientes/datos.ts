/**
 * Casos sinteticos de desarrollo. La estructura real del dataset es de WO-47.
 *
 * ============ La referencia opaca no se deriva del paciente ============
 *
 * `patient_ref` es un token declarado, no un hash del nombre ni un correlativo con
 * la fecha. Si se derivara del dato, dejaria de ser opaca: un identificador
 * reversible por diccionario divulga exactamente lo que `verifyIdentity` promete no
 * divulgar, y encima lo hace de una forma que parece segura.
 *
 * ======================================================================
 *
 * Los tres casos existen para ejercitar los tres veredictos: uno identificable,
 * dos homonimos que solo el verificador separa, y un cuarto con verificador debil.
 */

import type { PatientCase } from "@techsphere/contracts";

export const ENCABEZADO_SINTETICO = "DATOS SINTETICOS — sin validez";

export interface RegistroDePaciente {
  /** Lo unico que sale de la vista de identidad. Opaco por construccion. */
  patient_ref: string;
  /** Nombre declarado. NUNCA sale de la base: solo se contrasta contra el. */
  nombre: string;
  verificadores: {
    fecha_procedimiento: string;
    documento: string;
    eps: string;
  };
  caso: PatientCase;
}

function caso(
  patient_ref: string,
  procedimiento: string,
  fecha_cirugia: string,
  edad: number,
  genero: string,
  comorbilidades: string[],
): PatientCase {
  return { patient_ref, procedimiento, fecha_cirugia, edad, genero, comorbilidades };
}

/**
 * `_declaracion` no es decorativa: el mismo criterio que la taxonomia semilla de
 * WO-26. Un dato sintetico que no dice que lo es acaba citado como si fuera real.
 */
export const _declaracion = `${ENCABEZADO_SINTETICO}. Cuatro registros de desarrollo. Ninguna persona real.`;

export const REGISTROS: readonly RegistroDePaciente[] = [
  {
    patient_ref: "pref-9f2c41ab",
    nombre: "Ana Maria Restrepo Gomez",
    verificadores: {
      fecha_procedimiento: "2026-08-01",
      documento: "1032456789",
      eps: "Sura",
    },
    caso: caso("pref-9f2c41ab", "apendicectomia", "2026-08-01", 34, "F", ["hipotiroidismo"]),
  },
  // Dos homonimos: el nombre solo NO identifica, y es justo el caso que obliga a
  // que la identificacion sea fuerte (nombre + verificador). Hidratar el marco
  // equivocado no produce una conversacion imperfecta: produce una decision
  // clinica sobre el paciente equivocado.
  {
    patient_ref: "pref-4d7e10c3",
    nombre: "Carlos Andres Munoz",
    verificadores: {
      fecha_procedimiento: "2026-07-28",
      documento: "8012345",
      eps: "Nueva EPS",
    },
    caso: caso("pref-4d7e10c3", "colecistectomia", "2026-07-28", 61, "M", ["diabetes_tipo_2", "hta"]),
  },
  {
    patient_ref: "pref-b83a55d0",
    nombre: "Carlos Andres Munoz",
    verificadores: {
      fecha_procedimiento: "2026-08-05",
      documento: "1098765432",
      eps: "Sanitas",
    },
    caso: caso("pref-b83a55d0", "reemplazo_total_rodilla", "2026-08-05", 47, "M", []),
  },
  {
    patient_ref: "pref-2e6019f7",
    nombre: "Luz Dary Ospina",
    verificadores: {
      fecha_procedimiento: "2026-08-06",
      documento: "43567890",
      eps: "Sura",
    },
    caso: caso("pref-2e6019f7", "mastectomia", "2026-08-06", 58, "F", ["obesidad"]),
  },
];
