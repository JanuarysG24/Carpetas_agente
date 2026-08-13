
const $mensajes = document.getElementById("mensajes");
const $texto = document.getElementById("texto");
const $enviar = document.getElementById("enviar");
const $reiniciar = document.getElementById("reiniciar");
const $fase = document.getElementById("fase");
const $unidades = document.getElementById("unidades");
const $banderaRoja = document.getElementById("bandera-roja");
const $microfono = document.getElementById("microfono");
const $estadoVoz = document.getElementById("estado-voz");
const $decision = document.getElementById("decision");
const $conocimientoEstado = document.getElementById("conocimiento-estado");
const $listaDocumentos = document.getElementById("lista-documentos");
const $formSubir = document.getElementById("form-subir");
const $conocimientoMsg = document.getElementById("conocimiento-msg");

// ---------------------------------------------------------------------------
// Chat + panel de estado
// ---------------------------------------------------------------------------

function agregarMensaje(texto, clase, latenciaMs, ladoLatencia) {
  const div = document.createElement("div");
  div.className = "msg " + clase;
  div.textContent = texto;
  $mensajes.appendChild(div);
  if (latenciaMs !== undefined) {
    const l = document.createElement("div");
    l.className = "latencia" + (ladoLatencia === "paciente" ? " paciente-lado" : "");
    l.textContent = `${latenciaMs} ms`;
    $mensajes.appendChild(l);
  }
  $mensajes.scrollTop = $mensajes.scrollHeight;
}

function pintarUnidades(estado) {
  $fase.textContent = `fase: ${estado.phase} · turno: ${estado.turno} · estado global: ${estado.global_state}`;
  if (estado.red_flag) {
    $banderaRoja.style.display = "block";
    $banderaRoja.textContent = `⚠ bandera roja: ${estado.red_flag.red_flag_id} — "${estado.red_flag.utterance}"`;
  } else {
    $banderaRoja.style.display = "none";
  }
  $unidades.innerHTML = "";
  for (const u of estado.unidades) {
    const div = document.createElement("div");
    div.className = "unidad";
    div.innerHTML = `
      <div class="fila-1"><span class="id">${u.id}</span><span class="extraction ${u.extraction}">${u.extraction}</span></div>
      <div class="detalle"><b>raw:</b> ${u.raw ?? "—"}</div>
      <div class="detalle"><b>normalized:</b> ${u.normalized === null ? "null" : JSON.stringify(u.normalized)}</div>
      <div class="detalle"><b>state:</b> ${u.state} · <b>confidence:</b> ${u.confidence.toFixed(2)} · <b>cobertura:</b> ${u.coverage_met.join(", ") || "—"}</div>
      ${u.cause ? `<div class="detalle"><b>cause:</b> ${u.cause} · <b>closure:</b> ${u.closure ?? "—"}</div>` : ""}
    `;
    $unidades.appendChild(div);
  }
}

// ---------------------------------------------------------------------------
// Decisión — Paso 4: lo que devuelve la capa de decisión al cerrar la llamada.
// ---------------------------------------------------------------------------

function pintarDecision(decisionResultado) {
  if (!decisionResultado) return;
  $decision.style.display = "block";
  if (decisionResultado.error) {
    $decision.className = "rojo";
    $decision.innerHTML = `<div class="criticidad">Decisión no disponible</div><div class="reason">${decisionResultado.error}</div>`;
    return;
  }
  const d = decisionResultado.decision;
  if (!d) {
    $decision.className = "amarillo";
    $decision.innerHTML = `<div class="criticidad">Sin decisión (rondas agotadas)</div>`;
    return;
  }
  $decision.className = d.criticality;
  $decision.innerHTML = `
    <div class="criticidad">${d.criticality} — ${d.escalate ? "ESCALA a personal" : "no escala"}</div>
    <div class="reason">${d.reason}</div>
    <div class="trazas">reason_code: <code>${d.reason_code}</code> · rules_fired: ${d.traces.rules_fired.map((x) => `<code>${x}</code>`).join(", ") || "—"} · doc_ids: ${d.traces.doc_ids.map((x) => `<code>${x}</code>`).join(", ") || "—"}</div>
    <div class="reason" style="margin-top:8px"><b>Al paciente:</b> "${d.say_to_patient}"</div>
  `;
}

// ---------------------------------------------------------------------------
// Conocimiento — compuerta 5: subir y retirar documentos en caliente.
// ---------------------------------------------------------------------------

