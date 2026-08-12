#!/usr/bin/env node
/**
 * LA MEDICION. Dos corridas sobre LOS MISMOS casos, y la distancia entre ellas es el
 * resultado que importa.
 *
 *   A · SOLO REGLAS      valores estructurados -> determinista -> VD.  Es el TECHO.
 *   B · EXTREMO A EXTREMO habla libre -> extraccion real (WO-17) -> decision.
 *
 * La distancia A-B es el ERROR DE EXTRACCION, y el dominio ya lo habia predicho en sus
 * limites declarados: "el techo de acierto lo fija la extraccion, no estas reglas".
 * Reportar las dos convierte esa afirmacion en una medicion — las reglas son perfectas,
 * la tuberia logra esto, y la perdida esta exactamente aqui. Un solo numero no dice
 * nada de eso.
 *
 * Estratificado por DOS ejes: `label_ground_truth` y `estilo_paciente`. Un minimizador
 * y un evasivo son problemas distintos y la tasa agregada los esconde — y el
 * minimizador es justo el que dice "un calorcito" teniendo 38,9.
 *
 *   node scripts/muestra-estratificada.mjs [--n 50] [--solo-a]
 *
 * Escribe checkpoint por caso: una corrida de ~40 min no puede perderse por un 429.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cargarDominioDesdeArchivo, MotorDeterminista } from "@techsphere/deterministic";
import {
  cargarMarco,
  cerrarPendientesPorCorte,
  conducirTurno,
  crearMotorDeNube,
  iniciarSesion,
  unidadesParaEntrega,
} from "@techsphere/conversational";
import {
  AdaptadorNube,
  AlmacenDeFuentes,
  ArchivoDeSesiones,
  buildFrame,
  CanalDeAlerta,
  cargarCorpusReal,
  DecisionEngineNube,
  IndiceLexico,
  leerVotoDeterminista,
  Orquestador,
  SumideroDeResumenes,
  UNIDADES_DEL_DOMINIO,
} from "../src/index.ts";
import { comoObjetos, leerHoja, leerZip } from "./lib/xlsx.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SALIDA = join(RAIZ, "docs", "evidencia-decision");
const CHECKPOINT = join(AQUI, "..", "salidas", "muestra-checkpoint.json");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const N = Number(arg("--n", "50"));
const SOLO_A = process.argv.includes("--solo-a");

const MODELO = "llama-3.3-70b-versatile";
const KEY = process.env.GROQ_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const dataset = comoObjetos(
  leerHoja(leerZip(join(RAIZ, "MaterialReto", "ParticipantArtifacts", "dataset", "dataset_final.xlsx"))),
).filter((f) => f.capa === "capa2_ruidosa");

const casos = new Map();
for (const f of dataset) {
  if (!casos.has(f.caso_id)) {
    casos.set(f.caso_id, {
      caso_id: f.caso_id,
      paciente_id: f.paciente_id,
      dia_postop: Number(f.dia_postop),
      label: f.label_ground_truth,
      estilo: f.estilo_paciente,
      turnos: [],
    });
  }
  if (f.hablante === "paciente") casos.get(f.caso_id).turnos.push(f.texto);
}

/** Los valores estructurados del MISMO caso, para la corrida A. */
const trayectorias = new Map(
  JSON.parse(readFileSync(join(RAIZ, "deterministic", "test", "fixtures", "trayectorias-160.json"), "utf8")).casos.map(
    (c) => [`caso_${c.trayectoria_id}`, c],
  ),
);

// ---------------------------------------------------------------------------
// La muestra: 12 rojos COMPLETOS + pareado, y dentro de cada label por estilo
// ---------------------------------------------------------------------------

