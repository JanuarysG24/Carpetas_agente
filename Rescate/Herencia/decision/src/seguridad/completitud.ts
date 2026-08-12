/**
 * La propiedad de seguridad de ADR-014, como funcion pura: A LA FALLA, ACTUA HUMANO.
 *
 * ================== Por que esto existe HOY y no en WO-44 ==================
 *
 * Mientras la conversacional sea andamio, sus unidades llegan
 * `hidratada_sin_normalizar` con `normalized: null`, el decisor concluye —con
 * razon— que el contexto nunca es suficiente, y sale `contexto_incompleto` en el
 * 100 % de los casos. Ese sesgo hace inutil medir precision de criticidad (H17),
 * pero regala una garantia que mañana costaria fabricar: permite verificar
 * ESTRUCTURALMENTE que un marco sin normalizar SIEMPRE alerta, con independencia de
 * la calidad de la extraccion. Ningun test posterior podra aislar eso tan limpio.
 *
 * Por eso la propiedad se fija aqui, en una funcion pura que WO-42 y WO-44
 * consumen, en vez de quedar implicita dentro del orquestador: una propiedad que
 * solo se puede probar de punta a punta se prueba tarde y se rompe callada.
 *
 * ==========================================================================
 *
 * ============ ADR-022: el atajo existe solo hacia `need_more` ============
 *
 * Este modulo NO exporta ninguna funcion que diga "suficiente", y la ausencia es
 * normativa. El predicado puede cortocircuitar hacia otra ronda —la respuesta ya se
 * conoce— pero nunca puede cerrar el bucle: completitud estructural no es
 * suficiencia clinica, y un predicado que pudiera declararla seria una regla
 * estructural decidiendo un asunto clinico. Un marco completo se CONSULTA al
 * modelo, que puede pedir mas igual.
 *
 * ========================================================================
 */

import {
  exigirValido,
  validateDecision,
  type ContextFrame,
  type Decision,
  type ReasonCode,
  type UnitResult,
} from "@techsphere/contracts";

export type MotivoDeFalta =
  /** El marco pidio la unidad y no volvio ningun resultado. */
  | "ausente"
  /** Hay evidencia del paciente pero no valor mapeable: `normalized: null`. */
  | "sin_normalizar"
  /** Tiene valor, pero no cubre las dimensiones que el marco declaro. */
  | "cobertura_incompleta"
  /** Se cerro con causa declarada y sin valor. Cerrada, pero el dato no existe. */
  | "suspendida_sin_valor";

export interface Faltante {
  unit_id: string;
  motivo: MotivoDeFalta;
  /** Legible: va literal al `reason` y al `frame_delta`, que es lo que la rubrica premia. */
  detalle: string;
}

export interface LecturaDelMarco {
  /**
   * ADR-022 — required sin cerrar. Cada una NOMBRA la unidad que faltaba, en vez de
   * una decision del modelo sin desglose: el `frame_delta` deja de ser una
   * inferencia sobre que repreguntar y pasa a ser consecuencia directa del estado.
   */
  reabribles: Faltante[];
  /**
   * Faltas que NO se reabren: la unidad ya se cerro con causa. Insistir sobre un
   * `no_sabe` limpio no produce el dato, produce una conversacion peor.
   */
  irrecuperables: Faltante[];
  /**
   * `cubierta_condicionada` con dependencias abiertas. NO es falta del predicado:
   * es exactamente el caso que ADR-022 reserva al juicio del modelo.
   */
  condicionadas: string[];
  /** Lo que viaja en `Decision.context_complete`. */
  completo: boolean;
}

/**
 * Lee el marco hidratado contra el marco pedido. Pura: sin reloj, sin red, sin estado.
 *
 * Solo mira unidades `required`. Las `desired` y `opportunistic` no bloquean nada
 * por definicion — una `opportunistic` NUNCA se pregunta, asi que exigirla seria
 * pedir un dato que el sistema tiene prohibido buscar.
 */
