/**
 * Comprobadores basicos. Cada uno acumula su problema en el sink y devuelve el
 * valor tipado o `undefined` — pero el `undefined` NUNCA sale del subsistema:
 * quien llama ya tiene el problema registrado y sigue validando el resto, para
 * que el usuario reciba todos los errores de una vez y no de a uno por ejecucion.
 */

import { agregar, describir, type IssueSink } from "./issues.ts";

export function esRegistro(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `hint` permite que el bloque obligatorio explique POR QUE se le exige, en vez
 * de caer al mensaje generico. Importa porque un `traces` ausente y un `coverage`
 * ausente no se arreglan igual, y quien recibe el error necesita saber cual es cual.
 * Sin este parametro haria falta emitir un segundo problema en la misma ruta, y
 * dos problemas para un solo defecto es ruido que esconde el resto de la lista.
 */
export function exigirObjeto(
  sink: IssueSink,
  path: string,
  valor: unknown,
  queEs: string,
  hint = "Revisa que el productor este enviando el objeto completo y no un fragmento.",
): Record<string, unknown> | undefined {
  if (!esRegistro(valor)) {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba ${queEs} (un objeto) y se recibio ${describir(valor)}.`,
      hint,
    );
    return undefined;
  }
  return valor;
}

export function exigirCadena(
  sink: IssueSink,
  path: string,
  valor: unknown,
  opciones: { noVacia?: boolean; hint: string },
): string | undefined {
  if (typeof valor !== "string") {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba una cadena y se recibio ${describir(valor)}.`,
      opciones.hint,
    );
    return undefined;
  }
  if (opciones.noVacia && valor.trim() === "") {
    agregar(
      sink,
      path,
      "vacio",
      `La cadena llego vacia, y este campo no admite vacio.`,
      opciones.hint,
    );
    return undefined;
  }
  return valor;
}

export function exigirCadenaONulo(
  sink: IssueSink,
  path: string,
  valor: unknown,
  hint: string,
): string | null | undefined {
  if (valor === null) return null;
  if (typeof valor === "string") return valor;
  agregar(
    sink,
    path,
    valor === undefined ? "campo_ausente" : "tipo_invalido",
    `Se esperaba una cadena o null y se recibio ${describir(valor)}.`,
    hint,
  );
  return undefined;
}

export function exigirBooleano(
  sink: IssueSink,
  path: string,
  valor: unknown,
  hint: string,
): boolean | undefined {
  if (typeof valor !== "boolean") {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba true o false y se recibio ${describir(valor)}.`,
      hint,
    );
    return undefined;
  }
  return valor;
}

export function exigirNumero(
  sink: IssueSink,
  path: string,
  valor: unknown,
  opciones: { min?: number; max?: number; entero?: boolean; hint: string },
): number | undefined {
  if (typeof valor !== "number" || Number.isNaN(valor)) {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba un numero y se recibio ${describir(valor)}.`,
      opciones.hint,
    );
    return undefined;
  }
  if (!Number.isFinite(valor)) {
    agregar(sink, path, "fuera_de_rango", `Se recibio ${valor}, que no es finito.`, opciones.hint);
    return undefined;
  }
  if (opciones.entero && !Number.isInteger(valor)) {
    agregar(
      sink,
      path,
      "no_entero",
      `Se esperaba un entero y se recibio ${valor}.`,
      opciones.hint,
    );
    return undefined;
  }
  const min = opciones.min;
  const max = opciones.max;
  if ((min !== undefined && valor < min) || (max !== undefined && valor > max)) {
    agregar(
      sink,
      path,
      "fuera_de_rango",
      `Se recibio ${valor}, fuera del rango admitido [${min ?? "-inf"}, ${max ?? "+inf"}].`,
      opciones.hint,
    );
    return undefined;
  }
  return valor;
}