function seleccionar(n) {
  const porLabel = { rojo: [], amarillo: [], verde: [] };
  for (const c of [...casos.values()].sort((a, b) => a.caso_id.localeCompare(b.caso_id))) {
    if (trayectorias.has(c.caso_id)) porLabel[c.label]?.push(c);
  }

  // Los 12 rojos ENTEROS: son el criterio que la rubrica dice que "limita
  // severamente" si falla, y una muestra de rojos no serviria para mirarlos uno a uno.
  const elegidos = [...porLabel.rojo];

  // ============ Por que los AMARILLOS quedan fuera ============
  //
  // No es por tiempo. Es que no responden ninguna de las dos preguntas que importan:
  // ¿se escapa un rojo? y ¿grita en un verde? D2 ya declara que la banda amarilla es
  // ambigua POR DISEÑO — si el VD la resolviera, el voto probabilistico sobraria y
  // ADR-013 perderia su fundamento—, asi que medirla demostraria sobre todo una
  // decision que ya esta escrita.
  //
  // Se excluyen CON ESA RAZON en el informe, que dice mas que la tabla que producirian.
  // ============================================================
  const porEstilo = new Map();
  for (const c of porLabel.verde) {
    if (!porEstilo.has(c.estilo)) porEstilo.set(c.estilo, []);
    porEstilo.get(c.estilo).push(c);
  }
  const estilos = [...porEstilo.keys()].sort();
  let i = 0;
  // Reparto por estilo en ROTACION, no por orden: un muestreo que se lleve solo
  // colaborativos mediria el caso facil.
  while (elegidos.filter((c) => c.label === "verde").length < n - porLabel.rojo.length && i < 500) {
    const siguiente = porEstilo.get(estilos[i % estilos.length])?.shift();
    if (siguiente) elegidos.push(siguiente);
    i++;
  }
  return elegidos;
}

const muestra = seleccionar(N);

// ---------------------------------------------------------------------------
// Cableado
// ---------------------------------------------------------------------------

const dominio = cargarDominioDesdeArchivo(join(RAIZ, "docs", "dominio", "dominio-postop-v0.1.json"));
const determinista = new MotorDeterminista(dominio);
const DOMAIN_VERSION = determinista.describeDomain().domain_version;

const unidadesDe = (caso) => {
  const t = trayectorias.get(caso.caso_id);
  const COL = {
    fiebre: "fiebre_c",
    dolor_intensidad: "dolor_nrs",
    movilidad: "movilidad",
    aspecto_herida: "herida",
    apetito: "apetito",
    sueno: "sueno",
  };
  return Object.entries(COL).map(([id, col]) => ({
    id,
    extraction: "cubierta",
    state: 3,
    state_trace: [3],
    raw: String(t[col]),
    normalized: t[col],
    confidence: 1,
    coverage_met: ["value", "onset", "trend", "magnitude"],
    turn_refs: [1],
  }));
};

// --- A · SOLO REGLAS ---------------------------------------------------------

function corridaA(caso) {
  const reporte = determinista.evaluate({
    session_id: caso.caso_id,
    frame_id: "A",
    units: unidadesDe(caso),
    modifiers: { dia_postop: caso.dia_postop },
    domain_version: DOMAIN_VERSION,
  });
  const vd = leerVotoDeterminista(reporte);
  return { criticidad: vd.vote.criticality, escalate: vd.vote.escalate, vd_rule: vd.vd_rule };
}

// --- B · EXTREMO A EXTREMO ---------------------------------------------------

const almacen = new AlmacenDeFuentes();
cargarCorpusReal(almacen);
const rag = new IndiceLexico(almacen);
const archivo = new ArchivoDeSesiones(join(AQUI, "..", "salidas", "sesiones-muestra"));
const sink = new SumideroDeResumenes(archivo, new CanalDeAlerta());

const adaptadorDecision = new AdaptadorNube({ ruta: "nube_groq", modelo: MODELO, api_key: KEY, timeout_ms: 60_000 });
/**
 * ============ Que del motor conversacional es real aqui, y que no ============
 *
 * `interpret` es REAL: es la extraccion, y es justamente lo que se esta midiendo.
 *
 * `render` se cortocircuita. Redacta la SIGUIENTE PREGUNTA del agente, y en este arnes
 * esa pregunta no tiene ningun efecto: los turnos del paciente son fijos, vienen del
 * dataset y ya estan escritos. Pagar una llamada al modelo por cada una duplicaria el
 * costo y el reloj de la corrida para producir un texto que nadie lee.
 *
 * Lo que esto NO mide, y hay que decirlo al citar el numero: la calidad de las
 * preguntas del agente. Eso se evalua en la sesion evaluada, no aqui.
 * ==============================================================================
 */
