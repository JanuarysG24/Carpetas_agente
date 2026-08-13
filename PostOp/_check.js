
"use strict";
/* ══════════════════════════════════════════════════════════════════════════
   Source Meridian — plantilla de chat de voz.
   Motor idéntico al de index.html (mismo dominio, mismo prompt, misma
   recuperación BM25, mismo motor de decisión). Solo cambia la piel: aquí
   la entrada es un botón de "mantener presionado" en vez de texto + toggle.
   ══════════════════════════════════════════════════════════════════════════ */

/* ─── 1 · DOMINIO — el voto determinista ──────────────────────────────── */

const DOMINIO_V = "postop-0.1.0";

const UNIDADES = {
  fiebre:           { et:"Fiebre",    u:"°C" },
  dolor_intensidad: { et:"Dolor",     u:"/10" },
  aspecto_herida:   { et:"Herida",    vals:["normal","eritema_leve","secrecion_purulenta","dehiscencia"] },
  movilidad:        { et:"Movilidad", vals:["normal","limitada_esperada","incapacitante_nueva"] },
  apetito:          { et:"Apetito",   vals:["normal","levemente_disminuido","muy_disminuido"] },
  sueno:            { et:"Sueño",     vals:["normal","levemente_alterado","muy_alterado"] }
};

function clasificar(u, v) {
  if (v === null || v === undefined || v === "") return null;
  const cat = (mapa) => mapa[v] || { clase:"no_clasificable", regla:"FALLBACK" };
  switch (u) {
    case "fiebre": {
      const n = Number(String(v).replace(",", "."));
      if (!isFinite(n)) return { clase:"no_clasificable", regla:"FALLBACK" };
      return n >= 37.9 ? { clase:"respuesta_sistemica", regla:"FC-FIE-01" }
                       : { clase:"sin_compromiso",      regla:"FC-FIE-02" };
    }
    case "dolor_intensidad": {
      const n = Number(v);
      if (!isFinite(n)) return { clase:"no_clasificable", regla:"FALLBACK" };
      return n >= 5 ? { clase:"funcionalidad_local_alterada", regla:"FC-DOL-01" }
                    : { clase:"sin_compromiso",               regla:"FC-DOL-02" };
    }
    case "aspecto_herida": return cat({
      secrecion_purulenta:{clase:"estructura_declarada", regla:"FC-HER-01"},
      dehiscencia:        {clase:"estructura_declarada", regla:"FC-HER-02"},
      eritema_leve:       {clase:"estructura_incipiente",regla:"FC-HER-03"},
      normal:             {clase:"sin_compromiso",       regla:"FC-HER-04"}});
    case "movilidad": return cat({
      incapacitante_nueva:{clase:"funcionalidad_local_perdida",regla:"FC-MOV-01"},
      limitada_esperada:  {clase:"sin_compromiso",             regla:"FC-MOV-02"},
      normal:             {clase:"sin_compromiso",             regla:"FC-MOV-03"}});
    case "apetito": return cat({
      muy_disminuido:      {clase:"integridad_cedida",regla:"FC-APE-01"},
      levemente_disminuido:{clase:"sin_compromiso",   regla:"FC-APE-02"},
      normal:              {clase:"sin_compromiso",   regla:"FC-APE-03"}});
    case "sueno": return cat({
      muy_alterado:      {clase:"integridad_cedida",regla:"FC-SUE-01"},
      levemente_alterado:{clase:"sin_compromiso",   regla:"FC-SUE-02"},
      normal:            {clase:"sin_compromiso",   regla:"FC-SUE-03"}});
  }
  return { clase:"no_clasificable", regla:"FALLBACK" };
}

function componer(cl) {
  const h = [];
  const ced = ["apetito","sueno"].filter(u => cl[u]?.clase === "integridad_cedida");
  if (ced.length >= 2) h.push({ clase:"integridad_comprometida", regla:"CO-01", or:ced });
  if (h.length && cl.fiebre?.clase === "respuesta_sistemica")
    h.push({ clase:"convergencia_sistemica", regla:"CO-02", or:["apetito","sueno","fiebre"] });
  return h;
}

function leerVD(p) {
  if (p.has("convergencia_sistemica"))  return { lectura:"rojo",     regla:"VD-01" };
  if (p.has("estructura_declarada"))    return { lectura:"rojo",     regla:"VD-02" };
  if (p.has("integridad_comprometida")) return { lectura:"amarillo", regla:"VD-03" };
  if (p.has("estructura_incipiente"))   return { lectura:"amarillo", regla:"VD-04" };
  return { lectura:"verde", regla:"VD-05" };
}

