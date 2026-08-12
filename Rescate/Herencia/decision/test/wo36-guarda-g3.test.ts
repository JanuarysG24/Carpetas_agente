/**
 * WO-36 — la guarda de la compuerta G3, UNA POR RUTA.
 *
 * G3 es la unica compuerta que DESCALIFICA en vez de despuntuar, y se verifica
 * "contra tus dependencias, tu configuracion y tu codigo". Estas tres cosas se
 * prueban aqui, en ese orden, porque en ese orden las mira un auditor.
 *
 * El modo de fallo que estas pruebas cierran ya ocurrio una vez (H16): al migrar de
 * local a nube quedo protegida solo la ruta local. La salvaguarda existia, se veia
 * en el codigo, y cubria justo la ruta que menos importa.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AdaptadorNube,
  ErrorDeCompuertaG3,
  ErrorDeCredencial,
  exigirModeloPermitido,
  MODELOS_PERMITIDOS,
  TEMPERATURA_POR_ROL,
  type RutaDeModelo,
} from "../src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");

// ADR-025 (8-ago): la ruta local se retiro por completo. La ESTRUCTURA de listas
// por ruta se conserva integra —es el arreglo de H16— y sigue protegiendo las dos
// rutas de nube.
const RUTAS: RutaDeModelo[] = ["nube_groq", "nube_google"];

// ---------------------------------------------------------------------------
// 1. Una guarda por ruta, cada una contra SU lista
// ---------------------------------------------------------------------------

test("cada ruta acepta los modelos de su propia lista", () => {
  for (const ruta of RUTAS) {
    for (const modelo of MODELOS_PERMITIDOS[ruta]) {
      assert.equal(exigirModeloPermitido(ruta, modelo), modelo);
    }
  }
});

test("ninguna ruta acepta el modelo de otra ruta: las listas no se mezclan", () => {
  for (const ruta of RUTAS) {
    const ajenos = RUTAS.filter((r) => r !== ruta).flatMap((r) => [...MODELOS_PERMITIDOS[r]]);
    for (const ajeno of ajenos) {
      assert.throws(
        () => exigirModeloPermitido(ruta, ajeno),
        ErrorDeCompuertaG3,
        `La ruta "${ruta}" acepto ${ajeno}, que es de otro catalogo. Una lista que mezcla ` +
          `nombres de Ollama con identificadores de nube no protege de nada (ADR-021 §8c-bis.1).`,
      );
    }
  }
});

test("un modelo inventado no pasa por ninguna ruta, y el error dice cual era la lista", () => {
  for (const ruta of RUTAS) {
    assert.throws(
      () => exigirModeloPermitido(ruta, "gpt-4o"),
      (e: unknown) => {
        assert.ok(e instanceof ErrorDeCompuertaG3);
        assert.equal(e.ruta, ruta);
        assert.equal(e.modelo, "gpt-4o");
        assert.match(e.message, /no esta en la lista cerrada/);
        for (const permitido of MODELOS_PERMITIDOS[ruta]) {
          assert.ok(
            e.message.includes(permitido),
            "el mensaje tiene que enumerar la lista de ESA ruta para ser accionable",
          );
        }
        return true;
      },
    );
  }
});

// ---------------------------------------------------------------------------
// 2. El fallo es AL ARRANCAR, no al primer turno
// ---------------------------------------------------------------------------

test("el adaptador no se construye con un modelo fuera de lista", () => {
  assert.throws(
    () =>
      new AdaptadorNube({
        ruta: "nube_groq",
        modelo: "llama3.2:3b", // el del respaldo retirado: ya no esta en ninguna lista
        api_key: "clave-de-prueba",
      }),
    ErrorDeCompuertaG3,
  );
});

test("ADR-025 · la ruta local ya no existe, y sus modelos no arrancan por ninguna parte", () => {
  assert.deepEqual(Object.keys(MODELOS_PERMITIDOS).sort(), ["nube_google", "nube_groq"]);
  for (const retirado of ["llama3.2:3b", "llama3.2:1b", "phi3.5:3.8b"]) {
    for (const ruta of RUTAS) {
      assert.throws(() => exigirModeloPermitido(ruta, retirado), ErrorDeCompuertaG3);
    }
  }
  // Un componente sin trabajo no es una reserva: es superficie que se mantiene sola.
  // Se retira del codigo, no se deja "por si acaso" — y los numeros que lo evaluaron
  // siguen en bench/ como la evidencia de que se midio antes de retirarlo.
});

test("la guarda de G3 corre ANTES que la credencial: sin clave y con modelo malo, gana G3", () => {
  // El orden importa. Un proceso mal configurado no debe llegar a quejarse de que
  // le falta la clave: debe no levantar por la razon que descalifica.
  assert.throws(
    () => new AdaptadorNube({ ruta: "nube_groq", modelo: "modelo-que-no-existe", api_key: "" }),
    ErrorDeCompuertaG3,
  );
  // Y con el modelo bien, la credencial vuelve a ser el problema que si es.
  assert.throws(
    () => new AdaptadorNube({ ruta: "nube_groq", modelo: "llama-3.3-70b-versatile", api_key: "  " }),
    ErrorDeCredencial,
  );
});

test("el adaptador guarda el nombre validado, no el que le pasaron", () => {
  const adaptador = new AdaptadorNube({
    ruta: "nube_groq",
    modelo: "llama-3.3-70b-versatile",
    api_key: "clave-de-prueba",
  });
  assert.equal(adaptador.modelo, "llama-3.3-70b-versatile");
  assert.equal(adaptador.ruta, "nube_groq");
});

// ---------------------------------------------------------------------------
// 3. Auditoria: dependencias y codigo
// ---------------------------------------------------------------------------

test("el paquete no declara NINGUN SDK de proveedor de modelos", () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declaradas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  const prohibidas = [
    "groq-sdk",
    "openai",
    "@google/generative-ai",
    "@google/genai",
    "@anthropic-ai/sdk",
    "ollama",
    "langchain",
    "@langchain/core",
  ];
  for (const prohibida of prohibidas) {
    assert.ok(
      !declaradas.includes(prohibida),
      `${prohibida} en las dependencias hace opaca la verificacion de G3: se habla HTTP plano ` +
        `para que la auditoria sea trivial.`,
    );
  }
  assert.deepEqual(
    Object.keys(pkg.dependencies ?? {}).sort(),
    ["@techsphere/contracts", "@techsphere/conversational", "@techsphere/deterministic"],
    "las unicas dependencias de runtime son paquetes de este mismo repositorio: nada de terceros",
  );
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    assert.ok(dep.startsWith("@techsphere/"), `${dep} es una dependencia externa y aqui no entra ninguna`);
  }
});

/**
 * La regla es sobre CODIGO, no sobre prosa: lo que no puede repetirse es la
 * constante, porque dos constantes se desincronizan y una de ellas se queda sin
 * guarda. Nombrar el modelo en un comentario que explica por que no admite
 * `json_schema` no crea ese riesgo — y una prueba que lo prohibiera acabaria
 * empujando a borrar la explicacion, que es lo contrario de lo que se quiere.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("una sola constante de modelo por ruta: los identificadores no se repiten en el codigo", () => {
  const fuentes: string[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".ts")) fuentes.push(ruta);
    }
  };
  recorrer(join(RAIZ, "src"));

  const todos = RUTAS.flatMap((r) => [...MODELOS_PERMITIDOS[r]]);
  for (const modelo of todos) {
    const conElNombre = fuentes.filter((f) => sinComentarios(readFileSync(f, "utf8")).includes(modelo));
    assert.deepEqual(
      conElNombre.map((f) => f.replace(RAIZ, "").replace(/\\/g, "/")),
      ["/src/modelo/rutas.ts"],
      `El nombre ${modelo} aparece fuera de rutas.ts. La regla de auditoria de ADR-017 sigue en pie: ` +
        `una sola constante de modelo por adaptador, y ninguna segunda URL de inferencia en otro archivo.`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. La asimetria de temperatura (ADR-021)
// ---------------------------------------------------------------------------

test("temperature 0 en el rol decider y no en el interviewer", () => {
  assert.equal(TEMPERATURA_POR_ROL.decider, 0);
  assert.ok(
    TEMPERATURA_POR_ROL.interviewer > 0,
    "en el entrevistador una variacion pequeña favorece la naturalidad, que es lo que la rubrica " +
      "evalua en tono y registro",
  );
});