function motorSoloExtraccion(motor) {
  return {
    interpret: (req) => motor.interpret(req),
    render: async () => "(el arnes no redacta: los turnos del paciente vienen del dataset)",
  };
}

const motorConversacional = SOLO_A
  ? null
  : motorSoloExtraccion(crearMotorDeNube({ modelo: MODELO, api_key: KEY }));

const orq = new Orquestador({
  rag,
  expandir: (base, terminos) => rag.expandirConsulta(base, terminos),
  determinista,
  motor: new DecisionEngineNube(adaptadorDecision),
  proyectar: (patient_ref) => ({ patient_ref, unit_ids: UNIDADES_DEL_DOMINIO, dia_postop: 0 }),
  sink,
  embedding_model: rag.descriptor(),
});

/**
 * Acelerador. Vive AQUI, en el arnes, y nunca en el turno en vivo: el techo de 12 000
 * tokens por minuto es del banco de pruebas, no del paciente al telefono.
 */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * El intervalo se AUTORREGULA. Arranca conservador porque el techo real son 12 000
 * tokens por minuto y un turno de entrevista ronda los 600: eso son ~20 llamadas por
 * minuto, es decir una cada 3 s. Empezar mas rapido solo compra 429s.
 */
let intervalo = Number(arg("--intervalo", "3000"));
let seguidasSinFreno = 0;

/**
 * ============ Un 429 NO es un fallo: es contrapresion ============
 *
 * La primera version los contaba contra el presupuesto de reintentos y el primer caso
 * murio con "agotados los reintentos" tras cinco esperas de dos segundos. Estaba
 * tratando el freno del proveedor como si fuera un error del sistema.
 *
 * Ahora tienen presupuesto propio y generoso, no gastan intentos, y cada uno SUBE el
 * intervalo base — el arnes aprende el ritmo que el techo permite en vez de pelearse
 * con el. Solo los errores de verdad consumen reintentos.
 * ==================================================================
 */
const INTENTOS = 4;
const FRENOS_MAX = 6;

async function conReintento(fn, etiqueta) {
  let intentos = 0;
  let frenos = 0;

  while (intentos < INTENTOS && frenos < FRENOS_MAX) {
    try {
      const r = await fn();
      await dormir(intervalo);
      // Tras una racha limpia, se afloja despacio: el techo puede haber cambiado.
      if (++seguidasSinFreno >= 25 && intervalo > 1200) {
        intervalo = Math.max(1200, intervalo - 200);
        seguidasSinFreno = 0;
      }
      return r;
    } catch (e) {
      const m = String(e.message ?? e);
      if (/429|rate.?limit|too many requests/i.test(m)) {
        frenos++;
        seguidasSinFreno = 0;
        const sugerido = Number(/try again in ([\d.]+)s/.exec(m)?.[1] ?? 0);
        // El techo es de tokens por MINUTO y la ventana es deslizante. Las dos primeras
        // veces se respeta lo que sugiere el proveedor; a partir de la tercera se espera
        // una ventana ENTERA, porque insistir cada siete segundos contra una ventana de
        // sesenta es rozar el borde y volver a rebotar — que es exactamente lo que hizo
        // fracasar la primera corrida, veinticinco veces seguidas por caso.
        const espera = frenos <= 2 ? Math.min(Math.max(sugerido * 1.5, 6) + 1, 30) : 65;
        intervalo = Math.min(intervalo + 400, 9000);
        process.stdout.write(` [429 ×${frenos}, espero ${espera.toFixed(0)}s, intervalo ${intervalo}ms]`);
        await dormir(espera * 1000);
        continue;
      }
      intentos++;
      if (intentos >= INTENTOS) throw e;
      process.stdout.write(` [reintento ${etiqueta} ${intentos}/${INTENTOS}: ${m.slice(0, 60)}]`);
      await dormir(3000);
    }
  }
  throw new Error(`${etiqueta}: ${frenos >= FRENOS_MAX ? `${frenos} frenos seguidos` : "agotados los reintentos"}`);
}