function votoDeterminista(val) {
  const t0 = performance.now(), cl = {}, reglas = [], sinEval = [];
  for (const u of Object.keys(UNIDADES)) {
    const c = clasificar(u, val[u]);
    if (!c) { sinEval.push(u); continue; }
    cl[u] = c; reglas.push(`${c.regla} · ${u}=${val[u]} → ${c.clase}`);
  }
  const comps = componer(cl);
  comps.forEach(c => reglas.push(`${c.regla} · ${c.or.join(" + ")} → ${c.clase}`));
  const pres = new Set([...Object.values(cl).map(c => c.clase), ...comps.map(c => c.clase)]);
  return { ...leerVD(pres), reglas, clases:cl, sinEval, ms:(performance.now()-t0).toFixed(3) };
}

function ponderar(vp, vd) {
  const o = { verde:0, amarillo:1, rojo:2 };
  const crit = o[vp] >= o[vd] ? vp : vd;
  return { criticidad:crit, escalar:crit !== "verde" };
}

/* ─── 2 · RECUPERACIÓN — BM25 sobre el corpus ─────────────────────────── */

const VACIAS = new Set(("de la que el en y a los del se las por un para con no una su al lo como mas " +
  "pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien " +
  "desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos " +
  "the of and to in a is for with on that as by are be this it from or an at was were which").split(" "));

const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokenizar = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !VACIAS.has(t));

const KB = { docs:new Map(), frags:[], idf:new Map(), avgdl:0, listo:false };

function indexar() {
  const df = new Map(); let total = 0;
  KB.frags.forEach(f => {
    f.tk = tokenizar(f.x);
    f.tf = new Map();
    f.tk.forEach(t => f.tf.set(t, (f.tf.get(t) || 0) + 1));
    total += f.tk.length;
    new Set(f.tk).forEach(t => df.set(t, (df.get(t) || 0) + 1));
  });
  KB.avgdl = KB.frags.length ? total / KB.frags.length : 1;
  KB.idf.clear();
  const N = KB.frags.length;
  df.forEach((n, t) => KB.idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5))));
  KB.listo = true;
}

function recuperar(consulta, k = 3) {
  if (!KB.listo || !KB.frags.length) return [];
  const q = [...new Set(tokenizar(consulta))];
  if (!q.length) return [];
  const k1 = 1.2, b = 0.75;
  const puntuados = KB.frags.map(f => {
    let s = 0, casados = 0;
    for (const t of q) {
      const tf = f.tf.get(t); if (!tf) continue;
      casados++;
      const idf = KB.idf.get(t) || 0;
      s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * f.tk.length / KB.avgdl));
    }
    return { f, s, frac: casados / q.length };
  });
  return puntuados.filter(p => p.s > 0 && p.frac >= 0.34)
                  .sort((a, b) => b.s - a.s).slice(0, k)
                  .map(p => ({ doc_id:p.f.d, titulo:KB.docs.get(p.f.d)?.t || p.f.d,
                               texto:p.f.x, score:p.s.toFixed(2) }));
}

function cargarCorpus() {
  try {
    const crudo = document.getElementById("corpus-embebido").textContent.trim();
    if (!crudo || crudo.startsWith("/*")) { indexar(); return; }
    const c = JSON.parse(crudo);
    c.docs.forEach(d => KB.docs.set(d.id, { ...d, semilla:true }));
    KB.frags = c.frags.map(f => ({ ...f }));
    indexar();
  } catch (e) { console.error(e); indexar(); }
}

/* ─── 3 · EL PROMPT — todo el gobierno de la conversación ─────────────── */

