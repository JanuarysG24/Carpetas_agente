/**
 * Validacion del `CallSummary` (ADR-016).
 *
 * El resumen es autocontenido: un humano que solo reciba este objeto tiene que
 * poder auditar la sesion sin acceso al sistema. Por eso la validacion es mas
 * exigente que la de la `Decision` — aqui no hay contexto al que recurrir si
 * falta un campo.
 */

import { STATE_MAX, STATE_MIN } from "../conversational.ts";
import { agregar, resultado, type IssueSink, type ValidationResult } from "./issues.ts";
import {
  exigirArreglo,
  exigirArregloDeCadenas,
  exigirBooleano,
  exigirCadena,
  exigirCadenaONulo,
  exigirEnum,
  exigirNumero,
  exigirObjeto,
  rechazarClavesDesconocidas,
} from "./primitives.ts";
import { CRITICIDADES, REASON_CODES } from "./conversational.ts";

export const IDENTITY_STATUSES = ["identificado", "unverified"] as const;
export const PROCEDENCIAS = ["expert", "inferred"] as const;
export const RAMAS = ["or", "degradacion", "urgencia"] as const;
export const DESTINOS = ["session_archive", "alert_channel"] as const;

/**
 * ADR-013 + ADR-014 + ADR-018 — que reason_code admite cada rama.
 * `or` es la tabla de ponderacion; `degradacion` son las tres condiciones de
 * ADR-014 que cortocircuitan hacia la alerta; `urgencia` es escalateNow.
 */
const REASON_CODES_POR_RAMA: Record<(typeof RAMAS)[number], readonly string[]> = {
  or: ["evaluado", "vigilancia"],
  degradacion: ["contexto_incompleto", "incongruencia", "falla_tecnica"],
  urgencia: ["urgencia"],
};

const CLAVES_SUMMARY = [
  "session_id",
  "generated_at",
  "patient_ref",
  "identity_status",
  "frame",
  "findings",
  "decision",
  "versions",
  "metrics",
  "evidence_gaps",
  "narrative",
] as const;

const CLAVES_SUMMARY_DECISION = [
  "escalate",
  "criticality",
  "reason",
  "reason_code",
  "branch",
  "votes",
  "traces",
] as const;

const REF = "docs/Especificacion-Capa-Decision.md §8b.1 + ADR-016";

