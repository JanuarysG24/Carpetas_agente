/**
 * Superficie de la validacion de esquema.
 *
 * Todo validador devuelve `ValidationResult` —nunca lanza por si solo, nunca
 * devuelve `undefined`— y acumula TODOS los problemas, no solo el primero: quien
 * llama arregla el objeto de una vez en vez de descubrir un error por ejecucion.
 *
 * Para las fronteras donde seguir con un dato invalido es peor que caerse, usa
 * `exigirValido(etiqueta, resultado)`, que lanza `ContractValidationError` con
 * los problemas ya formateados.
 */

export {
  ContractValidationError,
  exigirValido,
  formatear,
  type IssueSink,
  type ValidationCode,
  type ValidationIssue,
  type ValidationResult,
} from "./issues.ts";

export {
  CAUSAS,
  CIERRES,
  CRITICIDADES,
  DIMENSIONES_DE_COBERTURA,
  ESTADOS_DE_EXTRACCION,
  PRIORIDADES,
  REASON_CODES,
  TIPOS_DE_UNIDAD,
  validateContextFrame,
  validateDecision,
  validateUnitResult,
  validateUnitResults,
  type OpcionesUnitResults,
} from "./conversational.ts";

export {
  EJES,
  LECTURAS_FUNCIONALIDAD,
  LECTURAS_INTEGRIDAD,
  LECTURAS_INTERACCION,
  VALIDEZ_CLINICA,
  rechazarCamposProhibidosADR007,
  validateDeterministicReport,
  validateDeterministicRequest,
  validateDomainManifest,
} from "./deterministic.ts";

export { rechazarIdentidadDePacienteADR011, validateSourceDocument } from "./knowledge.ts";

export {
  DESTINOS,
  IDENTITY_STATUSES,
  PROCEDENCIAS,
  RAMAS,
  validateCallSummary,
  validateSummaryDelivery,
} from "./summary.ts";