const PROMPT = (pac, frags) => `Eres el asistente telefónico de seguimiento post-operatorio de un hospital colombiano. Llamas a un paciente operado hace pocos días${pac ? `. Datos de la llamada: ${pac}` : ""}.

FUNCIÓN: escuchar cómo va su recuperación en seis aspectos, confirmar que entendiste, y dejar un registro para que el equipo clínico decida. NO decides tú si algo es grave.

CÓMO HABLAS: español colombiano, de usted, cálido y llano, como una enfermera con experiencia. NO como un formulario.
- ES UNA CONVERSACIÓN HABLADA: una o dos frases por turno. Sin listas, sin viñetas, sin markdown.
- UNA sola pregunta por turno. Nunca dos signos de interrogación.
- ACUSA RECIBO DE LO QUE ENTENDISTE antes de seguir. Devuélveselo en sus palabras y deja que lo confirme o lo corrija. No es cortesía: es como compruebas que entendiste.
- No sigas orden rígido. Si cuenta algo de otro tema, tómalo. Si ya lo dijo, no lo repitas.

PROHIBIDO:
- Diagnosticar o interpretar clínicamente ("eso suena a infección").
- Tranquilizar clínicamente ("eso no es nada", "es normal después de una cirugía"): no lo sabes, y puede hacer que alguien no consulte.
- Decir cifras, umbrales, medicamentos o dosis SIN FUENTE.
Sí puedes hablar del PROCESO: qué pasará, quién lo contactará y cuándo.

CONOCIMIENTO: abajo van fragmentos recuperados de la base clínica. Si el paciente pregunta algo que requiera respaldo clínico y los fragmentos lo sostienen, respóndelo BREVEMENTE y cita así: [doc_id]. Si NO lo sostienen, di que eso no está en tu base de conocimiento y que lo consulte con el equipo. "No está en mi conocimiento" es una respuesta correcta, no un fallo. NUNCA afirmes nada clínico sin cita.

LOS SEIS ASPECTOS Y SUS VALORES EXACTOS:
- fiebre → el número en grados. "Un calorcito", "tibia", "destemplado" SIN número: PIDE EL NÚMERO. No lo estimes.
- dolor_intensidad → 0 a 10. "Una molestia", "leve", "fuerte", "poquito" sin número: PIDE EL NÚMERO en escala de 0 a 10.
- aspecto_herida → normal | eritema_leve | secrecion_purulenta | dehiscencia
  ("rojita","enrojecimiento"→eritema_leve · "pus","líquido amarillo","mal olor"→secrecion_purulenta · "se abrió","se soltó"→dehiscencia)
- movilidad → normal | limitada_esperada | incapacitante_nueva
  ("me cuesta","despacio"→limitada_esperada · "no puedo","con ayuda","bastón"→incapacitante_nueva)
  "despacito" es AMBIGUO: pregunta si es precaución o si de verdad no puede.
- apetito → normal | levemente_disminuido | muy_disminuido
  ("como poquito"→levemente_disminuido · "nada","no me provoca","náuseas","asco"→muy_disminuido)
- sueno → normal | levemente_alterado | muy_alterado
  ("me despierto varias veces","toda la noche"→muy_alterado)
  "despierto" es AMBIGUO: pregunta cuántas veces.

BANDERAS ROJAS — cortan la llamada de inmediato: sangrado abundante, dificultad para respirar, desmayo, dolor en el pecho, herida abierta de golpe. Si aparece una, dile que pasas su caso ahora mismo a una persona del equipo y cierra con el bloque marcando urgencia.

CIERRE: cuando tengas los seis aspectos, o cuando el paciente no pueda o no quiera seguir, resume lo entendido, pregunta si hay algo más, y produce al final este bloque EXACTO:
---RESUMEN_INICIO---
fiebre: [número o NO_EVALUADA]
dolor_intensidad: [0-10 o NO_EVALUADA]
aspecto_herida: [valor exacto o NO_EVALUADA]
movilidad: [valor exacto o NO_EVALUADA]
apetito: [valor exacto o NO_EVALUADA]
sueno: [valor exacto o NO_EVALUADA]
tu_lectura: [verde|amarillo|rojo]
por_que: [una frase, sin lenguaje clínico]
urgencia: [si|no]
---RESUMEN_FIN---

REGLA QUE NO SE ROMPE: si el paciente no lo dijo, escribe NO_EVALUADA. NUNCA inventes un valor. Que un dato no aparezca no significa que esté bien: significa que no se preguntó o no se obtuvo, y el equipo tiene que saberlo.

"tu_lectura" es TU impresión de quien escuchó la llamada, no un diagnóstico. Un segundo mecanismo evalúa por su cuenta y se comparan.
${frags.length ? `\n=== FRAGMENTOS RECUPERADOS ===\n${frags.map(f => `[${f.doc_id}] ${f.titulo}\n${f.texto}`).join("\n\n")}` : "\n(Sin fragmentos recuperados para este turno.)"}`;

/* ─── 4 · Configuración ───────────────────────────────────────────────── */

const K = {pac:"sm.pac",prov:"sm.prov",key:"sm.key",mod:"sm.mod",oll:"sm.oll",voz:"sm.voz"};
const DEF = { groq:"llama-3.3-70b-versatile", gemini:"gemini-2.0-flash",
              openrouter:"meta-llama/llama-3.3-70b-instruct", ollama:"llama3.2" };
const cfg = {
  pac:localStorage.getItem(K.pac)||"", prov:localStorage.getItem(K.prov)||"groq",
  key:localStorage.getItem(K.key)||"", mod:localStorage.getItem(K.mod)||DEF.groq,
  oll:localStorage.getItem(K.oll)||"http://localhost:11434",
  voz:localStorage.getItem(K.voz)||""
};
const hayModelo = () => cfg.prov === "ollama" || cfg.key.trim() !== "";

/* ─── 5 · Una llamada al modelo por turno ─────────────────────────────── */

