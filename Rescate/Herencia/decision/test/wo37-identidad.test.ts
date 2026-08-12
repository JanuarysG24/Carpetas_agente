/**
 * WO-37 — la vista de identidad: veredicto y referencia opaca, jamas datos.
 *
 * La prueba de privilegio no comprueba una convencion: comprueba la SUPERFICIE del
 * modulo. La conversacional no puede filtrar lo que no recibe, y no recibe el caso
 * porque el modulo que expone `verifyIdentity` no tiene forma de llegar a el.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as moduloDeIdentidad from "../src/pacientes/identidad.ts";
import { VistaDeIdentidad } from "../src/index.ts";
import { REGISTROS } from "../src/pacientes/datos.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const identidad = new VistaDeIdentidad();

// ---------------------------------------------------------------------------
// Los tres veredictos
// ---------------------------------------------------------------------------

test("nombre + fecha correcta devuelve identificado y una referencia opaca", () => {
  const v = identidad.verifyIdentity({
    name: "Ana Maria Restrepo Gomez",
    verifier: { kind: "fecha_procedimiento", value: "2026-08-01" },
  });

  assert.equal(v.status, "identificado");
  assert.equal(v.patient_ref, "pref-9f2c41ab");
});

test("el paciente no deletrea: acentos, mayusculas y formatos de fecha se toleran", () => {
  for (const name of ["ANA MARÍA RESTREPO GÓMEZ", "  ana maria  restrepo gomez "]) {
    assert.equal(identidad.verifyIdentity({ name, verifier: { kind: "fecha_procedimiento", value: "2026-08-01" } }).status, "identificado");
  }
  for (const value of ["2026-08-01", "01/08/2026", "20260801"]) {
    assert.equal(identidad.verifyIdentity({ name: "Ana Maria Restrepo Gomez", verifier: { kind: "fecha_procedimiento", value } }).status, "identificado");
  }
  // El documento se compara por digitos: el paciente dicta con puntos o sin ellos.
  assert.equal(identidad.verifyIdentity({ name: "Ana Maria Restrepo Gomez", verifier: { kind: "documento", value: "1.032.456.789" } }).status, "identificado");
});

test("dos homonimos se separan por el verificador, y solo por el", () => {
  const uno = identidad.verifyIdentity({
    name: "Carlos Andres Munoz",
    verifier: { kind: "documento", value: "8012345" },
  });
  const otro = identidad.verifyIdentity({
    name: "Carlos Andres Munoz",
    verifier: { kind: "documento", value: "1098765432" },
  });

  assert.equal(uno.status, "identificado");
  assert.equal(otro.status, "identificado");
  assert.notEqual(uno.patient_ref, otro.patient_ref);
  // Hidratar el marco equivocado no produce una conversacion imperfecta: produce
  // una decision clinica sobre el paciente equivocado.
});

test("un verificador debil que casa con los dos homonimos devuelve ambiguo SIN enumerar", () => {
  // Los dos Carlos estan en EPS distintas, asi que se fabrica el empate: dos
  // registros con el mismo nombre y la misma EPS.
  const conEmpate = new VistaDeIdentidad([
    REGISTROS[1]!,
    { ...REGISTROS[2]!, verificadores: { ...REGISTROS[2]!.verificadores, eps: REGISTROS[1]!.verificadores.eps } },
  ]);

  const v = conEmpate.verifyIdentity({
    name: "Carlos Andres Munoz",
    verifier: { kind: "eps", value: "Nueva EPS" },
  });

  assert.equal(v.status, "ambiguo");
  assert.equal(v.patient_ref, undefined, "ambiguo no devuelve referencia: no se sabe de quien");
  assert.deepEqual(
    Object.keys(v),
    ["status"],
    "no enumera opciones: pedirle al paciente que elija entre dos fechas de cirugia ajenas seria " +
      "divulgar, e invita a acertar por eliminacion",
  );
});

test("un nombre que no existe devuelve no_encontrado", () => {
  assert.equal(
    identidad.verifyIdentity({ name: "Persona Que No Existe", verifier: { kind: "eps", value: "Sura" } }).status,
    "no_encontrado",
  );
});

test("nombre real con verificador equivocado tambien sale no_encontrado, y es deliberado", () => {
  // Si respondiera "ambiguo" o cualquier cosa distinta de no_encontrado, estaria
  // confirmando que el nombre SI esta en la base: la verificacion se convertiria en
  // un oraculo de pertenencia con el que se puede sondear la base un nombre a la vez.
  const v = identidad.verifyIdentity({
    name: "Ana Maria Restrepo Gomez",
    verifier: { kind: "fecha_procedimiento", value: "2020-01-01" },
  });
  assert.equal(v.status, "no_encontrado");
  assert.deepEqual(Object.keys(v), ["status"]);
});

test("un nombre vacio no identifica a nadie", () => {
  assert.equal(identidad.verifyIdentity({ name: "   ", verifier: { kind: "eps", value: "Sura" } }).status, "no_encontrado");
});

// ---------------------------------------------------------------------------
// La respuesta no lleva datos: ni uno
// ---------------------------------------------------------------------------

test("NINGUN dato del caso aparece en la respuesta, sea cual sea el veredicto", () => {
  const sensibles = REGISTROS.flatMap((r) => [
    r.nombre,
    r.verificadores.fecha_procedimiento,
    r.verificadores.documento,
    r.verificadores.eps,
    r.caso.procedimiento,
    String(r.caso.edad),
    r.caso.genero,
    ...r.caso.comorbilidades,
  ]);

  const respuestas = [
    identidad.verifyIdentity({ name: "Ana Maria Restrepo Gomez", verifier: { kind: "fecha_procedimiento", value: "2026-08-01" } }),
    identidad.verifyIdentity({ name: "Carlos Andres Munoz", verifier: { kind: "eps", value: "Sura" } }),
    identidad.verifyIdentity({ name: "Nadie", verifier: { kind: "eps", value: "Sura" } }),
  ];

  for (const r of respuestas) {
    const serializada = JSON.stringify(r);
    for (const dato of sensibles) {
      assert.ok(
        !serializada.includes(dato),
        `la respuesta ${serializada} contiene ${JSON.stringify(dato)}: verifyIdentity devuelve veredicto y referencia, nunca datos`,
      );
    }
  }
});

test("la referencia es opaca: no se deriva del nombre ni de la fecha", () => {
  for (const r of REGISTROS) {
    const ref = r.patient_ref.toLowerCase();
    for (const trozo of r.nombre.toLowerCase().split(" ")) {
      assert.ok(!ref.includes(trozo), `${r.patient_ref} contiene parte del nombre`);
    }
    assert.ok(
      !ref.includes(r.verificadores.documento) &&
        !ref.includes(r.verificadores.fecha_procedimiento.replace(/-/g, "")),
      `${r.patient_ref} se deriva de un verificador: un identificador reversible por diccionario ` +
        `divulga lo mismo que la referencia promete no divulgar, y encima parece seguro`,
    );
  }
});

// ---------------------------------------------------------------------------
// La prueba de PRIVILEGIO: por superficie, no por convencion
// ---------------------------------------------------------------------------

test("el modulo que expone verifyIdentity NO exporta getCase", () => {
  const exportado = Object.keys(moduloDeIdentidad);
  assert.ok(exportado.includes("VistaDeIdentidad"));
  for (const prohibido of ["getCase", "VistaDeCaso", "REGISTROS", "proyectarParaMarco"]) {
    assert.ok(
      !exportado.includes(prohibido),
      `identidad.ts exporta ${prohibido}: la separacion de vistas dejo de sostenerse en la estructura`,
    );
  }
});

test("la vista de identidad no tiene NINGUNA operacion mas que verifyIdentity", () => {
  const metodos = Object.getOwnPropertyNames(VistaDeIdentidad.prototype).filter((n) => n !== "constructor");
  assert.deepEqual(metodos, ["verifyIdentity"]);
});

test("identidad.ts ni siquiera importa el modulo que sabe leer casos", () => {
  const fuente = readFileSync(join(AQUI, "..", "src", "pacientes", "identidad.ts"), "utf8");
  const imports = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(
    !imports.some((i) => i?.includes("casos")),
    "si este archivo llega a importar casos.ts, el privilegio se rompio antes de que nadie lo note",
  );
});
