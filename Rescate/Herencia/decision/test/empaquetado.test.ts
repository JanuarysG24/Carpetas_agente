/**
 * El paquete COMPILADO tiene que encontrar sus datos.
 *
 * ============ Por que esta prueba existe ============
 *
 * Las rutas al corpus y al lexico se resolvian relativas al modulo. Desde `src/` daban
 * lo correcto y desde `dist/src/` daban `dist/corpus` y `decision/docs/`, que no
 * existen. Las 166 pruebas corrian sobre `src/` y estaban en verde **mientras el
 * paquete empaquetado estaba roto**.
 *
 * Es el modo de fallo mas incomodo que hay: verde en desarrollo, ENOENT al desplegar, y
 * descubierto por quien clona. Esta prueba mira `dist/` a proposito — es el unico sitio
 * desde el que el fallo era visible.
 *
 * ==================================================
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(RAIZ, "dist", "src", "index.js");

test("las rutas a los datos se resuelven desde la raiz del paquete, no desde el modulo", async () => {
  const { CORPUS_REAL, RUTA_LEXICO } = await import("../src/index.ts");

  // Ni `dist` ni `src` pueden aparecer en la ruta: si aparecen, la ruta depende de si
  // el codigo esta compilado, que es justo el bug.
  for (const ruta of [CORPUS_REAL, RUTA_LEXICO]) {
    const normalizada = ruta.replace(/\\/g, "/");
    assert.ok(!/\/dist\//.test(normalizada), `${normalizada} depende de dist/`);
    assert.ok(!/\/src\//.test(normalizada), `${normalizada} depende de src/`);
    assert.ok(existsSync(ruta), `${normalizada} no existe`);
  }
});

test("desde dist/, el corpus y el lexico cargan de verdad", async (t) => {
  if (!existsSync(DIST)) {
    t.skip("no hay build; `npm run build` antes de exigirlo");
    return;
  }
  const M = await import(`file://${DIST.replace(/\\/g, "/")}`);

  const almacen = new M.AlmacenDeFuentes();
  assert.equal(M.cargarCorpusReal(almacen).ingeridos, 107);
  assert.equal(Object.keys(M.cargarLexico().unidades).length, 6);

  // Y el marco se construye: es lo que fallaba primero al desplegar, porque el lexico
  // viaja dentro de el.
  const frame = M.buildFrame(
    { patient_ref: "ref", unit_ids: M.UNIDADES_DEL_DOMINIO, dia_postop: 7 },
    "empaquetado",
    {},
  );
  assert.equal(frame.units.length, 6);
  assert.ok(frame.red_flags.length > 0);
});
