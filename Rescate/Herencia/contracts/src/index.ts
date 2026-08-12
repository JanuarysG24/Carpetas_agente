/**
 * `@techsphere/contracts` — modulo compartido de contratos del Tech Sphere Challenge 2.
 *
 * Superficie unica e importable por las CUATRO capas. Contiene exclusivamente
 * tipos, puertos (interfaces sin implementacion) y validacion de esquema.
 * No contiene logica de negocio de ninguna capa, ni transporte, ni dependencia
 * de ningun modelo de lenguaje.
 *
 * Referencias vivas:
 *   - Costura conversacional <-> decision: `docs/Especificacion-Capa-Conversacional.md` §8.2, §15
 *   - Costura decision <-> determinista:   `docs/Especificacion-Capa-Determinista.md` §6
 *   - Puertos de la capa de decision:      `docs/Especificacion-Capa-Decision.md` §4, §8.3, §8b
 *   - Correcciones X-1..X-7:               `docs/Acta-7AGO.md` §4.1
 */

export * from "./conversational.ts";
export * from "./deterministic.ts";
export * from "./knowledge.ts";
export * from "./patient.ts";
export * from "./summary.ts";
export * from "./ports.ts";
export * from "./validation/index.ts";