export function validateCallSummary(valor: unknown): ValidationResult {
  const sink: IssueSink = [];
  const resumen = exigirObjeto(sink, "", valor, "un CallSummary");
  if (!resumen) return resultado(sink);

  rechazarClavesDesconocidas(sink, "", resumen, CLAVES_SUMMARY, `${REF}`);

  exigirCadena(sink, "session_id", resumen["session_id"], { noVacia: true, hint: `${REF}` });
  exigirCadena(sink, "generated_at", resumen["generated_at"], {
    noVacia: true,
    hint: `Marca de tiempo del ensamblado. El resumen se ensambla JUNTO a la Decision, en el mismo acto (ADR-016).`,
  });
  exigirCadenaONulo(
    sink,
    "patient_ref",
    resumen["patient_ref"],
    `Referencia OPACA; nunca datos del paciente (ADR-011). null si la identidad quedo sin verificar.`,
  );
  exigirEnum(
    sink,
    "identity_status",
    resumen["identity_status"],
    IDENTITY_STATUSES,
    `unverified no aborta la llamada, pero cruza como bandera explicita: un paciente que no logra identificarse puede estar confundido, sedado o en mal estado. Es un dato clinico, no un fallo administrativo (conversacional §7.2).`,
  );

  // El `reason_code` se lee antes porque la comprobacion de `findings` depende de el:
  // "evaluado" con cero unidades miradas es un fallo silencioso disfrazado de verde.
  const decisionCruda = resumen["decision"];
  const reasonCode =
    typeof decisionCruda === "object" && decisionCruda !== null
      ? (decisionCruda as Record<string, unknown>)["reason_code"]
      : undefined;

  validarMarco(sink, resumen["frame"]);
  validarHallazgos(sink, resumen["findings"], typeof reasonCode === "string" ? reasonCode : undefined);
  validarDecisionDelResumen(sink, resumen["decision"]);
  validarVersiones(sink, resumen["versions"]);

  if (resumen["metrics"] !== undefined) {
    const metricas = exigirObjeto(sink, "metrics", resumen["metrics"], "el objeto metrics");
    if (metricas) {
      rechazarClavesDesconocidas(sink, "metrics", metricas, ["latency_ms", "tokens", "cost_estimate"], `${REF}`);
      exigirNumero(sink, "metrics.latency_ms", metricas["latency_ms"], { min: 0, hint: `Metrica obligatoria del README del reto.` });
      exigirNumero(sink, "metrics.tokens", metricas["tokens"], { min: 0, entero: true, hint: `Metrica obligatoria del README del reto.` });
      exigirNumero(sink, "metrics.cost_estimate", metricas["cost_estimate"], { min: 0, hint: `Costo estimado por llamada: corriendo local, extrapolado a precios de API con el calculo explicado.` });
    }
  }

  if (resumen["evidence_gaps"] !== undefined) {
    const huecos = exigirArreglo(sink, "evidence_gaps", resumen["evidence_gaps"], {
      hint: `Espejo de DeterministicCoverage.no_evaluadas: alli se declara que no se pudo mirar, aqui sobre que no se pudo citar. Si no hubo huecos, omite la clave en vez de mandar el arreglo vacio — un arreglo vacio y la ausencia dicen lo mismo, y una sola forma de decirlo evita que alguien lea significado donde no lo hay.`,
    });
    huecos?.forEach((hueco, i) => {
      const ruta = `evidence_gaps[${i}]`;
      const obj = exigirObjeto(sink, ruta, hueco, "una entrada de evidence_gaps");
      if (!obj) return;
      rechazarClavesDesconocidas(sink, ruta, obj, ["unit_id", "motivo"], `${REF}`);
      exigirCadena(sink, `${ruta}.unit_id`, obj["unit_id"], {
        noVacia: true,
        hint: `La unidad sobre la que no se pudo citar. Debe ser un unit_id del marco.`,
      });
      exigirCadena(sink, `${ruta}.motivo`, obj["motivo"], {
        noVacia: true,
        hint: `Por que no hubo respaldo: sin resultados por encima del piso de relevancia, unidad no consultada, indice caido. Un hueco sin motivo obliga a adivinar si fue el corpus o el sistema.`,
      });
    });
  }

  if (resumen["narrative"] !== undefined) {
    exigirCadena(sink, "narrative", resumen["narrative"], {
      noVacia: true,
      hint: `Si no hay redaccion, omite la clave en vez de mandarla vacia. Y recuerda que narrative es DERIVADO y jamas canonico: si contradice los campos estructurados, valen los campos (ADR-016).`,
    });
  }

  return resultado(sink);
}

function validarMarco(sink: IssueSink, valor: unknown): void {
  const marco = exigirObjeto(sink, "frame", valor, "el bloque frame");
  if (!marco) return;
  rechazarClavesDesconocidas(sink, "frame", marco, ["provenance", "rounds", "context_complete"], `${REF}`);
  exigirEnum(
    sink,
    "frame.provenance",
    marco["provenance"],
    PROCEDENCIAS,
    `ADR-012: si no hay experto clinico validando las unidades, la procedencia es "inferred" y se declara, no se disimula. Aparece en el informe del reto como limite conocido.`,
  );
  exigirNumero(sink, "frame.rounds", marco["rounds"], {
    min: 0,
    entero: true,
    hint: `Cuantas rondas de suficiencia hubo. Es del decisor: la conversacional no sabe en que ronda va (correccion X-4).`,
  });
  exigirBooleano(sink, "frame.context_complete", marco["context_complete"], `Habilita auditar la degradacion segura desde el propio resumen (ADR-014).`);
}

