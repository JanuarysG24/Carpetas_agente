/**
 * WO-37 — la proyeccion del caso hacia el marco.
 *
 * ADR-019 le prohibe al entrevistador el contexto recuperado y ADR-020 le manda
 * hablar del proceso y no del cuadro. Si el `PatientCase` cruzara entero al
 * `ContextFrame`, esa prohibicion quedaria burlada por la puerta de al lado: el
 * modelo no veria el RAG, pero veria la historia del paciente, que es peor.
 *
 * La prueba que importa de este archivo es la ultima: un campo nuevo en el caso NO
 * llega al marco solo. Es lo que separa una proyeccion declarada de "el orquestador
 * toma lo que necesita".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PatientCase } from "@techsphere/contracts";
import {
  diasDesde,
  proyectarParaMarco,
  UNIDADES_DEL_DOMINIO,
  VistaDeCaso,
  componerAlmacen,
  VistaDeIdentidad,
} from "../src/index.ts";
import { REGISTROS } from "../src/pacientes/datos.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DOMINIO = join(AQUI, "..", "..", "docs", "dominio", "dominio-postop-v0.1.json");

const casos = new VistaDeCaso();
const AHORA = new Date("2026-08-08T14:30:00Z");

// ---------------------------------------------------------------------------
// La vista de caso
// ---------------------------------------------------------------------------

test("getCase resuelve la referencia opaca al caso completo", () => {
  const caso = casos.getCase("pref-9f2c41ab");
  assert.equal(caso.procedimiento, "apendicectomia");
  assert.equal(caso.fecha_cirugia, "2026-08-01");
});

test("una referencia que no resuelve lanza en vez de devolver un caso vacio", () => {
  assert.throws(() => casos.getCase("pref-inventada"), /no resuelve a ningun caso/);
});

// ---------------------------------------------------------------------------
// Que cruza hacia el marco, y que no
// ---------------------------------------------------------------------------

test("la proyeccion tiene un conjunto CERRADO de claves", () => {
  const p = casos.proyeccionParaMarco("pref-4d7e10c3", AHORA);
  assert.deepEqual(
    Object.keys(p).sort(),
    ["dia_postop", "patient_ref", "unit_ids"],
    "si esta forma crece, crece en un commit que dice por que",
  );
});

test("NINGUN dato clinico del caso cruza hacia el marco", () => {
  for (const registro of REGISTROS) {
    const proyeccion = casos.proyeccionParaMarco(registro.patient_ref, AHORA);
    const serializada = JSON.stringify(proyeccion);

    const clinicos = [
      registro.caso.procedimiento,
      String(registro.caso.edad),
      registro.caso.genero,
      ...registro.caso.comorbilidades,
      registro.caso.fecha_cirugia,
      registro.nombre,
    ];

    for (const dato of clinicos) {
      assert.ok(
        !serializada.includes(dato),
        `${JSON.stringify(dato)} llego al marco. El marco solo transporta que preguntar; ` +
          `el diagnostico, el procedimiento y los antecedentes se quedan de este lado (ADR-019, ADR-020)`,
      );
    }
  }
});

test("un campo NUEVO en el caso no llega al marco por su cuenta", () => {
  // El dia en que alguien añada un campo al caso, con la seleccion en el
  // orquestador el campo entraria al prompt sin que nadie lo decida. Con la
  // proyeccion declarada, no entra hasta que alguien lo agregue a mano y explique
  // por que. Esta prueba es la que hace verdadera esa frase.
  const conCampoNuevo = {
    ...casos.getCase("pref-2e6019f7"),
    diagnostico_oncologico: "carcinoma ductal infiltrante estadio II",
    nota_de_enfermeria: "paciente ansiosa, vive sola",
  } as unknown as PatientCase;

  const p = proyectarParaMarco(conCampoNuevo, AHORA);

  assert.deepEqual(Object.keys(p).sort(), ["dia_postop", "patient_ref", "unit_ids"]);
  const serializada = JSON.stringify(p);
  assert.ok(!serializada.includes("carcinoma"));
  assert.ok(!serializada.includes("vive sola"));
});

// ---------------------------------------------------------------------------
// Los tres campos que SI cruzan
// ---------------------------------------------------------------------------

test("las unidades del marco son las del dominio, no las columnas del dataset", () => {
  const dominio = JSON.parse(readFileSync(DOMINIO, "utf8")) as {
    funcion_de_clase: Record<string, unknown>;
  };

  assert.deepEqual(
    [...UNIDADES_DEL_DOMINIO].sort(),
    Object.keys(dominio.funcion_de_clase).sort(),
    "si el dominio crece, esta prueba falla y alguien decide, en vez de que la lista envejezca sola. " +
      "Un unit_id que no coincide con la funcion de clase colapsaba al fallback en silencio (D5)",
  );
  // Y ninguno es un nombre de columna del dataset.
  for (const columna of ["fiebre_c", "dolor_nrs", "herida"]) {
    assert.ok(!UNIDADES_DEL_DOMINIO.includes(columna));
  }
});

test("dia_postop es aritmetica sobre la fecha de cirugia, no criterio", () => {
  assert.equal(diasDesde("2026-08-01", new Date("2026-08-08T14:30:00Z")), 7);
  assert.equal(diasDesde("2026-08-08", new Date("2026-08-08T23:59:00Z")), 0);
  assert.equal(diasDesde("2026-08-05", new Date("2026-08-08T00:01:00Z")), 3);
  // Una fecha futura no produce dias negativos: la aritmetica se acota, no se cree.
  assert.equal(diasDesde("2026-09-01", new Date("2026-08-08T00:00:00Z")), 0);
});

test("un dia fuera de los declarados por el dominio se emite TAL CUAL", () => {
  // El dominio declara [1, 3, 7, 14]. Un dia 6 pierde el tramo con warning y hoy no
  // altera ninguna regla: ningun corte ni composicion esta condicionado por el
  // modificador. Mapearlo al valor declarado mas cercano seria decidir que un dia 6
  // es "temprano" o "tardio", y eso es criterio clinico que esta capa no escribe.
  const p = proyectarParaMarco(casos.getCase("pref-9f2c41ab"), new Date("2026-08-07T10:00:00Z"));
  assert.equal(p.dia_postop, 6);
});

test("la referencia que cruza es la opaca, la misma que emitio verifyIdentity", () => {
  const veredicto = new VistaDeIdentidad().verifyIdentity({
    name: "Luz Dary Ospina",
    verifier: { kind: "documento", value: "43567890" },
  });
  assert.equal(veredicto.status, "identificado");
  assert.equal(
    casos.proyeccionParaMarco(veredicto.patient_ref!, AHORA).patient_ref,
    veredicto.patient_ref,
  );
});

// ---------------------------------------------------------------------------
// La composicion del puerto vive del lado privilegiado
// ---------------------------------------------------------------------------

test("componerAlmacen satisface PatientStorePort con las dos vistas separadas", () => {
  const almacen = componerAlmacen(new VistaDeIdentidad(), casos);
  const v = almacen.verifyIdentity({
    name: "Ana Maria Restrepo Gomez",
    verifier: { kind: "fecha_procedimiento", value: "2026-08-01" },
  });
  assert.equal(v.status, "identificado");
  assert.equal(almacen.getCase(v.patient_ref!).procedimiento, "apendicectomia");
});
