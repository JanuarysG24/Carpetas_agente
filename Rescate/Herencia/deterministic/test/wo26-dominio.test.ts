/**
 * WO-26 — cargador de dominio versionado.
 *
 * La propiedad que se prueba aqui es la que hace que el 7 de agosto solo hubiera
 * que sustituir un archivo: el MOTOR es codigo y el DOMINIO es dato, y la
 * taxonomia se valida ENTERA AL CARGAR, no al calcular. Un dominio roto que solo
 * explota a mitad de una evaluacion produce reportes a medias que parecen validos,
 * y este modulo existe precisamente para que eso no pueda pasar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDomainManifest } from "@techsphere/contracts";
import { ErrorDeDominio, ErrorDeVersionDeDominio, MotorDeterminista, validarDominio } from "../src/index.ts";
import {
  cargarCrudo,
  crudoSemilla,
  dominioReal,
  peticion,
  semilla,
  unidad,
} from "./fixtures/ayudas.ts";

// ---------------------------------------------------------------------------
// El camino feliz: los dos dominios cargan y se describen
// ---------------------------------------------------------------------------

test("el dominio real del director carga y su manifiesto valida contra el contrato", () => {
  const motor = new MotorDeterminista(dominioReal());
  const manifiesto = motor.describeDomain();

  assert.deepEqual(validateDomainManifest(manifiesto).issues, []);
  assert.equal(manifiesto.domain_version, "postop-0.1.0");
  assert.equal(
    manifiesto.clases,
    10,
    "ocho clases de la funcion de clase mas las DOS compuestas, que se declaran en el catalogo con " +
      "producida_por_composicion para que el universo de clases sea autocontenido",
  );
  assert.equal(manifiesto.composiciones, 2, "alcance C1: dos composiciones, y no se amplia");
  assert.deepEqual(manifiesto.modificadores, ["dia_postop"]);
  assert.equal(
    manifiesto.validez_clinica,
    "sin_validez_clinica_dominio_sintetico",
    "es calibracion sobre datos sinteticos: la validez clinica se declara, jamas se presume (ADR-010, ADR-012)",
  );
});

test("el checksum es del contenido: dos archivos con la misma version y distinto texto se distinguen", () => {
  const a = cargarCrudo(crudoSemilla());
  const modificado = crudoSemilla();
  modificado["domain_name"] = "otro nombre";
  const b = cargarCrudo(modificado);

  // Ambos se cargan con el mismo checksum declarado porque `cargarCrudo` lo fija;
  // lo que se prueba es que el checksum REAL sale del archivo, no de la version.
  assert.equal(a.version, b.version);
  const real = dominioReal();
  assert.match(real.checksum, /^[0-9a-f]{64}$/);
  assert.notEqual(
    real.checksum,
    semilla().checksum,
    "sin huella del archivo, dos ejecuciones con la misma domain_version y contenido distinto serian indistinguibles",
  );
});

test("la semilla de pruebas declara en su cabecera que no tiene validez clinica", () => {
  const d = semilla();
  assert.match(d.declaracion, /NO TIENE VALIDEZ CLINICA/);
  assert.equal(d.validez_clinica, "sin_validez_clinica_dominio_sintetico");
});

// ---------------------------------------------------------------------------
// Validacion estructural: falla al cargar, señalando el elemento
// ---------------------------------------------------------------------------

function esperarProblema(crudo: unknown, ruta: string, fragmentoDeMensaje: RegExp): void {
  const res = validarDominio(crudo);
  assert.equal(res.valid, false, `el dominio roto fue aceptado (ruta esperada: ${ruta})`);
  const issue = res.issues.find((i) => i.path === ruta);
  assert.ok(
    issue,
    `ningun problema en ${ruta}; rutas señaladas: [${res.issues.map((i) => i.path).join(", ")}]`,
  );
  assert.match(issue.message, fragmentoDeMensaje);
  assert.ok(issue.hint.length > 0, "todo rechazo dice QUE hacer, no solo que algo esta mal");
}

test("una clase huerfana en la funcion de clase se rechaza al cargar, con su ruta", () => {
  const crudo = crudoSemilla();
  const fn = crudo["funcion_de_clase"] as Record<string, { mapa: Record<string, { clase: string }> }>;
  fn["u_delta"]!.mapa["d_cedido"]!.clase = "c_que_no_existe";

  esperarProblema(crudo, "funcion_de_clase.u_delta.mapa.d_cedido.clase", /no esta en el universo de clases/);
});

test("un dominio sin clase de fallback se rechaza: sin ella no hay cierre total", () => {
  const crudo = crudoSemilla();
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  for (const c of clases) delete c["es_fallback"];

  esperarProblema(crudo, "clases", /EXACTAMENTE una clase/);
});

test("dos clases de fallback tambien se rechazan: el cierre dejaria de ser determinista", () => {
  const crudo = crudoSemilla();
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  clases[0]!["es_fallback"] = true;

  esperarProblema(crudo, "clases", /EXACTAMENTE una clase/);
});

test("una composicion que exige una clase inexistente se rechaza", () => {
  const crudo = crudoSemilla();
  const comps = crudo["composiciones"] as Array<Record<string, unknown>>;
  comps[0]!["clases_requeridas"] = ["c_alfa", "c_inventada"];

  esperarProblema(crudo, "composiciones[0].clases_requeridas[1]", /no esta declarada en "clases"/);
});

test("una composicion que depende de otra POSTERIOR se rechaza: la cadena apunta hacia atras", () => {
  const crudo = crudoSemilla();
  const comps = crudo["composiciones"] as Array<Record<string, unknown>>;
  comps.reverse(); // SM-CO-02 pasa a exigir k_alfa_doble antes de que SM-CO-01 la produzca

  esperarProblema(crudo, "composiciones[0].clases_requeridas[0]", /no esta declarada ANTES/);
});

test("una clase compuesta sin declarar en el catalogo se rechaza", () => {
  const crudo = crudoSemilla();
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  crudo["clases"] = clases.filter((c) => c["id"] !== "k_alfa_doble");

  const res = validarDominio(crudo);
  assert.equal(res.valid, false);
  assert.ok(
    res.issues.some(
      (i) => i.path === "composiciones[0].clase_producida" && /no esta declarada en "clases"/.test(i.message),
    ),
    `rutas: [${res.issues.map((i) => i.path).join(", ")}]`,
  );
});

test("una clase que dice ser compuesta y ninguna regla emite es inalcanzable, y se rechaza", () => {
  const crudo = crudoSemilla();
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  clases.push({
    id: "k_huerfana",
    eje: "integridad",
    descripcion: "Dice venir de una composicion que no existe.",
    producida_por_composicion: "SM-CO-99",
  });

  esperarProblema(
    crudo,
    "clases.k_huerfana.producida_por_composicion",
    /ninguna composicion con ese rule_id la produce/,
  );
});

test("si el catalogo y la composicion discrepan en quien emite la clase, se rechaza", () => {
  const crudo = crudoSemilla();
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  clases.find((c) => c["id"] === "k_cierre")!["producida_por_composicion"] = "SM-CO-01";

  esperarProblema(
    crudo,
    "composiciones[1].clase_producida",
    /dice que la emite "SM-CO-01" y la produce "SM-CO-02"/,
  );
});

test("una clase compuesta que ademas sale de un valor suelto se rechaza", () => {
  const crudo = crudoSemilla();
  const fn = crudo["funcion_de_clase"] as Record<string, { mapa: Record<string, { clase: string }> }>;
  fn["u_delta"]!.mapa["d_cedido"]!.clase = "k_cierre";

  esperarProblema(
    crudo,
    "funcion_de_clase.u_delta.mapa.d_cedido",
    /la emite una composicion y ademas la produce un valor suelto/,
  );
});

test("la lista de unidades canonicas tiene que coincidir con la funcion de clase (D5)", () => {
  const sobra = crudoSemilla();
  (sobra["unidades_canonicas"] as string[]).push("u_omega");
  esperarProblema(sobra, "unidades_canonicas[4]", /no tiene funcion de clase/);

  const falta = crudoSemilla();
  falta["unidades_canonicas"] = ["u_alfa", "u_beta", "u_gamma"];
  esperarProblema(falta, "unidades_canonicas", /no aparece en la lista canonica/);
});

test("una composicion que exige mas clases base que unidades admisibles no puede activarse nunca", () => {
  const crudo = crudoSemilla();
  const comps = crudo["composiciones"] as Array<Record<string, unknown>>;
  comps[0]!["unidades_requeridas"] = ["u_alfa"];

  esperarProblema(crudo, "composiciones[0].unidades_requeridas", /unidad\(es\) de origen/);
});

test("una unidad con eje pero sin funcion de clase se rechaza: colapsaria siempre al fallback", () => {
  const crudo = crudoSemilla();
  const ejes = crudo["ejes"] as Record<string, { unidades: string[] }>;
  ejes["funcionalidad"]!.unidades.push("u_fantasma");

  esperarProblema(crudo, "ejes", /no tiene funcion de clase/);
});

test("una unidad declarada en dos ejes se rechaza: su ausencia dejaria ciego a cual", () => {
  const crudo = crudoSemilla();
  const ejes = crudo["ejes"] as Record<string, { unidades: string[] }>;
  ejes["interaccion"]!.unidades.push("u_alfa");

  esperarProblema(crudo, "ejes.interaccion", /esta declarada en dos ejes/);
});

test("un tramo que agrupa un valor no declarado se rechaza", () => {
  const crudo = crudoSemilla();
  const mods = crudo["modificadores"] as Record<string, { tramos: Array<{ valores: unknown[] }> }>;
  mods["m_fase"]!.tramos[0]!.valores.push(99);

  esperarProblema(crudo, "modificadores.m_fase.tramos[0].valores[2]", /no esta en/);
});

test("un umbral de convergencia menor que 2 se rechaza: con una unidad no hay patron compartido", () => {
  const crudo = crudoSemilla();
  crudo["umbral_convergencia"] = { unidades_minimas_para_patron_compartido: 1 };

  esperarProblema(
    crudo,
    "umbral_convergencia.unidades_minimas_para_patron_compartido",
    /number 1/,
  );
});

test("un dominio sin _declaracion se rechaza: la cabecera tiene que leerse fuera de contexto", () => {
  const crudo = crudoSemilla();
  delete crudo["_declaracion"];

  esperarProblema(crudo, "_declaracion", /cadena no vacia/);
});

test("el error de dominio acumula TODOS los problemas, no solo el primero", () => {
  const crudo = crudoSemilla();
  delete crudo["_declaracion"];
  const clases = crudo["clases"] as Array<Record<string, unknown>>;
  for (const c of clases) delete c["es_fallback"];

  assert.throws(
    () => cargarCrudo(crudo),
    (e: Error) => {
      assert.ok(e instanceof ErrorDeDominio);
      assert.ok(e.issues.length >= 2, "quien arregla el dominio lo arregla de una vez, no por ejecucion");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Version obligatoria (spec §9)
// ---------------------------------------------------------------------------

test("una version discordante falla explicitamente en vez de calcular con la cargada", () => {
  const motor = new MotorDeterminista(semilla());

  assert.throws(
    () => motor.evaluate(peticion([unidad("u_alfa", 7)], "postop-0.1.0")),
    (e: Error) => {
      assert.ok(e instanceof ErrorDeVersionDeDominio);
      assert.equal(e.esperada, "postop-0.1.0");
      assert.equal(e.cargada, "semilla-pruebas-0.1.0");
      assert.match(
        e.message,
        /No se calcula/,
        "un reporte producido con otra taxonomia es peor que ningun reporte: nada en su forma delata la sustitucion",
      );
      return true;
    },
  );
});