async function corridaB(caso) {
  const base = { patient_ref: caso.paciente_id, unit_ids: UNIDADES_DEL_DOMINIO, dia_postop: caso.dia_postop };
  const session_id = `muestra-${caso.caso_id}`;
  const frame = buildFrame(base, session_id, { round: 0 });

  // La conversacional REAL conduce los seis turnos de habla libre.
  let estado = cargarMarco(iniciarSesion(session_id), frame);
  const turnosVistos = [];
  for (const [i, texto] of caso.turnos.entries()) {
    const r = await conReintento(
      () => conducirTurno(estado, texto, motorConversacional, i + 1),
      `turno ${i + 1}`,
    );
    estado = r.estado;
    turnosVistos.push({ turno: i + 1, texto });
    if (estado.phase === "F5") break;
  }

  // ============ §16 · al decisor solo viajan unidades CERRADAS ============
  //
  // El dataset da seis turnos y se acaba. Lo que quede abierto se cierra POR CORTE con
  // causa `interrumpido`, que es exactamente lo que paso: no es `no_sabe` —el paciente
  // no declaro ignorancia— ni un cierre limpio. La maquina de extraccion rechaza el
  // salto directo a `cubierta`, y hace bien: un cierre que nadie produjo llegaria al
  // decisor como si alguien lo hubiera producido.
  //
  // Sin esto el arnes reventaba en TODOS los casos, y el fallo se leia como si fuera
  // del proveedor.
  // ========================================================================
  const cerrado = cerrarPendientesPorCorte(estado, "interrumpido");
  const units = unidadesParaEntrega(cerrado);

  // El decisor de verdad, con su propio marco y su bucle.
  orq.sesion(session_id).base = base;
  orq.sesion(session_id).frame = frame;
  orq.sesion(session_id).identity = {
    status: "identificado",
    patient_ref: caso.paciente_id,
    speaker_role: "paciente",
  };

  let veredicto;
  for (let round = 0; round <= 2; round++) {
    veredicto = await conReintento(
      () =>
        orq.submitFrame({
          session_id,
          frame_id: frame.frame_id,
          round,
          units,
          session_state: {
            global: estado.global_state,
            frame_health: 0,
            retroactive_cycle: false,
            identity: "identificado",
          },
          transcript_digest: caso.turnos.join(" | ").slice(0, 600),
          budget_spent: { turns: caso.turnos.length, ms: 200_000 },
        }),
      "submitFrame",
    );
    if (veredicto.status === "sufficient") break;
  }

  const d = veredicto.decision;
  return {
    criticidad: d.criticality,
    escalate: d.escalate,
    reason_code: d.reason_code,
    session_id,
    units: units.map((u) => ({ id: u.id, raw: u.raw, normalized: u.normalized, extraction: u.extraction })),
    turnos: turnosVistos,
    doc_ids: d.traces.doc_ids,
    rules_fired: d.traces.rules_fired,
  };
}

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------

mkdirSync(dirname(CHECKPOINT), { recursive: true });
const previos = existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, "utf8")) : {};

console.log(`\nMuestra: ${muestra.length} casos (${muestra.filter((c) => c.label === "rojo").length} rojos completos)`);
console.log(`Corrida A: solo reglas · Corrida B: ${SOLO_A ? "OMITIDA" : "extremo a extremo con modelo real"}\n`);

