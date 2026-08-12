/**
 * WO-36 — correccion B2: la garantia de esquema la da el VALIDADOR, no el decodificador.
 *
 * `llama-3.3-70b-versatile` no admite `json_schema`, solo `json_object`: JSON valido
 * garantizado, conformidad con el esquema NO. La promesa de ADR-017 —"imposible por
 * construccion, no improbable por prompt"— no se cumple con el decodificador en la
 * ruta primaria, asi que sube una capa: de "el decodificador no puede emitir
 * invalido" a "EL SISTEMA NO PUEDE ACEPTAR INVALIDO".
 *
 * Lo verificable es exactamente eso, y es lo que se prueba aqui inyectando
 * respuestas malformadas: el sistema nunca las incorpora.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDecision, type ValidationResult } from "@techsphere/contracts";
import { AdaptadorNube, ErrorDeSalidaNoValidable, ErrorDeTransporte } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Arnes: un `fetch` de mentira que devuelve lo que la prueba le diga y guarda
// los cuerpos enviados, para poder mirar QUE se pidio y no solo que se recibio.
// ---------------------------------------------------------------------------

interface CuerpoEnviado {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format: { type: string };
  messages: Array<{ role: string; content: string }>;
}

function arnes(contenidos: string[], finishReason = "stop") {
  const enviados: CuerpoEnviado[] = [];
  let i = 0;
  const fetch_impl = (async (_url: string, init?: RequestInit) => {
    enviados.push(JSON.parse(String(init?.body)) as CuerpoEnviado);
    const content = contenidos[Math.min(i++, contenidos.length - 1)] ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { prompt_tokens: 400, completion_tokens: 30 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { enviados, fetch_impl };
}

interface Voto {
  reason: string;
  criticality: string;
  escalate: boolean;
}

/** Validador minimo, con la forma que WO-44 usara contra el crudo del VP. */
function validarVoto(crudo: unknown): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const o = crudo as Record<string, unknown> | null;
  if (typeof o?.["reason"] !== "string" || (o["reason"] as string).trim() === "") {
    issues.push({
      path: "reason",
      code: "vacio",
      message: "El voto llego sin razon.",
      hint: "Toda decision se explica: la razon y la evidencia viajan siempre juntas.",
    });
  }
  if (!["verde", "amarillo", "rojo"].includes(String(o?.["criticality"]))) {
    issues.push({
      path: "criticality",
      code: "valor_fuera_de_enum",
      message: `criticality llego como ${JSON.stringify(o?.["criticality"])}.`,
      hint: "Es la lectura ternaria de ADR-018: verde, amarillo o rojo.",
    });
  }
  if (typeof o?.["escalate"] !== "boolean") {
    issues.push({
      path: "escalate",
      code: "tipo_invalido",
      message: "escalate no es booleano.",
      hint: "Es la ACCION y es lo unico sobre lo que opera el ponderador OR.",
    });
  }
  return { valid: issues.length === 0, issues };
}

function adaptador(fetch_impl: typeof fetch, intentos = 2): AdaptadorNube {
  return new AdaptadorNube({
    ruta: "nube_groq",
    modelo: "llama-3.3-70b-versatile",
    api_key: "clave-de-prueba",
    fetch_impl,
    intentos,
  });
}

const PETICION = {
  rol: "decider" as const,
  sistema: "Eres el decisor clinico. Emite un voto.",
  prompt: "Caso: fiebre 38.4, herida con eritema creciente.",
  esquema: { type: "object", properties: { reason: { type: "string" } } },
  validar: validarVoto,
};

// ---------------------------------------------------------------------------
// Lo que el sistema SI acepta
// ---------------------------------------------------------------------------

test("una salida conforme se acepta al primer intento y trae sus tokens", async () => {
  const { fetch_impl } = arnes([
    JSON.stringify({ reason: "Eritema creciente con fiebre.", criticality: "rojo", escalate: true }),
  ]);

  const r = await adaptador(fetch_impl).generarEstructurado<Voto>(PETICION);

  assert.equal(r.valor.criticality, "rojo");
  assert.equal(r.intentos, 1);
  assert.deepEqual(r.tokens, { entrada: 400, salida: 30 });
  assert.equal(
    r.modo_esquema,
    "json_object",
    "se registra de donde vino la garantia en vez de disimularlo",
  );
});

// ---------------------------------------------------------------------------
// Lo que el sistema NUNCA incorpora
// ---------------------------------------------------------------------------

test("JSON valido pero disconforme se reintenta y, agotado, NO se incorpora", async () => {
  const disconforme = JSON.stringify({ reason: "", criticality: "gravisimo", escalate: "si" });
  const { enviados, fetch_impl } = arnes([disconforme, disconforme]);

  await assert.rejects(
    () => adaptador(fetch_impl).generarEstructurado<Voto>(PETICION),
    (e: unknown) => {
      assert.ok(e instanceof ErrorDeSalidaNoValidable);
      assert.equal(e.intentos, 2, "el reintento es ACOTADO, no indefinido");
      assert.equal(e.issues.length, 3);
      assert.equal(
        e.ultimo_crudo,
        disconforme,
        "el crudo del ultimo intento sobrevive para el ledger: la evidencia no se destruye (ADR-004)",
      );
      return true;
    },
  );

  assert.equal(enviados.length, 2);
  assert.match(
    String(enviados[1]?.messages[1]?.content),
    /no cumplio el contrato/,
    "el reintento lleva el error de esquema encima, o es el mismo intento otra vez",
  );
});