export function leerMarco(frame: ContextFrame, units: readonly UnitResult[]): LecturaDelMarco {
  const porId = new Map(units.map((u) => [u.id, u]));
  const reabribles: Faltante[] = [];
  const irrecuperables: Faltante[] = [];
  const condicionadas: string[] = [];

  for (const spec of frame.units) {
    if (spec.priority !== "required") continue;

    const unidad = porId.get(spec.id);
    if (unidad === undefined) {
      reabribles.push({
        unit_id: spec.id,
        motivo: "ausente",
        detalle: `El marco pidio "${spec.id}" y no volvio resultado.`,
      });
      continue;
    }

    if (unidad.extraction === "suspendida") {
      irrecuperables.push({
        unit_id: spec.id,
        motivo: "suspendida_sin_valor",
        detalle:
          `"${spec.id}" se cerro por ${unidad.cause ?? "causa no declarada"} sin valor normalizado. ` +
          `Cerrada no es cubierta: el dato no existe.`,
      });
      continue;
    }

    if (unidad.extraction === "hidratada_sin_normalizar" || unidad.normalized === null) {
      reabribles.push({
        unit_id: spec.id,
        motivo: "sin_normalizar",
        detalle:
          `"${spec.id}" llego como ${unidad.extraction} con normalized: null. ` +
          `Hay literal del paciente${unidad.raw === null ? "" : ` (${JSON.stringify(unidad.raw)})`}, no valor mapeable.`,
      });
      continue;
    }

    const faltanDimensiones = spec.coverage.requires.filter((d) => !unidad.coverage_met.includes(d));
    if (faltanDimensiones.length > 0) {
      reabribles.push({
        unit_id: spec.id,
        motivo: "cobertura_incompleta",
        detalle: `"${spec.id}" tiene valor pero no cubre [${faltanDimensiones.join(", ")}].`,
      });
      continue;
    }

    if (unidad.extraction === "cubierta_condicionada") {
      condicionadas.push(spec.id);
    }
  }

  return {
    reabribles,
    irrecuperables,
    condicionadas,
    completo: reabribles.length === 0 && irrecuperables.length === 0,
  };
}

/**
 * ADR-022 — el unico atajo permitido, y va hacia `need_more`. Deliberadamente no
 * existe su simetrico: ninguna funcion de este modulo declara suficiencia.
 */
export function hayQueReabrir(lectura: LecturaDelMarco): boolean {
  return lectura.reabribles.length > 0;
}

export interface DegradacionPedida {
  reason_code: Extract<ReasonCode, "contexto_incompleto" | "incongruencia" | "falla_tecnica" | "urgencia">;
  /** Que fallo, en concreto. Va a `Decision.reason`, que es campo de auditoria. */
  motivo: string;
  say_to_patient?: string;
  /** El voto que SI existio, como evidencia parcial. Vacio cuando no hubo ninguno. */
  traces?: { doc_ids: string[]; rules_fired: string[] };
  /** `verde` por defecto: no sabemos que tan grave es el cuadro, sabemos que fallamos nosotros. */
  criticality?: Decision["criticality"];
}

/**
 * Construye la `Decision` de las ramas de ADR-014. Las tres invariantes van en el
 * cuerpo y no en el llamador, para que no haya un sitio donde se puedan olvidar:
 * `escalate: true` SIEMPRE, `context_complete: false` SIEMPRE, y `reason` no vacio.
 *
 * Valida contra el contrato antes de devolver. Que una `Decision` mal formada salga
 * de esta capa es exactamente lo que las pruebas negativas de WO-36 impiden, y el
 * sitio barato para impedirlo es donde se construye.
 */
export function decisionPorDegradacion(pedida: DegradacionPedida): Decision {
  const decision: Decision = {
    escalate: true,
    criticality: pedida.criticality ?? "verde",
    reason: pedida.motivo,
    reason_code: pedida.reason_code,
    say_to_patient:
      pedida.say_to_patient ??
      "Prefiero que esto lo mire una persona del equipo. Voy a pasar su caso ahora mismo para que lo llamen.",
    traces: pedida.traces ?? { doc_ids: [], rules_fired: [] },
    context_complete: false,
  };
  exigirValido("Decision de degradacion (ADR-014)", validateDecision(decision));
  return decision;
}

/**
 * El atajo de la incompletud, con las unidades nombradas. Es lo que produce la
 * rama que el andamio ejercita hoy en el 100 % de los casos, y la que seguira
 * cubriendo el caso real de un paciente del que no se pudo extraer lo necesario.
 */
export function decisionPorContextoIncompleto(
  lectura: LecturaDelMarco,
  rondasAgotadas: number,
): Decision {
  const faltas = [...lectura.reabribles, ...lectura.irrecuperables];
  return decisionPorDegradacion({
    reason_code: "contexto_incompleto",
    motivo:
      `Contexto incompleto tras ${rondasAgotadas} ronda(s): ` +
      faltas.map((f) => f.detalle).join(" ") +
      ` No se emite silencio sobre un cuadro que no se pudo leer (ADR-014).`,
    say_to_patient:
      "No alcance a entender bien algunas cosas de las que hablamos, y prefiero no quedarme con la duda. " +
      "Voy a pasar su caso a una persona del equipo para que lo llamen.",
  });
}