async function responder(hist, frags) {
  const sis = PROMPT(cfg.pac, frags);
  if (cfg.prov === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.mod}:generateContent?key=${encodeURIComponent(cfg.key)}`,
      { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({
        systemInstruction:{parts:[{text:sis}]},
        contents:hist.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})),
        generationConfig:{temperature:0.6,maxOutputTokens:700}})});
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0,160)}`);
    const j = await r.json();
    return {
      texto: j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
      usage: { entrada: j.usageMetadata?.promptTokenCount ?? null, salida: j.usageMetadata?.candidatesTokenCount ?? null },
    };
  }
  const url = cfg.prov==="groq" ? "https://api.groq.com/openai/v1/chat/completions"
            : cfg.prov==="openrouter" ? "https://openrouter.ai/api/v1/chat/completions"
            : `${cfg.oll.replace(/\/$/,"")}/v1/chat/completions`;
  const h = {"Content-Type":"application/json"};
  if (cfg.prov !== "ollama") h.Authorization = `Bearer ${cfg.key}`;
  const r = await fetch(url, { method:"POST", headers:h, body:JSON.stringify({
    model:cfg.mod, messages:[{role:"system",content:sis},...hist],
    temperature:0.6, max_tokens:700 })});
  if (!r.ok) throw new Error(`${cfg.prov} ${r.status}: ${(await r.text()).slice(0,160)}`);
  const j = await r.json();
  return {
    texto: j.choices?.[0]?.message?.content?.trim() || "",
    usage: { entrada: j.usage?.prompt_tokens ?? null, salida: j.usage?.completion_tokens ?? null },
  };
}

/* ─── 6 · Voz: grabar mientras se mantiene presionado, Whisper de Groq ── */

let grabadora = null, trozos = [], voces = [];
let tFinDeHabla = 0, entradaMetricaPendiente = null;
const metricas = [];

function cargarVoces() {
  voces = speechSynthesis.getVoices().filter(v => v.lang.startsWith("es"));
  const s = $("cVoz"); if (!s) return;
  s.innerHTML = `<option value="">Automática</option>` +
    voces.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
  s.value = cfg.voz;
}
speechSynthesis.onvoiceschanged = cargarVoces;

function hablar(t) {
  if (!t || !window.speechSynthesis) { setState("idle"); return; }
  callar();
  const u = new SpeechSynthesisUtterance(t.replace(/\[[^\]]+\]/g, ""));
  const v = voces.find(x => x.name === cfg.voz) || voces.find(x => /CO|MX|US/.test(x.lang)) || voces[0];
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1.02;
  u.onstart = () => {
    // Latencia oficial de la rúbrica: desde que el paciente termina de hablar
    // (soltó el botón) hasta que EMPIEZA a sonar el audio del agente.
    if (tFinDeHabla && entradaMetricaPendiente) {
      entradaMetricaPendiente.latencia_ms = Math.round(performance.now() - tFinDeHabla);
      entradaMetricaPendiente = null;
      tFinDeHabla = 0;
      pintarMetricas();
    }
  };
  u.onend = () => setState("idle");
  u.onerror = () => setState("idle");
  setState("speaking");
  speechSynthesis.speak(u);
}
const callar = () => window.speechSynthesis && speechSynthesis.cancel();

async function empezarGrabacion() {
  if (!cfg.key.trim()) { mostrarError("Agrega tu clave de Groq en Ajustes ⚙ para usar el micrófono."); $("cfg").showModal(); return; }
  if (cfg.prov !== "groq") { mostrarError("El micrófono usa Whisper de Groq. Cambia el proveedor a Groq en Ajustes, o escribe tu clave de Groq igual — se usa solo para transcribir."); }
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio:true });
    trozos = [];
    grabadora = new MediaRecorder(st);
    grabadora.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
    grabadora.onstop = async () => {
      st.getTracks().forEach(t => t.stop());
      const b = new Blob(trozos, { type:"audio/webm" });
      if (b.size < 1200) { setState("idle"); return; }
      setState("thinking");
      try {
        const fd = new FormData();
        fd.append("file", b, "a.webm"); fd.append("model","whisper-large-v3-turbo"); fd.append("language","es");
        const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions",
          { method:"POST", headers:{Authorization:`Bearer ${cfg.key}`}, body:fd });
        if (!r.ok) throw new Error(`Transcripción ${r.status}`);
        const t = (await r.json()).text?.trim();
        if (t) await enviar(t); else { mostrarError("No se entendió el audio."); setState("idle"); }
      } catch (e) { mostrarError(e.message); setState("idle"); }
    };
    grabadora.start();
    setState("listening");
  } catch { mostrarError("No se pudo abrir el micrófono. Revisa los permisos del navegador."); setState("idle"); }
}

