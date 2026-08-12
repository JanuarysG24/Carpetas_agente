/**
 * La guarda de la compuerta G3 — UNA POR RUTA, no una sola (ADR-021 §8c-bis.1).
 *
 * ================== Por que la guarda no puede ser unica ==================
 *
 * Validar un nombre de modelo es validar un identificador contra el catalogo de un
 * proveedor CONCRETO, y los catalogos no son intercambiables. Una guarda que conoce
 * nombres de Ollama es inutil frente a un identificador de nube, y una lista que
 * mezcle ambos mundos no protege de nada: acepta cualquier cosa de cualquiera de
 * los dos.
 *
 * El riesgo concreto que esto cierra ya ocurrio (H16): al migrar de local a nube
 * quedo protegida solo la ruta local —la del respaldo— porque era donde ya vivia la
 * guarda. La ruta primaria, que es la que se entrega y la que el jurado ejecuta,
 * quedo sin proteccion estructural. Es el modo de fallo mas incomodo posible: la
 * salvaguarda existe, se ve en el codigo, y cubre justo la ruta que menos importa.
 *
 * ==========================================================================
 *
 * REGLA: ningun adaptador arranca si su modelo configurado no esta en SU lista. El
 * fallo es al levantar el proceso, no al primer turno — un sistema que descubre en
 * produccion que esta usando un modelo no permitido ya fallo la compuerta.
 *
 * G3 es la unica compuerta que DESCALIFICA, y se verifica contra dependencias,
 * configuracion y codigo. De ahi las tres reglas de auditoria que este archivo
 * sostiene: una sola constante de modelo por adaptador · ninguna segunda URL de
 * inferencia en ningun otro archivo · ningun SDK de proveedor en package.json.
 */

/**
 * Las dos rutas vigentes. No son dos proveedores intercambiables: son una primaria
 * y un seguro, y la diferencia esta declarada en `LINAJE` porque el informe final
 * tiene que citarla.
 *
 * ============ ADR-025: la ruta local se retiro por completo (8-ago) ============
 *
 * §8c-bis.3 le habia quitado sus dos trabajos y la conservaba como "modo degradado".
 * Un componente sin trabajo no es una reserva: es superficie que se mantiene sola —
 * costaba un motor, una ruta en esta guarda, una seccion de README y, lo que lo
 * decidio, `ollama pull` DENTRO DEL RELOJ DE G2.
 *
 * Y el supuesto que la sostenia era falso: se conservaba para ofrecer un arranque
 * sin credenciales, pero G2 dice literalmente "≤15 min siguiendo el README,
 * CREDENCIALES INCLUIDAS". No existia el requisito que protegia, y a cambio metia
 * una descarga de modelo en el cronometro.
 *
 * Se retira del codigo, del README y de esta guarda. **La estructura de listas por
 * ruta se conserva integra**: es el arreglo de H16 y sigue protegiendo las dos
 * rutas de nube. Los numeros del respaldo no se borran — viven en `bench/` como la
 * evidencia de que se evaluo, se midio y se retiro.
 *
 * ==============================================================================
 */
export type RutaDeModelo = "nube_groq" | "nube_google";

/** Los dos roles de ADR-002, servidos por UN SOLO modelo en cada ruta. */
export type RolDeModelo = "decider" | "interviewer";

/**
 * Listas cerradas, una por ruta. Añadir un nombre aqui exige un ADR.
 *
 * Cada entrada es un SUCESOR DE LINAJE de un modelo de la lista publicada por la
 * organizacion, no un modelo elegido por conveniencia. La autorizacion esta
 * archivada textual en `docs/Respuesta-Organizacion-7AGO.md` y el informe final
 * debe citarla con fecha y remitente junto al nombre del modelo usado: un jurado
 * que compare contra la lista publicada va a encontrar un nombre que no esta en
 * ella, y sin la cita al lado eso es una conversacion de descalificacion.
 */
