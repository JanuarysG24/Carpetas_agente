/**
 * Los errores del adaptador de modelo, tipificados.
 *
 * La distincion no es ceremonia: WO-42 y WO-44 capturan `ErrorDeModelo` y degradan
 * por ADR-014 con `reason_code: "falla_tecnica"`, y `ErrorDeCompuertaG3` —que vive
 * en `rutas.ts` y NO hereda de este— queda deliberadamente fuera de esa captura.
 * Un modelo fuera de lista no es una falla de la que haya que recuperarse
 * amablemente: es un proceso que no debe levantar.
 */

import type { ValidationIssue } from "@techsphere/contracts";

/** Raiz de todo lo que el adaptador puede fallar EN EJECUCION. Degrada por ADR-014. */
export class ErrorDeModelo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeModelo";
  }
}

/** Falta la credencial. Se detecta al construir, junto con la guarda de G3. */
export class ErrorDeCredencial extends ErrorDeModelo {
  constructor(variable: string) {
    super(
      `Falta ${variable} en el entorno. Las claves van por variable de entorno y NUNCA al repositorio. ` +
        `La ruta local (modo degradado) es la unica que no necesita credencial, y no cumple voz en tiempo real.`,
    );
    this.name = "ErrorDeCredencial";
  }
}

/** Red, HTTP no-2xx o timeout. Todo timeout es finito y su expiracion produce alerta. */
export class ErrorDeTransporte extends ErrorDeModelo {
  readonly status: number | null;

  constructor(mensaje: string, status: number | null = null) {
    super(mensaje);
    this.name = "ErrorDeTransporte";
    this.status = status;
  }
}

/**
 * Agotados los reintentos, la salida del modelo no valida contra el contrato.
 *
 * Es la pieza que hace de la correccion B2 un RESULTADO DECLARADO y no una
 * excepcion inesperada: la ruta primaria no admite `json_schema`, asi que la
 * garantia no la da el decodificador sino el validador. Que el modelo sea incapaz
 * de producir salida valida es un estado previsto —misma filosofia que ADR-009,
 * donde la no evaluabilidad es resultado y no vacio— y su consecuencia esta escrita:
 * la unidad queda sin normalizar y el caso degrada al humano por ADR-014.
 */
export class ErrorDeSalidaNoValidable extends ErrorDeModelo {
  readonly issues: readonly ValidationIssue[];
  readonly intentos: number;
  /** El crudo del ultimo intento. Va al ledger: la evidencia no se destruye (ADR-004). */
  readonly ultimo_crudo: string;

  constructor(intentos: number, issues: readonly ValidationIssue[], ultimo_crudo: string) {
    super(
      `El modelo no produjo salida conforme al contrato en ${intentos} intento(s). ` +
        `${issues.length} problema(s) de esquema en el ultimo: [${issues.map((i) => i.path || "(raiz)").join(", ")}].`,
    );
    this.name = "ErrorDeSalidaNoValidable";
    this.issues = issues;
    this.intentos = intentos;
    this.ultimo_crudo = ultimo_crudo;
  }
}