function detenerGrabacion() {
  if (grabadora && grabadora.state === "recording") grabadora.stop();
}

/* ─── 7 · Sesión, extracción y cierre ─────────────────────────────────── */

const RE = /---RESUMEN_INICIO---([\s\S]*?)---RESUMEN_FIN---/;
function extraer(t) {
  const m = t.match(RE); if (!m) return null;
  const c = {};
  m[1].trim().split("\n").forEach(l => {
    const i = l.indexOf(":"); if (i < 0) return;
    const k = l.slice(0,i).trim().toLowerCase();
    const v = l.slice(i+1).trim().replace(/^\[|\]$/g,"").trim();
    c[k] = (/^no_evaluada$/i.test(v) || v === "") ? null : v;
  });
  return c;
}
const limpiar = t => t.replace(RE, "").trim();

let hist = [], registro = [], ocupado = false, cerrada = false, estado = "idle";
const vistos = new Set();

const $ = id => document.getElementById(id);
const esc = s => s.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]));

function pintar(rol, t) {
  const d = document.createElement("div");
  d.className = `bubble ${rol==="user"?"user":rol==="agent"?"agent":"system"}`;
  d.textContent = t;
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
  return d;
}

function mostrarError(t) {
  const d = document.createElement("div");
  d.className = "bubble error";
  d.textContent = t;
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
}

const talkBtn = () => $("talkBtn");
const waveform = () => $("waveform");

function setState(next) {
  estado = next;
  const btn = talkBtn(), wf = waveform(), label = $("talkLabel");
  btn.classList.remove("held","thinking","speaking");
  wf.classList.toggle("active", next === "listening" || next === "speaking");
  btn.disabled = false;
  const labels = {
    idle:      hayModelo() ? 'Mantén <b>pulsado</b> para hablar' : 'Configura tu clave en <b>Ajustes ⚙</b>',
    listening: '<b>Escuchando…</b> suelta cuando termines',
    thinking:  '<b>Pensando…</b>',
    speaking:  '<b>Hablando…</b> pulsa para interrumpir'
  };
  if (next === "listening") btn.classList.add("held");
  if (next === "thinking")  { btn.classList.add("thinking"); btn.disabled = true; }
  if (next === "speaking")  btn.classList.add("speaking");
  label.innerHTML = labels[next];
}

async function enviar(texto) {
  const t = texto.trim();
  if (!t || ocupado || cerrada) return;

  const falta = Object.keys(UNIDADES).filter(u => !vistos.has(u)).join(" ");
  const frags = hayModelo() ? recuperar(`${t} ${falta}`, 3) : [];

  hist.push({ role:"user", content:t });
  pintar("user", t);
  ocupado = true;
  setState("thinking");
  const pensando = pintar("thinking", "Pensando…"); pensando.classList.add("thinking");

  const t0 = performance.now();
  try {
    const { texto: r, usage } = await responder(hist, frags);
    const ms = Math.round(performance.now() - t0);
    hist.push({ role:"assistant", content:r });

    const campos = extraer(r);
    const visible = campos ? limpiar(r) : r;
    pensando.remove();

    entradaMetricaPendiente = {
      turno: registro.length + 1, ms_modelo: ms,
      tokens_entrada: usage?.entrada ?? null, tokens_salida: usage?.salida ?? null,
      consultas_rag: frags.length, latencia_ms: null,
    };
    metricas.push(entradaMetricaPendiente);

    if (visible) { pintar("agent", visible); hablar(visible); } else { setState("idle"); entradaMetricaPendiente = null; }
    pintarMetricas();

    registro.push({ turno:registro.length+1, paciente:t, agente:visible,
                    documentos:frags.map(f=>f.doc_id), ms });

    if (campos) {
      for (const u of Object.keys(UNIDADES)) if (campos[u]) vistos.add(u);
      cerrarLlamada(campos);
    }
  } catch (e) {
    pensando.remove();
    mostrarError(e.message);
    setState("idle");
  } finally { ocupado = false; }
}

