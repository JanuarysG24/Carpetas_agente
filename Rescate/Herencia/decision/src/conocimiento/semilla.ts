/**
 * Corpus minimo de desarrollo. El corpus real —107 PDF— entra POR CONSOLA en WO-47,
 * y esa ingesta es la demostracion misma del conocimiento vivo: no se precarga.
 *
 * ============ Por que estos textos no dicen numeros clinicos ============
 *
 * Son sinteticos y existen para ejercitar la costura: que `retrieve` devuelva un
 * `doc_id` que resuelve a un documento que existe. Si ademas trajeran umbrales
 * ("consulte si supera 38,5"), esos umbrales acabarian citados con `doc_id` en una
 * `Decision`, que es exactamente la forma que tiene un supuesto de disfrazarse de
 * evidencia. Un dato sintetico que no dice que lo es acaba citado como si fuera real.
 *
 * Hablan del PROCESO —que mirar, cuando volver a contar— y no del CUADRO, que es lo
 * que ADR-020 le pide al agente entero.
 *
 * ========================================================================
 */

import type { SourceDocument } from "@techsphere/contracts";

const ENCABEZADO = "DATOS SINTETICOS — sin validez clinica. Corpus semilla de desarrollo.";

export const CORPUS_SEMILLA: readonly SourceDocument[] = [
  {
    doc_id: "semilla-cuidados-herida",
    title: "Cuidados de la herida quirurgica en casa",
    kind: "cuidados",
    lang: "es",
    origin: `${ENCABEZADO} No procede de ninguna fuente real.`,
    effective_date: "2026-01-01",
    body:
      `${ENCABEZADO} ` +
      "Mantenga la herida limpia y seca los primeros dias. Lave la zona con agua y jabon suave, " +
      "seque sin frotar y cubra con un aposito limpio. Cambie el aposito una vez al dia, o antes " +
      "si se moja o se ensucia, y lavese las manos antes y despues de tocarlo. " +
      "Al cambiarlo, mire la herida: interesa si el enrojecimiento crece de un dia para otro, si " +
      "la zona esta mas caliente que el resto de la piel, y si sale liquido, de que color y cuanto. " +
      "Un poco de liquido claro los primeros dias es esperable; lo que importa es si aumenta. " +
      "No aplique cremas, alcohol ni remedios caseros sobre la herida sin indicacion. " +
      "Evite sumergir la zona en piscinas o baneras hasta que se lo autoricen; ducharse suele estar permitido.",
  },
  {
    doc_id: "semilla-signos-de-alarma",
    title: "Cuando volver a consultar despues de una cirugia",
    kind: "complicaciones",
    lang: "es",
    origin: `${ENCABEZADO} No procede de ninguna fuente real.`,
    effective_date: "2026-01-01",
    body:
      `${ENCABEZADO} ` +
      "Hay cambios que conviene consultar sin esperar a la cita de control. " +
      "Fiebre que aparece dias despues de la cirugia, cuando ya habia pasado, y no cede. " +
      "Dolor que en vez de ir bajando dia a dia empieza a subir, o que deja de responder al analgesico " +
      "que antes le servia. " +
      "Salida de material por la herida, sobre todo si es espeso, opaco o huele mal. " +
      "Enrojecimiento que se extiende mas alla del borde de la herida. " +
      "Dejar de comer o de dormir por el malestar, no por incomodidad puntual: cuando el cuerpo deja " +
      "de sostener lo basico, el cuadro cambia de naturaleza aunque cada sintoma por separado parezca menor. " +
      "Dificultad para respirar, dolor en el pecho o sangrado abundante requieren atencion inmediata y " +
      "no una llamada de seguimiento.",
  },
  {
    doc_id: "semilla-movilidad-y-reposo",
    title: "Movilidad temprana y reposo despues de una cirugia abdominal",
    kind: "procedimiento",
    lang: "es",
    origin: `${ENCABEZADO} No procede de ninguna fuente real.`,
    effective_date: "2026-01-01",
    body:
      `${ENCABEZADO} ` +
      "Caminar distancias cortas varias veces al dia se recomienda desde temprano. " +
      "La movilidad temprana reduce complicaciones respiratorias y de circulacion, y no compite con el " +
      "reposo de la zona intervenida: son cosas distintas. " +
      "Levantarse despacio, apoyandose, y sentarse antes de ponerse de pie evita mareos. " +
      "Evite levantar peso durante las primeras semanas y suba escaleras despacio, apoyandose en la baranda. " +
      "Retome la alimentacion habitual de forma progresiva, empezando por liquidos claros y avanzando a " +
      "blandos segun tolerancia. " +
      "Tome los analgesicos en los horarios indicados y no espere a que el dolor sea intenso para tomarlos: " +
      "controlar el dolor es lo que permite moverse, y moverse es lo que acorta la recuperacion.",
  },
];
