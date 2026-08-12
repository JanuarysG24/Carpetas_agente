#!/usr/bin/env node
/**
 * Backend MINIMO de prueba para la capa conversacional SOLA.
 *
 * A proposito NO invoca: la capa de decision (Orquestador/DecisionEngineNube),
 * el RAG, ni el escalamiento. Solo pide prestado `buildFrameGenerico` de
 * `@techsphere/decision` porque es pura estructura — el catalogo de las 6
 * unidades del dominio + su lexico regional real, sin ningun criterio clinico —
 * para tener algo real sobre que conversar en vez de un marco inventado a mano.
 *
 * Uso:
 *   GROQ_API_KEY=... npm start
 *   abrir http://localhost:8787
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  cargarMarco,
  cerrarPendientesPorCorte,
  conducirTurno,
  crearMotorDeNube,
  elegirActo,
  iniciarSesion,
  unidadesParaEntrega,
} from "@techsphere/conversational";
import { buildFrameGenerico, MODELOS_PERMITIDOS } from "@techsphere/decision";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO ?? 8787);

/**
 * Carga `.env` si existe. Existe porque la sintaxis `CLAVE=valor npm start` es de
 * bash y NO funciona en PowerShell ni en cmd, que es donde esto se va a correr:
 * un arranque que depende del shell del que arranca es justo lo que hace fallar
 * la compuerta G2 ("levantar en ≤15 min siguiendo el README"). Con `.env` el
 * comando es el mismo en las tres shells.
 */
function cargarDotEnv() {
  const ruta = join(AQUI, ".env");
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (limpia === "" || limpia.startsWith("#")) continue;
    const i = limpia.indexOf("=");
    if (i < 0) continue;
    const clave = limpia.slice(0, i).trim();
    const valor = limpia.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(clave in process.env)) process.env[clave] = valor; // el entorno real gana sobre el archivo
  }
}
cargarDotEnv();

// La UNICA constante de modelo del repositorio vive en decision/src/modelo/rutas.ts.
// Aqui solo se LEE de ahi — nunca se retipea el nombre (regla de §8 del plan de trabajo).
const MODELO = MODELOS_PERMITIDOS.nube_groq[0];
const CLAVE_CRUDA = (process.env.GROQ_API_KEY ?? "").trim();
// Un marcador de posicion sin reemplazar NO es una credencial: tratarlo como si
// lo fuera cambia un aviso claro al arrancar por un 401 opaco en mitad de la demo.
const API_KEY = /^(pega_aqui|tu_clave|clave-)/i.test(CLAVE_CRUDA) ? "" : CLAVE_CRUDA;

if (!API_KEY) {
  console.warn(
    "\n⚠  Falta la clave. El servidor arranca igual, pero hablar va a fallar.\n" +
      `   Abre el archivo .env que esta en ${AQUI}\n` +
      "   y pega tu clave de Groq despues del signo =  (linea GROQ_API_KEY=).\n" +
      "   Luego para el servidor con Ctrl+C y vuelve a correr:  npm start\n",
  );
}

const motor = API_KEY
  ? crearMotorDeNube({ modelo: MODELO, api_key: API_KEY })
  : null;

// ---------------------------------------------------------------------------
// Voz -> texto. Whisper Large v3 en Groq (misma clave, misma ruta de nube):
// es la unica pieza de la interfaz de voz que ya se puede cablear sin decidir
// nada de TTS todavia. HTTP plano, sin SDK, igual que el resto del proyecto.
// ---------------------------------------------------------------------------