function cerrarLlamada(c) {
  cerrada = true;
  const val = {}; Object.keys(UNIDADES).forEach(u => val[u] = c[u] ?? null);
  const vd = votoDeterminista(val);
  const urg = /^s[ií]$/i.test(c.urgencia || "");
  const vp = ["verde","amarillo","rojo"].includes((c.tu_lectura||"").toLowerCase())
           ? c.tu_lectura.toLowerCase() : "verde";
  const p = ponderar(urg ? "rojo" : vp, vd.lectura);

  const filas = Object.entries(UNIDADES).map(([u,m]) => {
    const v = val[u]===null ? "no evaluada" : esc(val[u])+(m.u||"");
    return `<tr><td>${m.et}</td><td>${v}</td></tr>`;
  }).join("");

  const docsUsados = [...new Set(registro.flatMap(r=>r.documentos))];

  const card = document.createElement("div");
  card.className = "bubble result";
  card.innerHTML = `
    <div class="veredicto v-${p.criticidad}"><span class="bola"></span>${p.criticidad}${urg?" · urgencia":""}</div>
    <div class="note">${p.escalar ? "Se escala a una persona del equipo" : "No requiere escalamiento"} ·
      voto del modelo <b>${vp}</b> · voto determinista <b>${vd.lectura}</b> (regla ${vd.regla})</div>
    <table>${filas}</table>
    ${vd.sinEval.length ? `<div class="note">Sin evaluar: ${vd.sinEval.map(u=>UNIDADES[u].et).join(", ")}.</div>` : ""}
    <a class="dl" id="dlResumen">⬇ Descargar resumen</a>`;
  $("messages").appendChild(card);
  $("messages").scrollTop = $("messages").scrollHeight;

  const texto = textoResumen(val, vd, vp, c, p, urg, docsUsados);
  card.querySelector("#dlResumen").onclick = () => bajar(texto, `resumen-${Date.now()}.txt`);

  setEstadoPill(`Cerrada · ${p.criticidad}`, p.criticidad === "rojo" ? "danger" : p.criticidad === "amarillo" ? "amber" : "ok");
}

function textoResumen(val, vd, vp, c, p, urg, docs) {
  return [
    `RESUMEN DE LLAMADA — SOURCE MERIDIAN · SEGUIMIENTO POST-OPERATORIO`,
    `Fecha: ${new Date().toLocaleString("es-CO")}`,
    cfg.pac ? `Paciente y procedimiento: ${cfg.pac}` : `Paciente: no declarado`,
    ``,
    `DECISIÓN: ${p.criticidad.toUpperCase()} — ${p.escalar?"SE ESCALA a personal capacitado":"no requiere escalamiento"}`,
    urg ? `⚠ Cerrada por bandera roja durante la llamada.` : null,
    ``,
    `SÍNTOMAS REPORTADOS`,
    ...Object.entries(UNIDADES).map(([u,m]) =>
      `  ${m.et.padEnd(11)}: ${val[u] ?? "NO REPORTADO"}${vd.clases[u]?`   [${vd.clases[u].clase}]`:""}`),
    ``,
    `CÓMO SE DECIDIÓ`,
    `  Voto del modelo ....: ${vp} — ${c.por_que || "sin razón declarada"}`,
    `  Voto determinista ..: ${vd.lectura} (regla ${vd.regla}, dominio ${DOMINIO_V}, ${vd.ms} ms)`,
    `  Composición ........: disyunción sin veto`,
    ``,
    `REGLAS DISPARADAS`,
    ...(vd.reglas.length ? vd.reglas.map(r=>`  ${r}`) : ["  (ninguna)"]),
    ``,
    `REFERENCIAS CONSULTADAS`,
    ...(docs.length ? docs.map(d=>`  ${d}`) : ["  (ninguna)"]),
    vd.sinEval.length ? `\nNO REPORTADO: ${vd.sinEval.join(", ")} — no se preguntó o no se obtuvo. No significa que estén bien.` : null,
    ``,
    `PRÓXIMOS PASOS`,
    p.escalar ? `  Contactar al paciente desde el equipo clínico.` : `  Ninguno. Continuar seguimiento habitual.`,
    ``,
    `Datos sintéticos. Procedencia inferred. SIN validación clínica.`
  ].filter(x=>x!==null).join("\n");
}

function bajar(t, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([t], {type:"text/plain"}));
  a.download = nombre; a.click();
}

function setEstadoPill(txt, tipo) {
  const pill = $("estadoPill");
  pill.classList.remove("off");
  pill.style.color = tipo === "ok" ? "var(--ok)" : tipo === "amber" ? "var(--amber)" : tipo === "danger" ? "var(--danger)" : "";
  $("estadoTxt").textContent = txt;
}

function nueva() {
  hist = []; registro = []; vistos.clear(); cerrada = false;
  $("messages").innerHTML = "";
  callar(); setState("idle");
  if (!hayModelo()) {
    pintar("system", "Configura tu clave de Groq en Ajustes ⚙ para empezar.");
    setEstadoPill("Sin configurar");
    return;
  }
  const s = `Buenos días, le habla el asistente de seguimiento de Source Meridian. Lo llamo para saber cómo va su recuperación después de la cirugía. ¿Cómo se ha sentido estos días?`;
  hist.push({role:"assistant",content:s});
  pintar("agent", s);
  hablar(s);
  setEstadoPill("En línea", "ok");
}