const resultados = [];
for (const [i, caso] of muestra.entries()) {
  const previo = previos[caso.caso_id];
  if (previo && (SOLO_A || previo.b)) {
    resultados.push(previo);
    continue;
  }

  const a = corridaA(caso);
  let b = null;
  let error = null;
  if (!SOLO_A) {
    try {
      b = await corridaB(caso);
    } catch (e) {
      error = String(e.message ?? e).split("\n")[0];
    }
  }

  const fila = { caso_id: caso.caso_id, label: caso.label, estilo: caso.estilo, dia: caso.dia_postop, a, b, error };
  resultados.push(fila);
  previos[caso.caso_id] = fila;
  writeFileSync(CHECKPOINT, JSON.stringify(previos, null, 2), "utf8");

  const ok = (x) => (x === caso.label ? "✓" : "✗");
  console.log(
    `${String(i + 1).padStart(3)}/${muestra.length} ${caso.caso_id.padEnd(28)} ${caso.label.padEnd(9)} ${caso.estilo.padEnd(22)} ` +
      `A:${a.criticidad.padEnd(9)}${ok(a.criticidad)} ` +
      (b ? `B:${b.criticidad.padEnd(9)}${ok(b.criticidad)}` : error ? `B:ERROR ${error.slice(0, 40)}` : ""),
  );
}

// ---------------------------------------------------------------------------
// Analisis
// ---------------------------------------------------------------------------

const LABELS = ["verde", "amarillo", "rojo"];

function matriz(filas, cual) {
  const m = {};
  for (const v of LABELS) m[v] = { verde: 0, amarillo: 0, rojo: 0, sin_dato: 0 };
  for (const f of filas) {
    const pred = f[cual]?.criticidad;
    m[f.label][pred ?? "sin_dato"]++;
  }
  return m;
}

function tabla(m, titulo, total) {
  const l = [`### ${titulo}`, "", `Denominador: **${total} casos**. Filas = verdad; columnas = lo que el sistema dijo.`, ""];
  l.push("| verdad ↓ / dicho → | verde | amarillo | rojo | sin dato |");
  l.push("|---|---|---|---|---|");
  for (const v of LABELS) {
    l.push(`| **${v}** | ${m[v].verde} | ${m[v].amarillo} | ${m[v].rojo} | ${m[v].sin_dato} |`);
  }
  return l.join("\n");
}

const conB = resultados.filter((r) => r.b);
const mA = matriz(resultados, "a");
const mB = matriz(conB, "b");

/** Lo unico que la rubrica llama catastrofico: un rojo que el sistema no escala. */
const falsosNegativos = conB.filter((r) => r.label === "rojo" && !r.b.escalate);
const rojosNoMarcados = conB.filter((r) => r.label === "rojo" && r.b.criticidad !== "rojo");

const porEstilo = {};
for (const r of conB) {
  porEstilo[r.estilo] ??= { n: 0, aciertoA: 0, aciertoB: 0, escalaB: 0 };
  porEstilo[r.estilo].n++;
  if (r.a.criticidad === r.label) porEstilo[r.estilo].aciertoA++;
  if (r.b.criticidad === r.label) porEstilo[r.estilo].aciertoB++;
  if (r.b.escalate) porEstilo[r.estilo].escalaB++;
}

const md = [];
md.push("# Muestra estratificada — la medición", "");
md.push(`> Generada por \`decision/scripts/muestra-estratificada.mjs\`. Modelo \`${MODELO}\`, dominio \`${DOMAIN_VERSION}\`,`);
md.push(`> recuperación \`${rag.descriptor()}\`. Datos sintéticos del reto, capa **capa2_ruidosa** (habla libre con ruido).`);
md.push(`> ${new Date().toISOString()}`, "");
md.push("## Qué se midió, y por qué son dos corridas", "");
md.push("**A · solo reglas** — los valores ya estructurados de `trayectorias_postop_silver` entran directos al motor");
md.push("determinista. Es el **techo**: lo que el sistema lograría si la extracción fuera perfecta.", "");
md.push("**B · extremo a extremo** — los turnos de habla libre pasan por la extracción real, el bucle de decisión y");
md.push("los dos votos. Es el **número de verdad**.", "");
md.push("**La distancia A−B es el error de extracción.** El dominio ya lo había predicho en sus límites declarados");
md.push("—*\"el techo de acierto lo fija la extracción, no estas reglas\"*—, y esto lo convierte de afirmación en medición.", "");
md.push(`Muestra: **${resultados.length} casos** — los **${resultados.filter((r) => r.label === "rojo").length} rojos completos** y **${resultados.filter((r) => r.label === "verde").length} verdes** repartidos por estilo en rotación.`);
md.push("");
md.push("**Los amarillos quedan fuera, y no por tiempo.** No responden ninguna de las dos preguntas que");
md.push("importan —¿se escapa un rojo?, ¿grita en un verde?—, y D2 ya declara que la banda amarilla es");
md.push("ambigua **por diseño**: si el VD la resolviera, el voto probabilístico sobraría y ADR-013 perdería");
md.push("su fundamento. Medirlos demostraría sobre todo una decisión que ya está escrita.");
md.push(`De ellos, **${conB.length}** completaron la corrida B.`, "");
md.push(tabla(mA, "A · solo reglas", resultados.length), "");
md.push(tabla(mB, "B · extremo a extremo", conB.length), "");

