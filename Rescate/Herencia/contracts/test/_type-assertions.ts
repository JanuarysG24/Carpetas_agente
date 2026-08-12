/**
 * Utilidades de asercion A NIVEL DE TIPO.
 *
 * Las pruebas negativas de este modulo (campos prohibidos del reporte determinista,
 * paciente en el RAG) tienen que fallar en DOS momentos: al compilar, si alguien
 * agrega el campo al tipo, y en ejecucion, si alguien lo cuela en un objeto. Este
 * archivo cubre el primero: cualquier violacion rompe `npm run typecheck`.
 */

/** Falla la compilacion si `T` no es exactamente `true`. */
export type Expect<T extends true> = T;

/** Igualdad estricta de tipos (invariante, no bidireccionalmente asignable). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** `true` si `T` NO tiene ninguna de las claves `K`. Es la forma de las pruebas negativas. */
export type HasNoKey<T, K extends string> = [Extract<keyof T, K>] extends [never] ? true : false;

/** `true` si `T` tiene todas las claves `K` como requeridas (no opcionales). */
export type HasRequiredKey<T, K extends string> = K extends keyof T
  ? object extends Pick<T, K & keyof T>
    ? false
    : true
  : false;