/* ─── 8 · Interfaz ──────────────────────────────────────────────────────── */

talkBtn().addEventListener("pointerdown", e => {
  e.preventDefault();
  if (estado === "speaking") { callar(); setState("idle"); return; }
  if (estado !== "idle") return;
  empezarGrabacion();
});
talkBtn().addEventListener("pointerup", () => { if (estado === "listening") { tFinDeHabla = performance.now(); detenerGrabacion(); } });
talkBtn().addEventListener("pointerleave", () => { if (estado === "listening") { tFinDeHabla = performance.now(); detenerGrabacion(); } });

$("newBtn").addEventListener("click", nueva);
$("bCfg").addEventListener("click", () => { abrirCfg(); $("cfg").showModal(); });
$("bCerrarCfg").addEventListener("click", () => $("cfg").close());

$("cProv").onchange = e => { $("cModelo").value = DEF[e.target.value] || ""; pista(); };
function pista() {
  const p = $("cProv").value;
  $("lKey").textContent = p==="ollama" ? "(no hace falta para conversar; sigue haciendo falta para el micrófono)"
                        : p==="groq"   ? "— también sirve para el micrófono" : "— el micrófono seguirá usando Groq";
}
function abrirCfg() {
  $("cPac").value=cfg.pac; $("cProv").value=cfg.prov; $("cKey").value=cfg.key;
  $("cModelo").value=cfg.mod; $("cOllama").value=cfg.oll;
  cargarVoces(); pista();
}
$("bGuardar").onclick = () => {
  cfg.pac=$("cPac").value.trim(); cfg.prov=$("cProv").value; cfg.key=$("cKey").value.trim();
  cfg.mod=$("cModelo").value.trim(); cfg.oll=$("cOllama").value.trim(); cfg.voz=$("cVoz").value;
  Object.entries({[K.pac]:cfg.pac,[K.prov]:cfg.prov,[K.key]:cfg.key,[K.mod]:cfg.mod,
                  [K.oll]:cfg.oll,[K.voz]:cfg.voz})
        .forEach(([k,v]) => localStorage.setItem(k,v));
  $("cfg").close();
  nueva();
};

/* ─── 9 · Métricas — lo que la rúbrica exige reportar ──────────────────── */

function percentil(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b)=>a-b);
  const idx = Math.min(s.length-1, Math.ceil((p/100)*s.length)-1);
  return s[Math.max(0,idx)];
}

// Groq, llama-3.3-70b-versatile, precio publicado por 1M tokens (para
// extrapolar costo — el nivel gratuito de desarrollo no cobra). Whisper
// large-v3-turbo se cobra por minuto de audio, no por token, así que no
// entra en esta suma; se declara aparte en el informe.
const PRECIO_ENTRADA_POR_M = 0.59, PRECIO_SALIDA_POR_M = 0.79;

function pintarMetricas() {
  const $m = $("metContenido");
  if (!metricas.length) { $m.textContent = "Todavía no hay turnos registrados en esta sesión."; return; }
  const latencias = metricas.map(m=>m.latencia_ms).filter(x=>x!==null);
  const p50 = percentil(latencias, 50), p95 = percentil(latencias, 95);
  const tokIn = metricas.reduce((a,m)=>a+(m.tokens_entrada||0),0);
  const tokOut = metricas.reduce((a,m)=>a+(m.tokens_salida||0),0);
  const rag = metricas.reduce((a,m)=>a+(m.consultas_rag||0),0);
  const costo = (tokIn/1e6)*PRECIO_ENTRADA_POR_M + (tokOut/1e6)*PRECIO_SALIDA_POR_M;
  $m.innerHTML = `
    <div class="met-fila"><span>Turnos (invocaciones al modelo)</span><b>${metricas.length}</b></div>
    <div class="met-fila"><span>Latencia P50 (fin de habla → audio)</span><b>${p50 ?? "—"} ms</b></div>
    <div class="met-fila"><span>Latencia P95</span><b>${p95 ?? "—"} ms</b></div>
    <div class="met-fila"><span>Tokens de entrada (total)</span><b>${tokIn || "—"}</b></div>
    <div class="met-fila"><span>Tokens de salida (total)</span><b>${tokOut || "—"}</b></div>
    <div class="met-fila"><span>Tokens promedio por turno</span><b>${Math.round((tokIn+tokOut)/metricas.length) || "—"}</b></div>
    <div class="met-fila"><span>Consultas al RAG (total)</span><b>${rag}</b></div>
    <div class="met-fila"><span>Costo estimado de esta sesión (Groq, precio de producción)</span><b>US$ ${costo.toFixed(5)}</b></div>
    <div class="met-fila"><span>Costo estimado por llamada (promedio)</span><b>US$ ${(costo/1).toFixed(5)}</b></div>
    <div style="margin-top:10px;font-size:10.5px;color:var(--text-faint)">
      Precios de referencia: llama-3.3-70b-versatile en Groq, US$${PRECIO_ENTRADA_POR_M}/1M tokens de entrada,
      US$${PRECIO_SALIDA_POR_M}/1M de salida (verificar contra console.groq.com/settings/billing al cierre del informe).
      Whisper large-v3-turbo se cobra por minuto de audio, aparte de esta suma.
    </div>`;
}

