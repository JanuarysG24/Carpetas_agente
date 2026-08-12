/**
 * WO-30 — el ensamblador. Los tres ejes ETIQUETADOS incluso sin hallazgos.
 *
 * "Ningun hallazgo funcional", "hallazgos independientes sin patron compartido" e
 * "integridad no determinable" son lecturas AFIRMATIVAS con etiqueta propia. Nunca
 * se representan por una lista vacia sin mas: un objeto vacio obliga al lector a
 * inferir si es que no habia nada o es que no se miro, y ahi es donde una
 * herramienta de organizacion empieza a parecer una de decision.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDeterministicReport } from "@techsphere/contracts";
import { MotorDeterminista } from "../src/index.ts";
import {
  dominioReal,
  peticion,
  sinNormalizar,
  suspendida,
  unidad,
} from "./fixtures/ayudas.ts";

const motor = () => new MotorDeterminista(dominioReal());
const V = "postop-0.1.0";

test("un caso sin ningun hallazgo devuelve las tres lecturas etiquetadas, no objetos vacios", () => {
  const r = motor().evaluate(
    peticion([unidad("fiebre", 36.7), unidad("apetito", "normal"), unidad("sueno", "normal")], V, {
      dia_postop: 1,
    }),
  );

  assert.equal(r.funcionalidad.lectura, "sin_hallazgo");
  assert.equal(r.interaccion.lectura, "sin_hallazgo");
  assert.equal(r.integridad.lectura, "integra");
  assert.equal(r.coverage.ratio, 1);
  assert.deepEqual(validateDeterministicReport(r).issues, []);
});

test("sin ninguna unidad evaluable, la integridad es no_determinable y no integra", () => {
  const r = motor().evaluate(
    peticion([sinNormalizar("fiebre"), suspendida("apetito", "sin_respuesta")], V),
  );

  assert.equal(
    r.integridad.lectura,
    "no_determinable",
    "'no vi nada' no es 'esta todo bien': confundirlos induce el falso negativo por omision, que es " +
      "el error mas caro del sistema",
  );
  assert.equal(r.coverage.ratio, 0);
  assert.equal(r.coverage.no_evaluadas.length, 2);
});

test("el caso rojo canonico: los tres ejes poblados y la cadena entera reconstruible", () => {
  const r = motor().evaluate(
    peticion(
      [
        unidad("fiebre", 38.6),
        unidad("dolor_intensidad", 7),
        unidad("movilidad", "incapacitante_nueva"),
        unidad("aspecto_herida", "secrecion_purulenta"),
        unidad("apetito", "muy_disminuido"),
        unidad("sueno", "muy_alterado"),
      ],
      V,
      { dia_postop: 14 },
    ),
  );

  assert.deepEqual(validateDeterministicReport(r).issues, []);
  assert.equal(r.funcionalidad.lectura, "coexistencia");
  assert.equal(r.interaccion.lectura, "patron_compartido");
  assert.equal(r.integridad.lectura, "comprometida");

  assert.deepEqual(
    r.integridad.comprometidas.map((c) => c.estructura),
    ["funcionalidad", "interaccion", "integridad"],
    "los nodos estructurales de este dominio son sus ejes: el arbol que declara es eje -> unidades",
  );
  const integridad = r.integridad.comprometidas.find((c) => c.estructura === "integridad");
  assert.deepEqual(
    integridad?.clases_contribuyentes,
    ["integridad_cedida", "integridad_comprometida"],
    "la clase COMPUESTA sostiene la afirmacion con el eje que el catalogo le declara: la integridad no " +
      "queda sostenida solo por sus partes",
  );
  assert.deepEqual(integridad?.origen_unit_ids, ["apetito", "sueno"]);

  assert.equal(r.quality.fallback_rate, 0);
  assert.equal(r.coverage.ratio, 1);
});

test("ST-interaccion arrastra apetito y sueno: origen_unit_ids es PROCEDENCIA de la evidencia, no pertenencia al eje", () => {
  const r = motor().evaluate(
    peticion(
      [
        unidad("fiebre", 38.6),
        unidad("apetito", "muy_disminuido"),
        unidad("sueno", "muy_alterado"),
      ],
      V,
      { dia_postop: 14 },
    ),
  );

  const interaccion = r.integridad.comprometidas.find((c) => c.estructura === "interaccion");
  assert.ok(interaccion);
  assert.deepEqual(
    interaccion.clases_contribuyentes,
    ["convergencia_sistemica", "respuesta_sistemica"],
    "la clase compuesta sostiene el eje que el catalogo le declara",
  );

  // ================== La decision que este test fija ==================
  //
  // El dominio declara UNA sola unidad en el eje de interaccion: `fiebre`. Y sin
  // embargo la afirmacion estructural sobre ese eje llega con tres unidades de
  // origen, porque `convergencia_sistemica` solo existe por la coincidencia de
  // apetito, sueño y fiebre.
  //
  // Se conserva la union —PROCEDENCIA— y no la pertenencia al eje, porque la
  // invariante 3 de la spec §6.4 exige que toda afirmacion del reporte se pueda
  // recorrer hacia atras hasta las unidades que la originaron. Recortar a `fiebre`
  // dejaria `ST-interaccion` citando una evidencia que NO basta para producirlo: el
  // decisor no podria reconstruir por que ese eje esta comprometido.
  //
  // Para las clases simples procedencia y pertenencia coinciden y nadie nota la
  // diferencia; para las compuestas se separan. QUIEN LEA ESTO NO DEBE INTERPRETAR
  // `origen_unit_ids` COMO PERTENENCIA AL EJE: decir que el apetito compromete el
  // eje de interaccion es una afirmacion que el dominio no hace.
  //
  // ====================================================================
  assert.deepEqual(
    interaccion.origen_unit_ids,
    ["apetito", "fiebre", "sueno"],
    "procedencia, no pertenencia: el dominio pone solo `fiebre` en este eje, pero la afirmacion " +
      "proviene de las tres unidades que activaron la composicion",
  );
  assert.deepEqual(
    [...(dominioReal().ejes.get("interaccion") ?? [])],
    ["fiebre"],
    "y esto es lo que el dominio SI declara sobre pertenencia; las dos listas son distintas a proposito",
  );

  const integridad = r.integridad.comprometidas.find((c) => c.estructura === "integridad");
  assert.deepEqual(
    integridad?.origen_unit_ids,
    ["apetito", "sueno"],
    "en integridad las dos lecturas coinciden porque las partes de la composicion son del mismo eje: " +
      "es el caso que oculta la distincion, y por eso no basta como prueba",
  );
});

test("toda entrada de traza tiene rule_id y origen_unit_ids, en los tres tipos de hallazgo", () => {
  const r = motor().evaluate(
    peticion(
      [
        unidad("fiebre", 38.6),
        unidad("apetito", "muy_disminuido"),
        unidad("sueno", "muy_alterado"),
      ],
      V,
    ),
  );

  for (const t of r.trace) {
    assert.ok(t.rule_id.length > 0, "un hallazgo sin rule_id es un hallazgo no reconstruible");
    assert.ok(t.origen_unit_ids.length > 0);
    assert.ok(t.clase.length > 0);
  }

  const familias = new Set(r.trace.map((t) => t.rule_id.split("-")[0]));
  assert.deepEqual(
    [...familias].sort(),
    ["CO", "CV", "FC", "ST"],
    "las cuatro familias llegan a la traza: cortes de la funcion de clase, clases convergentes, " +
      "composiciones y afirmaciones estructurales. Son la fuente UNICA de Decision.traces.rules_fired",
  );
});

test("el modulo no redacta: todas las lecturas son enumerados, ninguna es prosa", () => {
  const r = motor().evaluate(peticion([unidad("aspecto_herida", "secrecion_purulenta")], V));

  assert.ok(["patron_unico", "coexistencia", "sin_hallazgo"].includes(r.funcionalidad.lectura));
  assert.ok(
    ["patron_compartido", "hallazgos_independientes", "sin_hallazgo"].includes(r.interaccion.lectura),
  );
  assert.ok(["integra", "comprometida", "no_determinable"].includes(r.integridad.lectura));
  assert.equal(
    r.integridad.comprometidas.every((c) => !c.estructura.includes(" ")),
    true,
    "la verbalizacion clinica es del decisor y la del paciente es de la conversacional",
  );
});

test("el fallback NO sostiene una afirmacion de integridad", () => {
  const r = motor().evaluate(peticion([unidad("apetito", "valor_marciano")], V));

  assert.equal(r.funcionalidad.clases[0]?.fallback, true);
  assert.deepEqual(
    r.integridad.comprometidas,
    [],
    "una laguna del modulo no puede convertirse en un hallazgo sobre el paciente: eso viaja en " +
      "quality.fallback_rate, que es salud del modulo y no del paciente",
  );
  assert.equal(r.integridad.lectura, "integra");
});

test("domain_version y frame_id se propagan tal cual al reporte", () => {
  const r = motor().evaluate(peticion([unidad("fiebre", 37.0)], V));
  assert.equal(r.domain_version, V);
  assert.equal(r.frame_id, "frame-prueba-0");
});