function validarHallazgos(sink: IssueSink, valor: unknown, reasonCode?: string): void {
  const hallazgos = exigirArreglo(sink, "findings", valor, {
    hint: `Una entrada por unidad del marco. Un CallSummary sin findings cuando hubo marco es invalido por esquema (docs/Especificacion-Capa-Decision.md §10).`,
  });
  if (!hallazgos) return;

  // ============ "Si dices que evaluaste, enseña el trabajo" ============
  //
  // Sustituye (8-ago) a la regla retirada que exigia trazas no vacias bajo
  // `evaluado`. Aquella miraba los HALLAZGOS y por eso declaraba invalido un caso
  // verde limpio, que legitimamente no dispara ni un `rule_id`.
  //
  // La invariante correcta no era sobre hallazgos: era sobre HABER MIRADO.
  //
  //   "Mire seis unidades y todas estaban bien"  -> resultado afirmativo
  //   "Mire cero"                                -> fallo
  //
  // Sin esto, un fallo silencioso de la determinista —que devuelve vacio— queda
  // indistinguible de un verde limpio: dos cosas distintas con la misma
  // representacion, que es el defecto que este proyecto persigue en todas partes.
  // Con esta forma se distinguen y nadie tiene que inventar un rule_id.
  // ======================================================================
  if (reasonCode === "evaluado" && hallazgos.length === 0) {
    agregar(
      sink,
      "findings",
      "incoherencia",
      `reason_code es "evaluado" —ambos votos existieron y se ponderaron— pero no se evaluo NINGUNA unidad.`,
      `Evaluar seis unidades y no hallar nada es un resultado afirmativo y produce findings con sus valores; evaluar cero es un fallo. Si de verdad no se miro ninguna unidad, el reason_code no es "evaluado" sino la rama de ADR-014 que corresponda (docs/Especificacion-Capa-Decision.md §10).`,
    );
  }

  hallazgos.forEach((hallazgo, i) => {
    const ruta = `findings[${i}]`;
    const obj = exigirObjeto(sink, ruta, hallazgo, "una entrada de findings");
    if (!obj) return;
    rechazarClavesDesconocidas(sink, ruta, obj, ["unit_id", "state", "raw", "normalized", "cause"], `${REF}`);

    exigirCadena(sink, `${ruta}.unit_id`, obj["unit_id"], { noVacia: true, hint: `${REF}` });
    exigirNumero(sink, `${ruta}.state`, obj["state"], {
      min: STATE_MIN,
      max: STATE_MAX,
      entero: true,
      hint: `Estado final del motor conversacional: entero en [${STATE_MIN}, ${STATE_MAX}], salud de la extraccion (ADR-005). No es confidence.`,
    });
    exigirCadenaONulo(
      sink,
      `${ruta}.raw`,
      obj["raw"],
      `ADR-004: la evidencia no se destruye. El resumen tiene que ser auditable por un humano sin acceso al sistema, y el literal es la evidencia.`,
    );

    const normalized = obj["normalized"];
    if (
      normalized !== null &&
      typeof normalized !== "string" &&
      typeof normalized !== "number" &&
      typeof normalized !== "boolean"
    ) {
      agregar(
        sink,
        `${ruta}.normalized`,
        normalized === undefined ? "campo_ausente" : "tipo_invalido",
        `normalized admite string, number, boolean o null; se recibio ${typeof normalized}.`,
        `Es la MISMA union que UnitResult.normalized: el ensamblador COPIA del ledger, no convierte. Serializar una fiebre a "38.5" seria una transformacion que el ledger no autorizo, y romperia la comparacion contra label_ground_truth, porque contrastar "7" con 7 exige parsear (ADR-016, correccion X-7).`,
      );
    }

    if (obj["cause"] !== undefined) {
      exigirCadena(sink, `${ruta}.cause`, obj["cause"], {
        noVacia: true,
        hint: `Causa tipificada si no se extrajo. Distinguir no_sabe de no_comprende habilita lecturas clinicas distintas (conversacional §10.3).`,
      });
    }
  });
}