/* ─── 10 · Consola de conocimiento — Compuerta 5 ───────────────────────── */

function ingerir(doc_id, titulo, texto, kind) {
  const bloques = texto.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 12);
  const trozos = []; let buf = "";
  for (const bl of bloques) {
    buf = buf ? buf + "\n" + bl : bl;
    if (buf.length >= 500) { trozos.push(buf); buf = ""; }
  }
  if (buf.length >= 200) trozos.push(buf);
  if (!trozos.length) throw new Error("El documento no tiene texto suficiente para indexar (mínimo ~200 caracteres útiles).");
  KB.docs.set(doc_id, { id:doc_id, t:titulo, k:kind, n:trozos.length, semilla:false, subido: new Date().toLocaleString("es-CO") });
  trozos.forEach((x, i) => KB.frags.push({ d:doc_id, i, x }));
  indexar();
  return trozos.length;
}

function retirarDoc(doc_id) {
  KB.docs.delete(doc_id);
  KB.frags = KB.frags.filter(f => f.d !== doc_id);
  indexar();
  pintarConsola();
}

function pintarConsola() {
  const total = KB.docs.size, frags = KB.frags.length;
  $("kbEstado").textContent = `${total} documentos · ${frags} fragmentos indexados (BM25) · corpus base + lo subido en esta sesión`;
  const subidos = [...KB.docs.values()].filter(d => !d.semilla);
  const lista = $("kbLista");
  if (!subidos.length) {
    lista.innerHTML = `<div class="kb-msg">Ningún documento subido en esta sesión todavía. El corpus base (107 documentos clínicos) ya está cargado y no se lista aquí para no saturar la vista — se puede consultar con la búsqueda del chat.</div>`;
    return;
  }
  lista.innerHTML = subidos.map(d => `
    <div class="kb-doc">
      <span class="kb-titulo"><b>${esc(d.t)}</b> · ${esc(d.k)} · ${d.n} frag. <span class="kb-badge">✓ procesado y disponible</span></span>
      <button data-retirar="${esc(d.id)}">Retirar</button>
    </div>`).join("");
  lista.querySelectorAll("[data-retirar]").forEach(b => b.onclick = () => retirarDoc(b.dataset.retirar));
}

$("kbForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const titulo = $("kbTitulo").value.trim();
  const kind = $("kbKind").value;
  const archivo = $("kbArchivo").files[0];
  const textoPegado = $("kbTexto").value.trim();
  const msg = $("kbMsg");
  if (!titulo) { msg.className="kb-msg err"; msg.textContent="Falta el título."; return; }
  try {
    const texto = archivo ? await archivo.text() : textoPegado;
    if (!texto || texto.trim().length < 20) throw new Error("Falta el texto del documento (súbalo como .txt/.md o péguelo).");
    const doc_id = "consola-" + titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").slice(0,60) + "-" + Date.now().toString(36);
    const n = ingerir(doc_id, titulo, texto, kind);
    msg.className = "kb-msg ok";
    msg.textContent = `Ingerido: "${titulo}" (${n} fragmentos). Ya se puede recuperar — pregúntele algo al agente en la pestaña Llamada que toque este tema.`;
    $("kbForm").reset();
    pintarConsola();
  } catch (e) {
    msg.className = "kb-msg err";
    msg.textContent = "Rechazado: " + e.message;
  }
});

/* ─── 11 · Pestañas ─────────────────────────────────────────────────────── */

const PANTALLAS = { tabLlamada:"panelLlamada", tabConocimiento:"panelConocimiento", tabMetricas:"panelMetricas" };
Object.keys(PANTALLAS).forEach(tab => $(tab).addEventListener("click", () => {
  Object.entries(PANTALLAS).forEach(([t,p]) => {
    $(t).classList.toggle("on", t===tab);
    $(p).classList.toggle("on", t===tab);
  });
  if (tab === "tabConocimiento") pintarConsola();
  if (tab === "tabMetricas") pintarMetricas();
}));

cargarVoces();
cargarCorpus();
pintarConsola();
setState("idle");
nueva();
if (!hayModelo()) setTimeout(() => { abrirCfg(); $("cfg").showModal(); }, 400);