test("texto que no es JSON tampoco entra", async () => {
  const { fetch_impl } = arnes(["Claro, aqui tienes el voto: el paciente esta grave."]);
  await assert.rejects(
    () => adaptador(fetch_impl).generarEstructurado<Voto>(PETICION),
    ErrorDeSalidaNoValidable,
  );
});

test("una respuesta truncada se nombra truncamiento, no JSON invalido", async () => {
  const { fetch_impl } = arnes(['{"reason":"el paciente presenta un eritema que', '{"reason":"idem'], "length");
  await assert.rejects(
    () => adaptador(fetch_impl).generarEstructurado<Voto>(PETICION),
    (e: unknown) => {
      assert.ok(e instanceof ErrorDeSalidaNoValidable);
      assert.match(
        e.issues[0]?.message ?? "",
        /se corto por el techo/,
        "culpar al modelo de un JSON cortado es culparlo de algo que es del decodificador (H7)",
      );
      return true;
    },
  );
});

test("un intento que falla y otro que acierta: se acepta el bueno y se cuenta el costo de los dos", async () => {
  const { fetch_impl } = arnes([
    JSON.stringify({ reason: "x", criticality: "gris", escalate: 1 }),
    JSON.stringify({ reason: "Eritema creciente con fiebre.", criticality: "rojo", escalate: true }),
  ]);

  const r = await adaptador(fetch_impl).generarEstructurado<Voto>(PETICION);

  assert.equal(r.intentos, 2);
  assert.deepEqual(r.tokens, { entrada: 800, salida: 60 }, "el reintento se paga y se mide");
});

// ---------------------------------------------------------------------------
// La costura con el validador REAL del modulo de contratos
// ---------------------------------------------------------------------------

test("un validador del modulo de contratos se enchufa sin adaptarlo", async () => {
  // La firma pide `(crudo) => ValidationResult`, que es exactamente lo que devuelven
  // los validadores compartidos: no hay conversion en medio donde perder problemas.
  const incoherente = JSON.stringify({
    escalate: false,
    criticality: "verde",
    reason: "Todo bien.",
    reason_code: "contexto_incompleto",
    say_to_patient: "Siga con los cuidados.",
    traces: { doc_ids: [], rules_fired: [] },
    context_complete: false,
  });
  const { fetch_impl } = arnes([incoherente, incoherente]);

  await assert.rejects(
    () => adaptador(fetch_impl).generarEstructurado({ ...PETICION, validar: validateDecision }),
    (e: unknown) => {
      assert.ok(e instanceof ErrorDeSalidaNoValidable);
      assert.ok(
        e.issues.some((i) => i.code === "incoherencia"),
        "el contrato ya sabe que un contexto incompleto no puede terminar en silencio (ADR-014)",
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Como se arma la peticion (ADR-021, ADR-023)
// ---------------------------------------------------------------------------

test("el decider va a temperatura 0 y el esquema viaja en el prefijo estable", async () => {
  const { enviados, fetch_impl } = arnes([
    JSON.stringify({ reason: "Sin hallazgos.", criticality: "verde", escalate: false }),
  ]);
  await adaptador(fetch_impl).generarEstructurado<Voto>(PETICION);

  const cuerpo = enviados[0]!;
  assert.equal(cuerpo.temperature, 0);
  assert.equal(cuerpo.model, "llama-3.3-70b-versatile");
  assert.equal(cuerpo.response_format.type, "json_object");
  assert.equal(cuerpo.messages[0]?.role, "system");
  assert.ok(
    String(cuerpo.messages[0]?.content).includes(JSON.stringify(PETICION.esquema)),
    "sin json_schema, el esquema tiene que ir en el mensaje; va en el PREFIJO, que es lo que cachea (ADR-023)",
  );
  assert.equal(
    String(cuerpo.messages[1]?.content),
    PETICION.prompt,
    "la cola volatil es el prompt y nada mas: interpolar arriba mata la cache",
  );
});

test("el prefijo estable no cambia entre llamadas; solo cambia la cola", async () => {
  const bueno = JSON.stringify({ reason: "Sin hallazgos.", criticality: "verde", escalate: false });
  const { enviados, fetch_impl } = arnes([bueno]);
  const a = adaptador(fetch_impl);

  await a.generarEstructurado<Voto>(PETICION);
  await a.generarEstructurado<Voto>({ ...PETICION, prompt: "Otro caso distinto." });

  assert.equal(
    enviados[0]?.messages[0]?.content,
    enviados[1]?.messages[0]?.content,
    "byte a byte identico entre turnos: un token distinto arriba devuelve el prefill a cero cache",
  );
  assert.notEqual(enviados[0]?.messages[1]?.content, enviados[1]?.messages[1]?.content);
});

// ---------------------------------------------------------------------------
// El transporte: todo timeout es finito y su expiracion NO es un reintento eterno
// ---------------------------------------------------------------------------

test("un HTTP no-2xx sale como error de transporte, con el status", async () => {
  const fetch_impl = (async () =>
    ({
      ok: false,
      status: 429,
      text: async () => "rate limit: try again in 4.2s",
    }) as unknown as Response) as unknown as typeof fetch;

  await assert.rejects(
    () => adaptador(fetch_impl).generarEstructurado<Voto>(PETICION),
    (e: unknown) => {
      assert.ok(e instanceof ErrorDeTransporte);
      assert.equal(e.status, 429);
      return true;
    },
  );
});