async function cargarConocimiento() {
  try {
    const [estado, lista] = await Promise.all([
      fetch("/api/conocimiento/estado").then((r) => r.json()),
      fetch("/api/conocimiento/lista").then((r) => r.json()),
    ]);
    $conocimientoEstado.textContent = `${estado.docs} documentos · ${estado.chunks} fragmentos · ${estado.embedding_model}`;
    $listaDocumentos.innerHTML = "";
    for (const doc of lista.documentos) {
      const fila = document.createElement("div");
      fila.className = "doc-fila" + (doc.status === "retired" ? " retired" : "");
      fila.innerHTML = `<span class="doc-info"><b>${doc.title}</b> · ${doc.kind} · ${doc.status}</span>`;
      if (doc.status !== "retired") {
        const btn = document.createElement("button");
        btn.textContent = "Retirar";
        btn.onclick = () => retirarDocumento(doc.doc_id);
        fila.appendChild(btn);
      }
      $listaDocumentos.appendChild(fila);
    }
  } catch (e) {
    $conocimientoEstado.textContent = "No se pudo cargar (¿está corriendo el servidor?).";
  }
}

async function retirarDocumento(doc_id) {
  const r = await fetch("/api/conocimiento/retirar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_id }),
  }).then((r) => r.json());
  $conocimientoMsg.textContent = r.ok ? `Retirado: ${doc_id}. Ya no se recupera.` : "Error: " + r.error;
  await cargarConocimiento();
}

$formSubir.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const title = document.getElementById("docTitulo").value.trim();
  const kind = document.getElementById("docKind").value;
  const body = document.getElementById("docCuerpo").value.trim();
  if (!title || !body) return;
  const doc_id = "consola-" + title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 60) + "-" + Date.now().toString(36);
  $conocimientoMsg.textContent = "Subiendo…";
  try {
    const r = await fetch("/api/conocimiento/subir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id, title, kind, body }),
    }).then((r) => r.json());
    if (r.error) {
      $conocimientoMsg.textContent = "Rechazado: " + r.error;
    } else {
      $conocimientoMsg.textContent = `Ingerido: ${r.doc_id} (${r.chunks} fragmentos). Ya se puede recuperar.`;
      $formSubir.reset();
    }
  } catch (e) {
    $conocimientoMsg.textContent = "Error de red al subir.";
  }
  await cargarConocimiento();
});

// ---------------------------------------------------------------------------
// Texto -> voz (TTS). Voz del sistema operativo por ahora — es lo que el
// propio plan del reto recomienda para el primer día: cierra el ciclo ya,
// se cambia despues por Piper/Kokoro sin tocar nada de esto.
// ---------------------------------------------------------------------------

let vozEspanol = null;
function elegirVoz() {
  const voces = speechSynthesis.getVoices();
  vozEspanol =
    voces.find((v) => /es[-_](CO|MX|419)/i.test(v.lang)) ||
    voces.find((v) => v.lang?.toLowerCase().startsWith("es")) ||
    null;
}
speechSynthesis.onvoiceschanged = elegirVoz;
elegirVoz();

/** Habla el texto y devuelve cuando EMPIEZA a sonar (para medir latencia real). */
function hablar(texto) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !texto) return resolve(null);
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = vozEspanol?.lang ?? "es-ES";
    if (vozEspanol) u.voice = vozEspanol;
    u.rate = 1.0;
    u.onstart = () => resolve(performance.now());
    u.onerror = () => resolve(null);
    speechSynthesis.cancel(); // no encimar turnos
    speechSynthesis.speak(u);
  });
}

// ---------------------------------------------------------------------------
// Voz -> texto (STT). Push-to-talk: mantener presionado graba, soltar envia
// a /api/transcribir (Whisper large-v3 en Groq). Es la salida segura que
// recomienda el plan: en una demo en vivo, el control manual nunca falla.
// ---------------------------------------------------------------------------

let grabadora = null;
let trozosAudio = [];
let tFinDeHabla = 0;

async function empezarGrabacion(ev) {
  ev.preventDefault();
  if (grabadora) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    trozosAudio = [];
    grabadora = new MediaRecorder(stream);
    grabadora.ondataavailable = (e) => { if (e.data.size > 0) trozosAudio.push(e.data); };
    grabadora.start();
    $microfono.classList.add("grabando");
    $microfono.textContent = "🔴 Grabando… suelte para enviar";
    $estadoVoz.textContent = "";
  } catch (e) {
    $estadoVoz.textContent = "No se pudo acceder al micrófono: " + e.message;
  }
}

