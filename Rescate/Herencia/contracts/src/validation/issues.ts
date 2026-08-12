/**
 * El vocabulario de la validacion.
 *
 * Regla que gobierna todo el subsistema: NINGUN RECHAZO SILENCIOSO. Un dato malo
 * jamas produce `undefined`, `null` ni un objeto a medias. Produce una lista de
 * `ValidationIssue` que dice DONDE esta el problema, QUE se recibio, QUE se
 * esperaba y QUE hacer al respecto.
 *
 * El motivo es concreto: estos contratos los van a implementar cuatro capas en
 * sesiones distintas, y un `undefined` que viaja tres capas antes de explotar
 * cuesta mas depurar que todo el modulo.
 */

export type ValidationCode =
  /** El campo obligatorio no vino. */
  | "campo_ausente"
  /** Vino, pero de otro tipo. */
  | "tipo_invalido"
  /** Vino con un valor fuera del enumerado. */
  | "valor_fuera_de_enum"
  /** Numero fuera del rango declarado. */
  | "fuera_de_rango"
  /** Se esperaba entero y llego decimal. */
  | "no_entero"
  /** Cadena o coleccion vacia donde la spec exige contenido. */
  | "vacio"
  /** Identificador repetido donde debe ser unico. */
  | "duplicado"
  /** Referencia a algo que no existe (`depends_on`, `composes`). */
  | "referencia_rota"
  /** Clave no declarada en el contrato. */
  | "campo_desconocido"
  /** Clave que un ADR prohibe explicitamente. */
  | "campo_prohibido"
  /** Los campos son validos por separado y se contradicen entre si. */
  | "incoherencia";

export interface ValidationIssue {
  /** Ruta al dato: `units[2].priority`, `decision.traces.doc_ids`. */
  path: string;
  code: ValidationCode;
  /** Que esta mal, en concreto y con el valor recibido. */
  message: string;
  /** Que hacer al respecto, con la referencia a la spec o al ADR que lo manda. */
  hint: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Acumulador. Se pasa por las funciones de validacion y se lee al final. */
export type IssueSink = ValidationIssue[];

export function agregar(
  sink: IssueSink,
  path: string,
  code: ValidationCode,
  message: string,
  hint: string,
): void {
  sink.push({ path, code, message, hint });
}

export function resultado(issues: IssueSink): ValidationResult {
  return { valid: issues.length === 0, issues };
}

/** Error de contrato con todos los problemas formateados, no solo el primero. */
export class ContractValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(etiqueta: string, issues: readonly ValidationIssue[]) {
    super(`${etiqueta}: ${issues.length} problema(s) de contrato.\n${formatear(issues)}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

/** Formato legible en consola y en log. Una linea por problema, con la ruta primero. */
export function formatear(issues: readonly ValidationIssue[]): string {
  return issues
    .map((i) => `  - [${i.code}] ${i.path}\n      ${i.message}\n      -> ${i.hint}`)
    .join("\n");
}

/**
 * Convierte un resultado en excepcion. Para los bordes donde seguir con un dato
 * invalido es peor que caerse: la frontera de un puerto, la ingesta de la consola.
 */
export function exigirValido(etiqueta: string, res: ValidationResult): void {
  if (!res.valid) throw new ContractValidationError(etiqueta, res.issues);
}

/** Describe un valor recibido sin volcar objetos enteros al mensaje. */
export function describir(valor: unknown): string {
  if (valor === null) return "null";
  if (valor === undefined) return "undefined";
  if (Array.isArray(valor)) return `array de ${valor.length} elemento(s)`;
  if (typeof valor === "string") return `la cadena ${JSON.stringify(valor)}`;
  if (typeof valor === "object") return `un objeto con claves [${Object.keys(valor).join(", ")}]`;
  return `${typeof valor} ${String(valor)}`;
}