function validarDecisionDelResumen(sink: IssueSink, valor: unknown): void {
  const decision = exigirObjeto(
    sink,
    "decision",
    valor,
    "el bloque decision",
    `Ninguna sesion termina sin CallSummary, y ningun CallSummary existe sin la decision que lo motivo: se ensamblan en el mismo acto (ADR-016).`,
  );
  if (!decision) return;

  if ("alert" in decision) {
    agregar(
      sink,
      "decision.alert",
      "campo_prohibido",
      `decision no lleva "alert". El booleano se llama "escalate".`,
      `Misma correccion X-1 que en Decision: escalate nombra la ACCION y criticality la LECTURA. El termino alert sobrevive solo en alert_channel, que es un destino de entrega.`,
    );
  }

  rechazarClavesDesconocidas(sink, "decision", decision, CLAVES_SUMMARY_DECISION, `${REF}`);

  const escalate = exigirBooleano(sink, "decision.escalate", decision["escalate"], `Determina ademas si el resumen va a alert_channel: el personal alertado no recibe un timbre, recibe el caso (§8b.2).`);
  exigirEnum(sink, "decision.criticality", decision["criticality"], CRITICIDADES, `Es lo que hace el archivo de sesion directamente contrastable contra el dataset etiquetado (ADR-018).`);
  exigirCadena(sink, "decision.reason", decision["reason"], { noVacia: true, hint: `${REF}` });
  const reasonCode = exigirEnum(sink, "decision.reason_code", decision["reason_code"], REASON_CODES, `Obligatorio, igual que en Decision (correccion X-5).`);
  const rama = exigirEnum(
    sink,
    "decision.branch",
    decision["branch"],
    RAMAS,
    `Que camino produjo la decision: "or" es la tabla de ponderacion de ADR-013, "degradacion" son los cortocircuitos de ADR-014 y "urgencia" es escalateNow.`,
  );

  const trazas = exigirObjeto(
    sink,
    "decision.traces",
    decision["traces"],
    "el objeto traces",
    `Un CallSummary sin decision.traces es invalido por esquema (docs/Especificacion-Capa-Decision.md §10). El resumen es autocontenido: lleva evidencia, interpretacion, decision, trazas y versiones, para que un humano lo audite sin acceso al sistema. Sin trazas deja de serlo.`,
  );
  if (trazas) {
    rechazarClavesDesconocidas(sink, "decision.traces", trazas, ["doc_ids", "rules_fired", "vd_rule"], `${REF}`);
    exigirArregloDeCadenas(sink, "decision.traces.doc_ids", trazas["doc_ids"], { hint: `Evidencia documental del VP.` });
    exigirArregloDeCadenas(sink, "decision.traces.rules_fired", trazas["rules_fired"], { hint: `rule_id de los hallazgos deterministas que sostuvieron el VD.` });
    if (trazas["vd_rule"] !== undefined) {
      exigirCadena(sink, "decision.traces.vd_rule", trazas["vd_rule"], {
        noVacia: true,
        hint: `La regla de la tabla de lectura VD que produjo el voto. El VD no se infiere: es una tabla declarada, y su regla se registra (docs/Especificacion-Capa-Decision.md §10).`,
      });
    }
  }

  if (decision["votes"] !== undefined) {
    const votos = exigirObjeto(sink, "decision.votes", decision["votes"], "el objeto votes");
    if (votos) {
      rechazarClavesDesconocidas(sink, "decision.votes", votos, ["vp", "vd"], `${REF}`);
      for (const cual of ["vp", "vd"] as const) {
        if (votos[cual] === undefined) continue;
        const ruta = `decision.votes.${cual}`;
        const voto = exigirObjeto(sink, ruta, votos[cual], `el voto ${cual.toUpperCase()}`);
        if (!voto) continue;
        if ("alert" in voto) {
          agregar(
            sink,
            `${ruta}.alert`,
            "campo_prohibido",
            `El voto no lleva "alert". Lleva "escalate" y "criticality".`,
            `Correccion X-1: los votos dejaron de ser el par de literales "alertar" | "no_alertar" para volverse objetos que transportan su accion Y su lectura de criticidad, porque ambas viajan como evidencia (ADR-018).`,
          );
        }
        rechazarClavesDesconocidas(sink, ruta, voto, ["escalate", "criticality", "reason"], `${REF}`);
        exigirBooleano(sink, `${ruta}.escalate`, voto["escalate"], `La tabla OR de ADR-013 opera SOLO sobre este campo.`);
        exigirEnum(sink, `${ruta}.criticality`, voto["criticality"], CRITICIDADES, `criticality no se pondera: se registra (ADR-018).`);
        exigirCadena(sink, `${ruta}.reason`, voto["reason"], { noVacia: true, hint: `Cada voto explica el suyo: es lo que permite que Decision.reason declare que voto disparo la alerta (ADR-013).` });
      }

      const vd = votos["vd"];
      const vp = votos["vp"];
      if (
        typeof vd === "object" && vd !== null && "escalate" in vd && (vd as { escalate: unknown }).escalate === true &&
        escalate === false
      ) {
        agregar(
          sink,
          "decision.escalate",
          "incoherencia",
          `El voto VD dice escalar y la decision dice no escalar.`,
          `El VD tiene poder de disparo unilateral: un si actua. Solo dos noes no actuan, y no existe configuracion que permita a un voto negativo apagar uno positivo. Si esto se dio, alguien introdujo un veto y hay que revertirlo, o pasar un ADR que revierta ADR-013 explicitamente.`,
        );
      }
      if (
        typeof vp === "object" && vp !== null && "escalate" in vp && (vp as { escalate: unknown }).escalate === true &&
        escalate === false
      ) {
        agregar(
          sink,
          "decision.escalate",
          "incoherencia",
          `El voto VP dice escalar y la decision dice no escalar.`,
          `Un si actua (ADR-013). El camino hacia la alerta es ancho y el camino hacia el silencio es estrecho: para que el sistema calle deben coincidir en el silencio los dos votos.`,
        );
      }
    }
  }

  // --- Coherencia rama <-> reason_code <-> votos ---------------------------

  if (rama !== undefined && reasonCode !== undefined) {
    const admitidos = REASON_CODES_POR_RAMA[rama];
    if (!admitidos.includes(reasonCode)) {
      agregar(
        sink,
        "decision.branch",
        "incoherencia",
        `La rama "${rama}" no admite reason_code "${reasonCode}". Admite [${admitidos.join(", ")}].`,
        `Los caminos de ADR-014 NO pasan por la tabla OR: la degradacion no es un voto, es un cortocircuito hacia la alerta. Y escalateNow ni siquiera espera al bucle. Etiquetar mal la rama hace que el archivo de sesion cuente una historia que el flujo no tuvo (docs/Especificacion-Capa-Decision.md §9).`,
      );
    }
  }

  if (rama === "urgencia" && decision["votes"] !== undefined) {
    agregar(
      sink,
      "decision.votes",
      "incoherencia",
      `La rama es "urgencia" pero el resumen trae votos.`,
      `escalateNow produce Decision sin veredicto de suficiencia, sin bucle y sin capa determinista: en urgencia no hay votos que ponderar. Si hay votos, la rama no era urgencia (docs/Especificacion-Capa-Decision.md §9, docs/Especificacion-Capa-Determinista.md §6.1).`,
    );
  }

  if (rama !== undefined && rama !== "or" && escalate === false) {
    agregar(
      sink,
      "decision.escalate",
      "incoherencia",
      `La rama "${rama}" siempre alerta, pero escalate es false.`,
      `A la falla, actua humano: las tres condiciones de ADR-014 y la urgencia producen ALERTAR, no silencio. Un sistema de seguridad cuyo modo de fallo es el silencio no es un sistema de seguridad.`,
    );
  }
}