async function pararGrabacion(ev) {
  ev.preventDefault();
  if (!grabadora || grabadora.state === "inactive") return;
  const tipoMime = grabadora.mimeType || "audio/webm";
  const listo = new Promise((resolve) => { grabadora.onstop = resolve; });
  grabadora.stop();
  grabadora.stream.getTracks().forEach((t) => t.stop());
  await listo;
  tFinDeHabla = performance.now();

  $microfono.classList.remove("grabando");
  $microfono.disabled = true;
  $microfono.textContent = "⏳ transcribiendo…";
  grabadora = null;

  const blob = new Blob(trozosAudio, { type: tipoMime });
  if (blob.size < 500) {
    $microfono.disabled = false;
    $microfono.textContent = "🎤 Mantener presionado para hablar";
    $estadoVoz.textContent = "Grabación muy corta, no se envió.";
    return;
  }

  try {
    const r = await fetch("/api/transcribir", {
      method: "POST",
      headers: { "Content-Type": tipoMime },
      body: blob,
    }).then((r) => r.json());

    if (r.error) {
      $estadoVoz.textContent = "Error de transcripción: " + r.error;
    } else {
      const msTranscripcion = Math.round(performance.now() - tFinDeHabla);
      $estadoVoz.textContent = `transcrito en ${msTranscripcion} ms`;
      await enviarTexto(r.texto, true);
    }
  } catch (e) {
    $estadoVoz.textContent = "Error de red";
    agregarMensaje(diagnosticarRed(e), "sistema");
  } finally {
    $microfono.disabled = false;
    $microfono.textContent = "🎤 Mantener presionado para hablar";
  }
}

$microfono.addEventListener("mousedown", empezarGrabacion);
$microfono.addEventListener("touchstart", empezarGrabacion);
["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) =>
  $microfono.addEventListener(ev, pararGrabacion),
);

// ---------------------------------------------------------------------------
// El turno: comun a voz y a texto.
// ---------------------------------------------------------------------------

/**
 * "Failed to fetch" no dice nada util por si solo. Estas son las dos causas
 * reales, y se distinguen antes de intentar la peticion.
 */
function diagnosticarRed(e) {
  if (location.protocol === "file:") {
    return (
      "La página se abrió como archivo (file://), no desde el servidor. " +
      "El navegador no puede llamar a /api/... así. Arranca el servidor con " +
      "`GROQ_API_KEY=tu_clave npm start` y abre http://localhost:8787 en la barra de direcciones."
    );
  }
  if (e && /failed to fetch|networkerror|load failed/i.test(e.message)) {
    return (
      "No hay nadie escuchando en " + location.origin + ". El servidor no está corriendo o se cayó. " +
      "Revisa la terminal donde corriste `npm start`: si dice ERR_MODULE_NOT_FOUND, faltan los enlaces " +
      "entre paquetes (ver README)."
    );
  }
  return "Error de red: " + (e?.message ?? e);
}

async function iniciar() {
  $mensajes.innerHTML = "";
  $decision.style.display = "none";
  if (location.protocol === "file:") {
    agregarMensaje(diagnosticarRed(null), "sistema");
    return;
  }
  try {
    const r = await fetch("/api/reiniciar", { method: "POST" }).then((r) => r.json());
    if (r.error) { agregarMensaje("Error: " + r.error, "sistema"); return; }
    agregarMensaje(r.saludo, "agente");
    await hablar(r.saludo);
    pintarUnidades(r.estado);
  } catch (e) {
    agregarMensaje(diagnosticarRed(e), "sistema");
  }
}

/**
 * @param {string} texto lo dicho por el paciente (transcrito o escrito).
 * @param {boolean} esVoz si viene de voz, la latencia se mide desde que dejo de hablar (t_fin_de_habla), no desde el envio HTTP.
 */
async function enviarTexto(texto, esVoz) {
  texto = (texto ?? "").trim();
  if (!texto) return;
  agregarMensaje(texto, "paciente");
  const t0 = esVoz ? tFinDeHabla : performance.now();
  try {
    const r = await fetch("/api/turno", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    }).then((r) => r.json());

    if (r.error) {
      agregarMensaje("Error: " + r.error, "sistema");
      return;
    }
    if (r.say) {
      agregarMensaje(r.say, "agente");
      const tHabloEn = await hablar(r.say);
      const ms = Math.round((tHabloEn ?? performance.now()) - t0);
      agregarMensaje(
        esVoz ? `latencia fin-de-habla → inicio-de-respuesta: ${ms} ms` : `latencia: ${ms} ms`,
        "sistema",
      );
    }
    if (r.terminado) agregarMensaje("— la sesión terminó: se cerró todo lo pendiente por corte —", "sistema");
    if (r.decision) {
      pintarDecision(r.decision);
      if (r.decision.decision) agregarMensaje(r.decision.decision.say_to_patient, "sistema");
    }
    pintarUnidades(r.estado);
  } catch (e) {
    agregarMensaje(diagnosticarRed(e), "sistema");
  }
}

async function enviarDesdeTexto() {
  const texto = $texto.value.trim();
  if (!texto) return;
  $texto.value = "";
  $enviar.disabled = true;
  try {
    await enviarTexto(texto, false);
  } finally {
    $enviar.disabled = false;
    $texto.focus();
  }
}

$enviar.addEventListener("click", enviarDesdeTexto);
$texto.addEventListener("keydown", (e) => { if (e.key === "Enter") enviarDesdeTexto(); });
$reiniciar.addEventListener("click", iniciar);

iniciar();
cargarConocimiento();
