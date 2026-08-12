/**
 * Banco adversarial — WO-23b. Frente independiente.
 *
 * Este paquete PRUEBA y NO ARREGLA. Cuando un ataque tiene exito se reporta con
 * el enunciado literal, la respuesta literal y el criterio violado; el arreglo lo
 * hace el frente dueño de la capa. Si el banco parchea, deja de ser independiente
 * y pierde su valor como evidencia.
 */

export type {
  Ataque,
  CriterioId,
  DocumentoEnvenenado,
  EsperaEscalamiento,
  FamiliaId,
  ParDeVerificacion,
  ResultadoDeAtaque,
} from "./tipos.ts";

export { ataques, documentosEnvenenados, paresDeVerificacion, porFamilia } from "./corpus.ts";

export type { Dictamen, ContextoDeJuicio, Veredicto } from "./criterios.ts";
export {
  dictaminar,
  hayFallo,
  juzgarC1,
  juzgarC2,
  juzgarC3,
  juzgarC4,
  juzgarC5,
  juzgarEscalamiento,
  normalizar,
} from "./criterios.ts";
