/**
 * `@techsphere/decision` — la UNICA autoridad de decision del sistema.
 *
 * Las otras tres capas preparan; ninguna decide. Esta define que necesita saber,
 * juzga cuando alcanza, y emite el acto terminal: alertar o no alertar al personal
 * humano, con razon, trazas y resumen.
 *
 * ================== La regla que ordena la capa entera ==================
 *
 * A LA FALLA, ACTUA HUMANO. No existe ningun camino de codigo que termine sin
 * `Decision`, ni ninguna sesion que termine sin `CallSummary`. Todo timeout es
 * finito y su expiracion produce ALERTA, no reintento indefinido. Un sistema de
 * seguridad cuyo modo de fallo es el silencio no es un sistema de seguridad.
 *
 * Corolario operativo: cada `catch`, cada guarda y cada retorno temprano de este
 * paquete tiene que poder responder por donde sale la `Decision`.
 *
 * ========================================================================
 *
 * Esta capa NO re-tipa nada. `ContextFrame`, `UnitResult`, `FrameVerdict`,
 * `Decision`, `Vote`, `CallSummary` y los ocho puertos vienen del modulo compartido:
 * la capa IMPLEMENTA `DecisionPort`, no lo redefine.
 *
 * Referencias vivas:
 *   - `docs/Especificacion-Capa-Decision.md`      — spec, ADR-011..ADR-022
 *   - `docs/Ordenes-de-Trabajo-Capa-Decision.md`  — WO-36..WO-47
 *   - `docs/Estado-Vivo.md`                       — binding vigente y supuestos superados
 */

// --- Compuerta G3: el binding y su guarda POR RUTA (ADR-021 §8c-bis.1) -----
export {
  BASE_DE_INFERENCIA,
  ErrorDeCompuertaG3,
  exigirModeloPermitido,
  LINAJE,
  MODELOS_PERMITIDOS,
  TEMPERATURA_POR_ROL,
  type RolDeModelo,
  type RutaDeModelo,
} from "./modelo/rutas.ts";

export { AdaptadorNube } from "./modelo/nube.ts";
export { DecisionEngineNube } from "./modelo/motor-nube.ts";
export type {
  OpcionesDeAdaptador,
  PeticionEstructurada,
  RespuestaEstructurada,
} from "./modelo/nube.ts";

export {
  ErrorDeCredencial,
  ErrorDeModelo,
  ErrorDeSalidaNoValidable,
  ErrorDeTransporte,
} from "./modelo/errores.ts";

// --- Estandar de ingesta: contrato + cuerpo aprovechable (spec §8.2) -------
export {
  avisoDeDensidad,
  exigirDocumentoIngestable,
  leerCuerpo,
  rutaDeSidecar,
  SIDECAR_RAIZ,
  validarDocumentoIngestable,
  type LecturaDelCuerpo,
  type OpcionesDeIngesta,
  type VeredictoDeTexto,
} from "./esquema.ts";

// --- Base de pacientes: DOS VISTAS, y no se componen aqui ------------------
//
// `VistaDeIdentidad` y `VistaDeCaso` se exportan por separado a proposito. Quien
// solo necesite F0 importa la primera y no tiene forma de llegar al caso: el
// privilegio se ve en el import, que es donde lo mira quien revisa el codigo.
export { VistaDeIdentidad, PREFERENCIA_DE_VERIFICADOR } from "./pacientes/identidad.ts";
export {
  componerAlmacen,
  diasDesde,
  proyectarParaMarco,
  UNIDADES_DEL_DOMINIO,
  VistaDeCaso,
  type ProyeccionParaMarco,
} from "./pacientes/casos.ts";
export { ENCABEZADO_SINTETICO, REGISTROS, type RegistroDePaciente } from "./pacientes/datos.ts";
export type { ProcedenciaDeKind } from "./conocimiento/almacen.ts";

