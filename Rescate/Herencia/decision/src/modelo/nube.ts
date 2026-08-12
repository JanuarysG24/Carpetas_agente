/**
 * El adaptador de la RUTA PRIMARIA (ADR-021). HTTP plano, sin SDK de proveedor.
 *
 * ================== Por que HTTP plano y no el SDK ==================
 *
 * G3 es la unica compuerta que descalifica y se verifica "contra tus dependencias,
 * tu configuracion y tu codigo". Un `npm ls` en esta capa no debe encontrar ningun
 * cliente de proveedor: la conformidad tiene que ser auditable de un vistazo, y un
 * SDK esconde el nombre del modelo detras de una capa que el auditor no lee.
 *
 * ====================================================================
 *
 * ================== De donde viene la garantia de esquema ==================
 *
 * `llama-3.3-70b-versatile` NO admite `response_format: json_schema` —devuelve 400
 * remitiendo a su lista de modelos compatibles—, solo `json_object`, que garantiza
 * JSON valido pero NO conformidad con el esquema (correccion B2).
 *
 * La garantia no se ablanda: se mueve una capa arriba. Pasa de "el decodificador no
 * puede emitir invalido" a "EL SISTEMA NO PUEDE ACEPTAR INVALIDO":
 *
 *   1. Toda salida estructurada cruza el validador del modulo de contratos.
 *   2. Una salida que no valida se reintenta de forma ACOTADA, con el error de
 *      esquema incluido en el reintento.
 *   3. Agotados los reintentos se lanza `ErrorDeSalidaNoValidable`, y el llamador
 *      degrada al humano por ADR-014. La incapacidad de producir salida valida es
 *      un RESULTADO DECLARADO, no una excepcion.
 *
 * Y asi es mas fuerte que la version original, porque no depende del proveedor:
 * vale con `json_object`, con `json_schema` y en local. Si Groq habilitara
 * `json_schema` para este modelo se usaria ADEMAS, no en lugar de.
 *
 * ==========================================================================
 *
 * ADR-023 — el prompt se arma con PREFIJO ESTABLE primero y COLA VOLATIL al final.
 * Este adaptador lo impone por firma: `sistema` es el prefijo y `prompt` la cola, y
 * no hay ningun sitio donde interpolar un `session_id` o una marca de tiempo arriba.
 * Medido: en local vale 6-8x de prefill; en Groq NO cambia los tokens de entrada
 * (B6), asi que abarata el precio de esa porcion pero no relaja el techo de TPM.
 */

import { formatear, type ValidationResult } from "@techsphere/contracts";
import {
  ErrorDeCredencial,
  ErrorDeSalidaNoValidable,
  ErrorDeTransporte,
} from "./errores.ts";
import {
  BASE_DE_INFERENCIA,
  exigirModeloPermitido,
  TEMPERATURA_POR_ROL,
  type RolDeModelo,
  type RutaDeModelo,
} from "./rutas.ts";

/**
 * Reintento ACOTADO, y el numero es de politica: dos intentos totales. El tercero
 * casi nunca arregla lo que el segundo no arreglo, y esta capa esta contra el reloj
 * de una llamada telefonica — cada intento fallido es latencia que el paciente
 * espera en silencio.
 */
const INTENTOS_POR_DEFECTO = 2;

/** Todo timeout es FINITO y su expiracion produce alerta, nunca reintento indefinido. */
const TIMEOUT_MS_POR_DEFECTO = 30_000;

/** Techo de salida. Red de seguridad contra una fuga, no el limitador de la respuesta. */
const MAX_TOKENS_POR_DEFECTO = 320;

export interface OpcionesDeAdaptador {
  ruta: RutaDeModelo;
  /** Se valida contra la lista de SU ruta al construir. Fuera de lista, no arranca. */
  modelo: string;
  api_key: string;
  intentos?: number;
  timeout_ms?: number;
  /** Inyectable para que las pruebas no toquen la red. En produccion es el fetch nativo. */
  fetch_impl?: typeof fetch;
}

export interface PeticionEstructurada {
  rol: RolDeModelo;
  /** ADR-023 — PREFIJO ESTABLE: rol, criterios, evidencia. Identico entre llamadas. */
  sistema: string;
  /** ADR-023 — COLA VOLATIL: lo que cambia en esta llamada. Va al final, siempre. */
  prompt: string;
  /** Se incrusta en el mensaje de sistema porque la ruta primaria no admite json_schema. */
  esquema: Record<string, unknown>;
  /**
   * El validador del modulo de contratos que corresponda a la salida esperada.
   * Obligatorio (B2): sin el, no habria de donde salir la garantia de esquema.
   */
  validar: (crudo: unknown) => ValidationResult;
  max_tokens?: number;
}

export interface RespuestaEstructurada<T> {
  valor: T;
  /** Cuantos intentos costo. >1 es señal de que el esquema o el prompt necesitan trabajo. */
  intentos: number;
  /** WO-46 los consolida. Se recogen sobre la marcha, no se reconstruyen al final. */
  tokens: { entrada: number; salida: number };
  ms: number;
  /** Se registra en vez de disimularse: dice de donde vino la garantia. */
  modo_esquema: "json_object" | "json_schema";
}

interface RespuestaChat {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Adaptador de una ruta de nube compatible con el dialecto OpenAI de chat.
 *
 * Sirve los DOS roles de ADR-002 con UN SOLO modelo: la unica diferencia entre
 * ellos es la temperatura, y esa asimetria vive en `TEMPERATURA_POR_ROL`, no aqui.
 */
export class AdaptadorNube {
  /** La constante de modelo de esta ruta. Sale de la guarda, no del entorno. */
  readonly modelo: string;
  readonly ruta: RutaDeModelo;