export function exigirArreglo(
  sink: IssueSink,
  path: string,
  valor: unknown,
  opciones: { noVacio?: boolean; hint: string },
): unknown[] | undefined {
  if (!Array.isArray(valor)) {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba un arreglo y se recibio ${describir(valor)}.`,
      opciones.hint,
    );
    return undefined;
  }
  if (opciones.noVacio && valor.length === 0) {
    agregar(sink, path, "vacio", `El arreglo llego vacio, y aqui debe traer al menos un elemento.`, opciones.hint);
    return undefined;
  }
  return valor;
}

export function exigirArregloDeCadenas(
  sink: IssueSink,
  path: string,
  valor: unknown,
  opciones: { noVacio?: boolean; hint: string },
): string[] | undefined {
  const arr = exigirArreglo(sink, path, valor, opciones);
  if (arr === undefined) return undefined;
  let ok = true;
  arr.forEach((elemento, i) => {
    if (typeof elemento !== "string") {
      ok = false;
      agregar(
        sink,
        `${path}[${i}]`,
        "tipo_invalido",
        `Se esperaba una cadena y se recibio ${describir(elemento)}.`,
        opciones.hint,
      );
    }
  });
  return ok ? (arr as string[]) : undefined;
}

export function exigirEnum<const T extends readonly string[]>(
  sink: IssueSink,
  path: string,
  valor: unknown,
  admitidos: T,
  hint: string,
): T[number] | undefined {
  if (typeof valor !== "string") {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : "tipo_invalido",
      `Se esperaba uno de [${admitidos.join(" | ")}] y se recibio ${describir(valor)}.`,
      hint,
    );
    return undefined;
  }
  if (!admitidos.includes(valor)) {
    agregar(
      sink,
      path,
      "valor_fuera_de_enum",
      `Se recibio ${JSON.stringify(valor)}, que no esta entre los valores admitidos [${admitidos.join(" | ")}].`,
      hint,
    );
    return undefined;
  }
  return valor as T[number];
}

/**
 * Rechaza claves no declaradas en el contrato.
 *
 * No es rigidez por gusto: es lo que hace que la prueba negativa de ADR-011 falle
 * POR ESQUEMA y no por convencion. Un `SourceDocument` con `paciente_id` no es un
 * documento con un campo de mas — es la separacion conocimiento/estado rota, y
 * tiene que morir en la frontera.
 */
export function rechazarClavesDesconocidas(
  sink: IssueSink,
  path: string,
  objeto: Record<string, unknown>,
  declaradas: readonly string[],
  hint: string,
): void {
  for (const clave of Object.keys(objeto)) {
    if (!declaradas.includes(clave)) {
      agregar(
        sink,
        path === "" ? clave : `${path}.${clave}`,
        "campo_desconocido",
        `La clave ${JSON.stringify(clave)} no esta declarada en este contrato. Las declaradas son [${declaradas.join(", ")}].`,
        hint,
      );
    }
  }
}

/**
 * Busca claves prohibidas en TODA la profundidad del objeto.
 *
 * Recursivo a proposito: ADR-007 prohibe `severity` en el reporte y tambien dentro
 * de un `ClassHit`, y ADR-011 prohibe `paciente_id` en el documento y tambien
 * dentro de sus metadatos. Una comprobacion de primer nivel dejaria la puerta de
 * atras abierta, que es exactamente por donde vuelven las decisiones revertidas.
 */
export function rechazarClavesProhibidas(
  sink: IssueSink,
  path: string,
  valor: unknown,
  prohibidas: readonly string[],
  construirMensaje: (clave: string, ruta: string) => { message: string; hint: string },
): void {
  if (Array.isArray(valor)) {
    valor.forEach((elemento, i) => {
      rechazarClavesProhibidas(sink, `${path}[${i}]`, elemento, prohibidas, construirMensaje);
    });
    return;
  }
  if (!esRegistro(valor)) return;

  for (const [clave, contenido] of Object.entries(valor)) {
    const ruta = path === "" ? clave : `${path}.${clave}`;
    if (prohibidas.includes(clave)) {
      const { message, hint } = construirMensaje(clave, ruta);
      agregar(sink, ruta, "campo_prohibido", message, hint);
    }
    rechazarClavesProhibidas(sink, ruta, contenido, prohibidas, construirMensaje);
  }
}

/** Reporta identificadores repetidos donde el contrato exige unicidad. */
export function rechazarDuplicados(
  sink: IssueSink,
  path: string,
  ids: readonly (string | undefined)[],
  queEs: string,
  hint: string,
): void {
  const vistos = new Map<string, number>();
  ids.forEach((id, i) => {
    if (id === undefined) return;
    const primero = vistos.get(id);
    if (primero === undefined) {
      vistos.set(id, i);
      return;
    }
    agregar(
      sink,
      `${path}[${i}].id`,
      "duplicado",
      `El ${queEs} ${JSON.stringify(id)} ya se habia declarado en ${path}[${primero}].`,
      hint,
    );
  });
}
