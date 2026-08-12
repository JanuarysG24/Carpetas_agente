/**
 * Rutas a los datos que el paquete carga de disco: el corpus y el lexico.
 *
 * ============ Por que no valen las rutas relativas al modulo ============
 *
 * `join(dirname(import.meta.url), "..", "..", "corpus")` da una cosa distinta segun
 * desde donde se ejecute: desde `src/conocimiento/` apunta a `decision/corpus`, y desde
 * `dist/src/conocimiento/` apunta a `dist/corpus`, que no existe.
 *
 * Las pruebas corren sobre `src/` y por eso pasaban en verde mientras el paquete
 * COMPILADO estaba roto — que es el modo de fallo mas incomodo: verde en desarrollo,
 * ENOENT en el empaquetado, y descubierto al desplegar.
 *
 * Se resuelve desde la RAIZ DEL PAQUETE, encontrada subiendo hasta el `package.json`.
 * Esa raiz es la misma en las dos formas, asi que la ruta deja de depender de si el
 * codigo esta compilado.
 *
 * ======================================================================
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function raizDelPaquete(desde: string): string {
  let dir = dirname(desde);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error(
    `No se encontro la raiz del paquete subiendo desde ${desde}. ` +
      `Los datos que el paquete carga —corpus y lexico— se resuelven desde ahi para que ` +
      `la ruta sea la misma ejecutando desde src/ y desde dist/.`,
  );
}

/** `decision/`, tanto ejecutando desde `src/` como desde `dist/src/`. */
export const RAIZ_PAQUETE = raizDelPaquete(fileURLToPath(import.meta.url));

/** La raiz del repositorio: el corpus es del paquete, pero el dominio y el lexico son del proyecto. */
export const RAIZ_REPO = dirname(RAIZ_PAQUETE);