export const MODELOS_PERMITIDOS: Readonly<Record<RutaDeModelo, readonly string[]>> = {
  /** Sucesor de `llama-3.1-70b-versatile` (Groq, desmantelado): mismo proveedor, familia, tamaño y host. */
  nube_groq: ["llama-3.3-70b-versatile"],

  /**
   * Sucesor de `gemini-1.5-flash` (apagado, 404): mismo proveedor, misma familia.
   * `gemini-3.5-flash` es el unico Flash estable vigente que permite apagar el
   * presupuesto de razonamiento (`bench/RESULTADOS.md` §2); 3.6 y el alias
   * `gemini-flash-latest` lo rechazan con HTTP 400.
   */
  nube_google: ["gemini-3.5-flash"],
} as const;

/**
 * Que papel juega cada ruta. Vive al lado de la lista porque separarlo invita a
 * que alguien "pruebe con la local" y descubra en la demo que esa ruta no cumple
 * el requisito de voz en tiempo real.
 */
export const LINAJE: Readonly<Record<RutaDeModelo, string>> = {
  nube_groq: "RUTA PRIMARIA (ADR-021). Sucesor de linaje de Llama 3.1 70B.",
  nube_google:
    "SEGURO DEL 5-SEP (ADR-021 §8c-bis.3). Segunda estirpe de nube; conserva G4. Requiere facturacion para ser usable.",
} as const;

/** Base de inferencia por ruta. No debe existir una segunda URL de inferencia en el repositorio. */
export const BASE_DE_INFERENCIA: Readonly<Record<RutaDeModelo, string>> = {
  nube_groq: "https://api.groq.com/openai/v1",
  nube_google: "https://generativelanguage.googleapis.com/v1beta",
} as const;

/**
 * Fallo de compuerta, no fallo de configuracion. Se distingue por tipo para que
 * nadie lo capture junto con los errores de transporte y lo degrade por ADR-014:
 * un modelo fuera de lista NO es una falla tecnica de la que haya que recuperarse,
 * es un proceso que no debe existir.
 */
export class ErrorDeCompuertaG3 extends Error {
  readonly ruta: RutaDeModelo;
  readonly modelo: string;

  constructor(ruta: RutaDeModelo, modelo: string) {
    const permitidos = MODELOS_PERMITIDOS[ruta];
    super(
      `G3: el modelo ${JSON.stringify(modelo)} no esta en la lista cerrada de la ruta "${ruta}" ` +
        `(${permitidos.join(", ")}).\n` +
        `      ${LINAJE[ruta]}\n` +
        `      La compuerta 3 DESCALIFICA y se verifica contra dependencias, configuracion y codigo. ` +
        `Cada ruta valida contra SU catalogo: una lista que mezclara nombres de Ollama con identificadores ` +
        `de nube aceptaria cualquier cosa de cualquiera de los dos mundos y no protegeria de nada ` +
        `(ADR-021 §8c-bis.1). Si de verdad hace falta otro modelo, eso es un ADR, no una variable de entorno.`,
    );
    this.name = "ErrorDeCompuertaG3";
    this.ruta = ruta;
    this.modelo = modelo;
  }
}

/**
 * La guarda. Se invoca al CONSTRUIR el adaptador —es decir, al arrancar— y lanza
 * si el modelo no pertenece a la lista de esa ruta.
 *
 * Devuelve el nombre validado para que el adaptador lo guarde de aqui y no de la
 * variable de entorno: asi no queda ningun camino en que el nombre usado y el
 * nombre validado puedan divergir.
 */
export function exigirModeloPermitido(ruta: RutaDeModelo, modelo: string): string {
  if (!MODELOS_PERMITIDOS[ruta].includes(modelo)) throw new ErrorDeCompuertaG3(ruta, modelo);
  return modelo;
}

/**
 * ADR-021: `temperature: 0` en el rol `decider`; el `interviewer` conserva
 * variacion porque ahi la naturalidad es lo que la rubrica evalua en tono y registro.
 *
 * Y conviene ser exacto sobre que garantiza: temperatura cero NO produce
 * determinismo en un modelo hospedado —el batching y el hardware introducen
 * variacion aunque el muestreo sea codicioso—. La consistencia del sistema no viene
 * del modelo y nunca vino de el: viene del VD, que es una tabla declarada e
 * identica ante el mismo caso, y de la disyuncion sin veto.
 */
export const TEMPERATURA_POR_ROL: Readonly<Record<RolDeModelo, number>> = {
  decider: 0,
  interviewer: 0.4,
} as const;