const aciertoA = resultados.filter((r) => r.a.criticidad === r.label).length;
const aciertoB = conB.filter((r) => r.b.criticidad === r.label).length;
md.push("### La distancia", "");
md.push(`| | aciertos de criticidad | sobre |`);
md.push(`|---|---|---|`);
md.push(`| A · solo reglas | ${aciertoA} | ${resultados.length} |`);
md.push(`| B · extremo a extremo | ${aciertoB} | ${conB.length} |`);
md.push("");

md.push("### Por estilo de paciente", "");
md.push("Un minimizador y un evasivo son problemas distintos, y la tasa agregada los esconde.", "");
md.push("| estilo | n | acierto A | acierto B | escala B |");
md.push("|---|---|---|---|---|");
for (const [estilo, v] of Object.entries(porEstilo).sort()) {
  md.push(`| ${estilo} | ${v.n} | ${v.aciertoA}/${v.n} | ${v.aciertoB}/${v.n} | ${v.escalaB}/${v.n} |`);
}
md.push("");

md.push("### Los rojos, uno por uno", "");
md.push("La rúbrica dice que un falso negativo aquí *limita severamente*, y que la reincidencia lo anula.");
md.push("Por eso no se reportan como tasa: se miran de a uno.", "");
md.push("| caso | estilo | A | B | ¿escala? | unidades sin normalizar en B |");
md.push("|---|---|---|---|---|---|");
for (const r of conB.filter((x) => x.label === "rojo")) {
  const sinNorm = r.b.units.filter((u) => u.normalized === null).map((u) => u.id);
  md.push(
    `| \`${r.caso_id}\` | ${r.estilo} | ${r.a.criticidad} | ${r.b.criticidad} | ${r.b.escalate ? "**sí**" : "**NO**"} | ${sinNorm.join(", ") || "—"} |`,
  );
}
md.push("");
md.push(`**Falsos negativos en rojo (no escalaron): ${falsosNegativos.length} de ${conB.filter((r) => r.label === "rojo").length}.**`, "");

for (const fn of falsosNegativos) {
  md.push(`#### \`${fn.caso_id}\` — ${fn.estilo}`, "");
  md.push("Turnos del paciente:", "");
  for (const t of fn.b.turnos) md.push(`${t.turno}. *"${t.texto}"*`);
  md.push("", "Lo que la extracción produjo:", "");
  md.push("| unidad | `raw` | `normalized` | extracción |");
  md.push("|---|---|---|---|");
  for (const u of fn.b.units) {
    md.push(`| \`${u.id}\` | ${u.raw ? `"${u.raw}"` : "—"} | ${u.normalized === null ? "**null**" : `\`${JSON.stringify(u.normalized)}\``} | ${u.extraction} |`);
  }
  md.push("");
}

mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, "muestra-estratificada.md"), md.join("\n"), "utf8");
writeFileSync(
  join(SALIDA, "muestra-estratificada.json"),
  JSON.stringify({ modelo: MODELO, dominio: DOMAIN_VERSION, n: resultados.length, resultados }, null, 2),
  "utf8",
);

console.log(`\n  A: ${aciertoA}/${resultados.length} · B: ${aciertoB}/${conB.length}`);
console.log(`  falsos negativos en rojo: ${falsosNegativos.length} · rojos no marcados: ${rojosNoMarcados.length}`);
console.log(`  escrito: docs/evidencia-decision/muestra-estratificada.{md,json}\n`);