async function transcribir(bufferAudio, tipoMime) {
  const forma = new FormData();
  const extension = tipoMime.includes("ogg") ? "ogg" : tipoMime.includes("wav") ? "wav" : "webm";
  forma.append("file", new Blob([bufferAudio], { type: tipoMime }), `turno.${extension}`);
  forma.append("model", "whisper-large-v3");
  forma.append("language", "es");
  forma.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: forma,
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`Whisper (Groq) respondio ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  const datos = await res.json();
  return datos.text ?? "";
}

// ---------------------------------------------------------------------------
// Una sola sesion en memoria: esta es una herramienta de prueba local para UNA
// persona probando en su navegador, no un servidor multi-paciente.
// ---------------------------------------------------------------------------

let estado = null;
let saludoInicial = null;

async function nuevaSesion() {
  const sessionId = randomUUID();
  const frame = buildFrameGenerico(sessionId);
  let s = cargarMarco(iniciarSesion(sessionId), frame);

  // El agente es quien llama: abre la conversacion con un saludo fijo (determinista,
  // no generado) + la primera pregunta real, redactada por el motor a partir del
  // primer acto que elegiria el motor de estados sin ningun turno del paciente aun.
  const primerActo = elegirActo(s.unidades, s.orden, false, false, null);
  let primeraPregunta = "";
  if (primerActo && motor) {
    primeraPregunta = await motor.render({
      act: { act: primerActo.act, unit_id: primerActo.unit_id, ...(primerActo.hint ? { hint: primerActo.hint } : {}) },
      state: { global: 0, frame_health: 0, retroactive_cycle: false, identity: "identificado" },
    });
  }

  const saludo = "¡Aló, buenas! Le habla su agente de seguimiento después de la cirugía. Le voy a hacer unas preguntas rápidas sobre cómo se ha sentido, ¿le parece bien?";
  saludoInicial = primeraPregunta ? `${saludo} ${primeraPregunta}` : saludo;
  estado = s;
  return { estado: s, saludo: saludoInicial };
}

function proyectarEstado(s) {
  const unidades = [...s.unidades.values()].map((u) => ({
    id: u.spec.id,
    intent: u.spec.intent,
    priority: u.spec.priority,
    extraction: u.extraction,
    tocada: u.tocada,
    state: u.state,
    confidence: u.confidence,
    raw: u.raw,
    normalized: u.normalized,
    coverage_met: u.coverage_met,
    cause: u.cause ?? null,
    closure: u.closure ?? null,
  }));
  return {
    session_id: s.session_id,
    phase: s.phase,
    turno: s.turno,
    global_state: s.global_state,
    retroactive_cycle: s.retroactive_cycle,
    red_flag: s.red_flag,
    transcript: s.transcript,
    unidades,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

async function servirEstatico(res, ruta) {
  try {
    const cuerpo = await readFile(join(AQUI, "public", ruta));
    res.writeHead(200, { "Content-Type": TIPOS[extname(ruta)] ?? "application/octet-stream" });
    res.end(cuerpo);
  } catch {
    res.writeHead(404);
    res.end("no encontrado");
  }
}

function json(res, code, valor) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(valor));
}

async function leerCuerpo(req) {
  const trozos = [];
  for await (const trozo of req) trozos.push(trozo);
  const texto = Buffer.concat(trozos).toString("utf8");
  return texto ? JSON.parse(texto) : {};
}

async function leerCuerpoBinario(req) {
  const trozos = [];
  for await (const trozo of req) trozos.push(trozo);
  return Buffer.concat(trozos);
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") return servirEstatico(res, "index.html");
    if (req.method === "GET" && url.pathname.startsWith("/estatico/")) {
      return servirEstatico(res, url.pathname.replace("/estatico/", ""));
    }

    if (req.method === "POST" && url.pathname === "/api/transcribir") {
      if (!API_KEY) return json(res, 500, { error: "Falta GROQ_API_KEY. Crea un archivo .env en la carpeta interfaz-conversacional con la línea: GROQ_API_KEY=tu_clave — y reinicia npm start." });
      const audio = await leerCuerpoBinario(req);
      if (audio.length === 0) return json(res, 400, { error: "Audio vacio." });
      try {
        const texto = await transcribir(audio, req.headers["content-type"] ?? "audio/webm");
        return json(res, 200, { texto });
      } catch (e) {
        return json(res, 502, { error: String(e?.message ?? e) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/reiniciar") {
      const { saludo } = await nuevaSesion();
      return json(res, 200, { saludo, estado: proyectarEstado(estado) });
    }

    if (req.method === "GET" && url.pathname === "/api/estado") {
      if (!estado) await nuevaSesion();
      return json(res, 200, { saludo: saludoInicial, estado: proyectarEstado(estado) });
    }

    if (req.method === "POST" && url.pathname === "/api/turno") {
      if (!motor) return json(res, 500, { error: "Falta GROQ_API_KEY. Crea un archivo .env en la carpeta interfaz-conversacional con la línea: GROQ_API_KEY=tu_clave — y reinicia npm start." });
      if (!estado) await nuevaSesion();
      if (estado.phase === "F5") {
        return json(res, 200, { say: null, fase: "F5", terminado: true, estado: proyectarEstado(estado) });
      }

      const { texto } = await leerCuerpo(req);
      if (typeof texto !== "string" || texto.trim() === "") {
        return json(res, 400, { error: "Falta 'texto' en el cuerpo." });
      }

      const turno = estado.turno + 1;
      const r = await conducirTurno(estado, texto, motor, turno);
      estado = r.estado;

      let cerrado = false;
      if (estado.phase === "F5" && estado.red_flag) {
        // Interrupcion prioritaria: aqui NO se invoca escalateNow (eso es de
        // decision, fuera de alcance de esta prueba). Se cierra por corte con
        // causa tipificada, que es lo que le corresponde a esta capa sola.
        estado = cerrarPendientesPorCorte(estado, "bloqueado_por_urgencia");
        cerrado = true;
      } else if (estado.phase === "F5") {
        estado = cerrarPendientesPorCorte(estado, "interrumpido");
        cerrado = true;
      }

      return json(res, 200, {
        say: r.say,
        acto: r.acto,
        fase: estado.phase,
        terminado: estado.phase === "F5",
        red_flag: estado.red_flag,
        cierre: cerrado ? unidadesParaEntrega(estado) : null,
        estado: proyectarEstado(estado),
      });
    }

    res.writeHead(404);
    res.end("no encontrado");
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`\nInterfaz conversacional de prueba: http://localhost:${PUERTO}`);
  console.log(`Modelo: ${MODELO} (ruta nube_groq)\n`);
});