function validarVersiones(sink: IssueSink, valor: unknown): void {
  const versiones = exigirObjeto(
    sink,
    "versions",
    valor,
    "el bloque versions",
    `El resumen es autocontenido: sin las versiones de taxonomia, tabla VD y embeddings, una decision de hace un mes no se puede reproducir ni explicar (ADR-016).`,
  );
  if (!versiones) return;
  rechazarClavesDesconocidas(sink, "versions", versiones, ["domain_version", "vd_version", "embedding_model"], `${REF}`);
  exigirCadena(sink, "versions.domain_version", versiones["domain_version"], { noVacia: true, hint: `Version de la taxonomia determinista que produjo el reporte.` });
  exigirCadena(sink, "versions.vd_version", versiones["vd_version"], { noVacia: true, hint: `Version de la tabla de lectura del voto determinista. El VD es declarado y versionado, no inferido (ADR-013).` });
  exigirCadena(sink, "versions.embedding_model", versiones["embedding_model"], { noVacia: true, hint: `Con que modelo estaba construido el indice cuando se recupero la evidencia (ADR-015).` });
}

/** §8b.2 — comprueba que la politica de destinos se respete antes de entregar. */
export function validateSummaryDelivery(
  summary: unknown,
  destinations: unknown,
): ValidationResult {
  const sink: IssueSink = [];
  const destinos = exigirArreglo(sink, "destinations", destinations, {
    noVacio: true,
    hint: `Todo resumen va al menos a session_archive: es el registro auditable y la fuente del informe del reto (§8b.2).`,
  });
  if (!destinos) return resultado(sink);

  destinos.forEach((destino, i) => {
    exigirEnum(sink, `destinations[${i}]`, destino, DESTINOS, `Los dos destinos de §8b.2.`);
  });

  const lista = destinos.filter((d): d is string => typeof d === "string");

  if (!lista.includes("session_archive")) {
    agregar(
      sink,
      "destinations",
      "incoherencia",
      `session_archive no esta entre los destinos.`,
      `session_archive recibe TODO resumen, sin excepcion: es el registro auditable, la fuente del informe y lo que garantiza que el resumen no se pierda si alert_channel se cae (§8b.2).`,
    );
  }

  const objeto = summary;
  if (typeof objeto === "object" && objeto !== null) {
    const decision = (objeto as Record<string, unknown>)["decision"];
    if (typeof decision === "object" && decision !== null) {
      const escalate = (decision as Record<string, unknown>)["escalate"];
      if (escalate === true && !lista.includes("alert_channel")) {
        agregar(
          sink,
          "destinations",
          "incoherencia",
          `La decision escala pero el resumen no se envia a alert_channel.`,
          `Con escalate: true el resumen va tambien al canal del personal. Emitir la alerta y no entregar el caso deja al humano alertado sin sintomas, sin razon y sin fuentes (§8b.2).`,
        );
      }
    }
  }

  return resultado(sink);
}
