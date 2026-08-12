/**
 * El desenlace de una llamada que muere en la verificacion de identidad.
 *
 * ============ No es un caso de error: es un DESENLACE ============
 *
 * ADR-016 dice que ninguna sesion termina sin `CallSummary`, y este es el borde que
 * nadie prueba. Si el orquestador corta antes de crear sesion, no hay resumen — y
 * una llamada que no dejo rastro es indistinguible de una llamada que nunca
 * ocurrio. Es justo lo que ADR-009 prohibe en la otra capa: la no evaluabilidad es
 * un RESULTADO, no un vacio.
 *
 * Y en la practica es de los desenlaces que mas le importan a quien opera el
 * sistema: alguien contesto ese telefono y no pudo demostrar quien era. El paciente
 * es post-operado, puede ser mayor, puede no recordar la fecha del procedimiento —y
 * con la politica de no enumerar opciones, que es la correcta, fallar es mas facil.
 * Ese teléfono lo contesto alguien, y eso tiene que quedar escrito.
 *
 * ================================================================
 *
 * Este cierre NO es el camino de `identity: unverified` con marco generico (WO-42),
 * que existe para la llamada que SIGUE adelante sin identificar. Este es el
 * terminal: la sesion acaba aqui.
 *
 * El tratamiento CLINICO de una identidad no verificada sigue siendo contenido del
 * director (WO-47 §7). Lo que esta funcion fija es la plomeria: que exista resumen,
 * que alerte, y que la razon este nombrada.
 */

import {
  exigirValido,
  validateCallSummary,
  validateDecision,
  validateSummaryDelivery,
  type CallSummary,
  type Decision,
  type SummaryDestination,
} from "@techsphere/contracts";

/**
 * Las versiones vigentes del sistema en el momento de la llamada.
 *
 * Se declaran aunque en este cierre no se haya consultado ni la taxonomia, ni la
 * tabla VD, ni el indice: dicen bajo QUE estaba corriendo el sistema, no que
 * consulto. Un resumen autocontenido sin versiones no se puede reproducir un mes
 * despues, y este cierre se archiva igual que los demas.
 */
export interface VersionesVigentes {
  domain_version: string;
  vd_version: string;
  embedding_model: string;
}

export interface CierreDeSesion {
  decision: Decision;
  summary: CallSummary;
  /** `alert_channel` incluido porque escala: el personal no recibe un timbre, recibe el caso. */
  destinos: SummaryDestination[];
}

export interface PedidoDeCierrePorIdentidad {
  session_id: string;
  versions: VersionesVigentes;
  /**
   * Cuantos intentos de identificacion hubo y como acabaron, SIN nombres ni
   * verificadores: la razon es campo de auditoria y no puede volverse el sitio por
   * donde se filtra lo que `verifyIdentity` se nego a divulgar.
   */
  detalle?: string;
  /** Inyectable para que el resumen sea reproducible en prueba. */
  generated_at?: string;
}

export function cierrePorIdentidadNoVerificada(pedido: PedidoDeCierrePorIdentidad): CierreDeSesion {
  const reason =
    `La llamada termino sin verificar la identidad. ` +
    (pedido.detalle ? `${pedido.detalle} ` : "") +
    `No se genero marco, no se extrajo ninguna unidad y no se invoco la determinista: ` +
    `no hay cuadro sobre el que decidir. Se escala para que una persona retome el contacto — ` +
    `alguien contesto y no pudo identificarse, y eso puede ser confusion, sedacion o mal estado, ` +
    `no un tramite fallido (ADR-016: ninguna sesion termina sin resumen).`;

  const decision: Decision = {
    escalate: true,
    // La lectura de gravedad es `verde` porque NO SABEMOS: no se leyo ningun cuadro.
    // Lo que falla no es el paciente, es la verificacion. Escalar con criticidad
    // verde es valido y esperado bajo ADR-018.
    criticality: "verde",
    reason,
    reason_code: "contexto_incompleto",
    say_to_patient:
      "No logre confirmar sus datos por este medio, y prefiero no seguir adelante sin estar seguro " +
      "de con quien hablo. Voy a pasar su caso a una persona del equipo para que lo llame.",
    traces: { doc_ids: [], rules_fired: [] },
    context_complete: false,
  };
  exigirValido("Decision del cierre por identidad no verificada", validateDecision(decision));

  const summary: CallSummary = {
    session_id: pedido.session_id,
    generated_at: pedido.generated_at ?? new Date().toISOString(),
    // Nunca hubo referencia: no se identifico a nadie.
    patient_ref: null,
    identity_status: "unverified",
    frame: {
      // ADR-012 — se declara, no se disimula. Sin experto clinico, `inferred`.
      provenance: "inferred",
      rounds: 0,
      context_complete: false,
    },
    // Cobertura vacia, y es informacion: no es que no se hallara nada, es que no se
    // llego a preguntar. Un `findings` vacio con `rounds: 0` cuenta esa historia sin
    // que nadie tenga que inferirla.
    findings: [],
    decision: {
      escalate: decision.escalate,
      criticality: decision.criticality,
      reason: decision.reason,
      reason_code: decision.reason_code,
      branch: "degradacion",
      traces: { doc_ids: [], rules_fired: [] },
    },
    versions: { ...pedido.versions },
  };
  exigirValido("CallSummary del cierre por identidad no verificada", validateCallSummary(summary));

  const destinos: SummaryDestination[] = ["session_archive", "alert_channel"];
  exigirValido("Entrega del cierre por identidad", validateSummaryDelivery(summary, destinos));

  return { decision, summary, destinos };
}