  private readonly key: string;
  private readonly base: string;
  private readonly intentos: number;
  private readonly timeoutMs: number;
  private readonly hacerFetch: typeof fetch;

  constructor(opciones: OpcionesDeAdaptador) {
    // ORDEN DELIBERADO: la guarda de G3 va PRIMERO, antes que la credencial y antes
    // que cualquier otra cosa. Un proceso configurado con un modelo fuera de lista
    // no debe llegar a quejarse de que le falta la clave: debe no levantar.
    this.modelo = exigirModeloPermitido(opciones.ruta, opciones.modelo);
    this.ruta = opciones.ruta;

    const key = opciones.api_key.trim();
    if (key === "") {
      throw new ErrorDeCredencial(
        opciones.ruta === "nube_groq" ? "GROQ_API_KEY" : "GOOGLE_API_KEY",
      );
    }
    this.key = key;
    this.base = BASE_DE_INFERENCIA[opciones.ruta];
    this.intentos = opciones.intentos ?? INTENTOS_POR_DEFECTO;
    this.timeoutMs = opciones.timeout_ms ?? TIMEOUT_MS_POR_DEFECTO;
    this.hacerFetch = opciones.fetch_impl ?? fetch;
  }

  /**
   * Una salida estructurada, ya validada contra el contrato.
   *
   * Devuelve `T` o lanza. No existe el camino intermedio de "devolver algo a medias
   * y que el llamador se las arregle": esta capa entera esta construida sobre que
   * ningun dato malo viaja sin que alguien lo nombre.
   */
  async generarEstructurado<T>(peticion: PeticionEstructurada): Promise<RespuestaEstructurada<T>> {
    const t0 = Date.now();
    const tokens = { entrada: 0, salida: 0 };
    let crudo = "";
    let ultimoResultado: ValidationResult = { valid: false, issues: [] };

    // El esquema viaja en el PREFIJO ESTABLE: es identico entre llamadas del mismo
    // rol, asi que cachea. La correccion del reintento va en la cola, que es donde
    // cambia (ADR-023).
    const sistema =
      `${peticion.sistema}\n\n` +
      `Devuelve UNICAMENTE un objeto JSON que cumpla este esquema, sin texto alrededor:\n` +
      JSON.stringify(peticion.esquema);

    for (let intento = 1; intento <= this.intentos; intento++) {
      const correccion =
        intento === 1
          ? ""
          : `\n\nTu respuesta anterior no cumplio el contrato:\n${formatear(ultimoResultado.issues)}\n` +
            `Corrige EXACTAMENTE eso y devuelve solo el JSON.`;

      const respuesta = await this.pedir(
        sistema,
        peticion.prompt + correccion,
        TEMPERATURA_POR_ROL[peticion.rol],
        peticion.max_tokens ?? MAX_TOKENS_POR_DEFECTO,
      );

      tokens.entrada += respuesta.usage?.prompt_tokens ?? 0;
      tokens.salida += respuesta.usage?.completion_tokens ?? 0;
      crudo = respuesta.choices?.[0]?.message?.content ?? "";

      // Truncamiento por techo de tokens: se nombra como lo que es. Culpar al
      // modelo de un JSON cortado es culparlo de algo que es del decodificador (H7).
      if (respuesta.choices?.[0]?.finish_reason === "length") {
        ultimoResultado = {
          valid: false,
          issues: [
            {
              path: "",
              code: "tipo_invalido",
              message: `La respuesta se corto por el techo de ${peticion.max_tokens ?? MAX_TOKENS_POR_DEFECTO} tokens de salida.`,
              hint: `No es JSON invalido del modelo: es truncamiento del decodificador. Se breve, o sube el techo.`,
            },
          ],
        };
        continue;
      }

      let valor: unknown;
      try {
        valor = JSON.parse(crudo);
      } catch (e) {
        ultimoResultado = {
          valid: false,
          issues: [
            {
              path: "",
              code: "tipo_invalido",
              message: `La respuesta no es JSON parseable: ${(e as Error).message}.`,
              hint: `Devuelve un unico objeto JSON, sin prosa alrededor ni bloque de codigo.`,
            },
          ],
        };
        continue;
      }

      ultimoResultado = peticion.validar(valor);
      if (ultimoResultado.valid) {
        return {
          valor: valor as T,
          intentos: intento,
          tokens,
          ms: Date.now() - t0,
          modo_esquema: "json_object",
        };
      }
    }

    throw new ErrorDeSalidaNoValidable(this.intentos, ultimoResultado.issues, crudo);
  }

  private async pedir(
    sistema: string,
    prompt: string,
    temperature: number,
    maxTokens: number,
  ): Promise<RespuestaChat> {
    const ac = new AbortController();
    const reloj = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.hacerFetch(`${this.base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelo,
          messages: [
            { role: "system", content: sistema },
            { role: "user", content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
          response_format: { type: "json_object" },
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const cuerpo = await res.text().catch(() => "");
        throw new ErrorDeTransporte(
          `La ruta ${this.ruta} respondio ${res.status}. ${cuerpo.slice(0, 300)}`,
          res.status,
        );
      }
      return (await res.json()) as RespuestaChat;
    } catch (e) {
      if (e instanceof ErrorDeTransporte) throw e;
      if ((e as Error).name === "AbortError") {
        throw new ErrorDeTransporte(`La ruta ${this.ruta} no respondio en ${this.timeoutMs} ms.`);
      }
      throw new ErrorDeTransporte(`Fallo de transporte contra ${this.ruta}: ${(e as Error).message}`);
    } finally {
      clearTimeout(reloj);
    }
  }
}
