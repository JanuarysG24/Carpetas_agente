/**
 * `@techsphere/deterministic` — la capa DETERMINISTA del Tech Sphere Challenge 2.
 *
 * Un modulo PURO de evaluacion estructural. Recibe el marco ya declarado suficiente
 * y devuelve un reporte sobre los tres ejes de ADR-006 —funcionalidad, interaccion
 * e integridad sistemica— con trazas reconstruibles hasta el valor de entrada.
 *
 * ================== Como se usa, y como NO ==================
 *
 *   const dominio = cargarDominioDesdeArchivo("docs/dominio/dominio-postop-v0.1.json");
 *   const det = new MotorDeterminista(dominio);
 *   const reporte = det.evaluate(req);   // sincrono, puro
 *
 * Lo invoca LA CAPA DE DECISION, una sola vez por sesion, despues de declarar
 * suficiencia y antes de construir la `Decision`. NO se expone como herramienta de
 * un modelo de lenguaje: si el LLM decidiera cuando llamarlo, los dos votos dejarian
 * de ser independientes y ADR-013 perderia su fundamento entero. Tampoco se invoca
 * en `escalateNow` — en urgencia no hay bucle ni tiempo de analisis estructural.
 *
 * ============================================================
 *
 * Referencias vivas:
 *   - `docs/Especificacion-Capa-Determinista.md`  — spec, ADR-006..010, contrato §6
 *   - `docs/Logica-General-Determinista-Convergencia-Derivacion-Colapso.md` — Motor A
 *   - `docs/Derivacion-Organico-Funcional.md`     — de donde salen los cortes
 *   - `docs/Ordenes-de-Trabajo-Capa-Determinista.md` — WO-25..WO-35
 */

export { MotorDeterminista } from "./motor.ts";
export {
  cargarDominio,
  cargarDominioDesdeArchivo,
  manifiestoDe,
  validarDominio,
  EJES_DOMINIO,
} from "./dominio.ts";
export type {
  ClaseDeclarada,
  Composicion,
  Corte,
  Dominio,
  EjeDominio,
  FuncionDeClaseUnidad,
  MapeoCategorico,
  ModificadorDeclarado,
  Operador,
  TipoDeUnidad,
} from "./dominio.ts";
export { ErrorDeDominio, ErrorDeVersionDeDominio } from "./errores.ts";
export { DeterministaMedido } from "./metricas.ts";
export type { MetricasDeterministas, MuestraDeterminista } from "./metricas.ts";
export { ejesAfectados, ordenarUnidades, repartirPorElegibilidad } from "./elegibilidad.ts";
export type { Elegibilidad, UnidadElegible } from "./elegibilidad.ts";
export { colapsar, esHallazgo, reglaDeFallback, resolverModificadores } from "./colapso.ts";
export type { Colapso, ContextoDeModificadores } from "./colapso.ts";
export { evaluarInteraccion } from "./interaccion.ts";
export { evaluarIntegridad } from "./integridad.ts";