// --- ADR-015: el documento es la verdad; el indice es derivado -------------
export {
  AlmacenDeFuentes,
  CHUNKING_POR_KIND,
  ErrorDeAlmacen,
  TECHO_DE_CHUNK_TOKENS,
  type EntradaDeRegistro,
  type OpcionesDeAlmacenamiento,
  type OperacionDeCorpus,
  type ReciboDeAlmacen,
  type RevisionArchivada,
} from "./conocimiento/almacen.ts";
export { CORPUS_SEMILLA } from "./conocimiento/semilla.ts";
export {
  BM25_B,
  BM25_K1,
  descriptorDe,
  ErrorDeIndiceDiscordante,
  ESTRATEGIA_VIGENTE,
  IndiceLexico,
  NORMALIZACION,
  COBERTURA_MINIMA_DE_CONSULTA,
  TERMINOS_CASADOS_MINIMOS,
  tokenizar,
  type EstrategiaDeIndice,
  type InformeDeProyeccion,
} from "./conocimiento/indice.ts";
export {
  cargarCorpusReal,
  CORPUS_REAL,
  leerManifiesto,
  type EntradaDeManifiesto,
  type InformeDeCarga,
  type Manifiesto,
} from "./conocimiento/corpus-real.ts";
export {
  huecosDeEvidencia,
  type ConsultaPorUnidad,
  type HuecoDeEvidencia,
} from "./conocimiento/respaldo.ts";

// --- COMPUERTA 5: la consola que aprende y olvida en caliente --------------
export { AYUDA, ConsolaDeConocimiento, type OpcionesDeConsola } from "./consola/consola.ts";

// --- WO-45b: la entrega del resumen a sus dos destinos ---------------------
export {
  ArchivoDeSesiones,
  CanalDeAlerta,
  SumideroDeResumenes,
  type Destino,
  type FallaDeEntrega,
} from "./salida/sinks.ts";

// --- ADR-016: el desenlace que nadie prueba --------------------------------
export {
  cierrePorIdentidadNoVerificada,
  type CierreDeSesion,
  type PedidoDeCierrePorIdentidad,
  type VersionesVigentes,
} from "./cierres/identidad-no-verificada.ts";

// --- WO-41: el marco se GENERA, no se escribe (ADR-012) --------------------
export {
  buildFrame,
  buildFrameDelta,
  buildFrameGenerico,
  PROCEDENCIA_DEL_MARCO,
  type BaseDeMarco,
  type OpcionesDeMarco,
} from "./marco/buildFrame.ts";
export {
  atenuadores,
  cargarLexico,
  lexiconDeUnidad,
  RUTA_LEXICO,
  type LexicoDestilado,
} from "./marco/lexico.ts";

// --- WO-42/43/44: el bucle, los dos votos y la disyuncion sin veto ---------
export { Orquestador, MAX_RONDAS, type DependenciasDelDecisor, type Sesion } from "./decision/orquestador.ts";
export { DecisionEngineGuion, type OpcionesDelGuion } from "./decision/motor-guion.ts";
export { Ledger, type Anotacion } from "./decision/ledger.ts";
export { ensamblarResumen, type PedidoDeResumen, type VersionesDelResumen } from "./decision/resumen.ts";
export {
  clasesPresentes,
  DOMINIO_ESPERADO,
  ErrorDeVersionDeTablaVD,
  leerVotoDeterminista,
  TABLA_VD,
  VD_VERSION,
  type LecturaVD,
  type ReglaVD,
} from "./decision/vd.ts";
export {
  coberturaSuficiente,
  criticidadMasGrave,
  ponderar,
  type LecturaDeCobertura,
  type ResultadoPonderacion,
} from "./decision/ponderador.ts";

// --- ADR-014: la degradacion segura, como funcion pura ---------------------
export {
  decisionPorContextoIncompleto,
  decisionPorDegradacion,
  hayQueReabrir,
  leerMarco,
  type DegradacionPedida,
  type Faltante,
  type LecturaDelMarco,
  type MotivoDeFalta,
} from "./seguridad/completitud.ts";
