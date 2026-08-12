/**
 * WO-26 — el dominio es DATO, no codigo.
 *
 * El motor no conoce clinica. La taxonomia entra por archivo, se valida entera al
 * cargar y a partir de ahi es una estructura inmutable que el calculo solo lee.
 * Cambiar de dominio es sustituir un archivo y una `domain_version`, nunca editar
 * este modulo — esa es la propiedad que hace que el conocimiento del modulo se
 * actualice de forma versionada y auditable en vez de por efecto lateral (ADR-010).
 *
 * ================== Dos reglas de validacion que no son obvias ==================
 *
 * 1. UNA CLASE COMPUESTA SE DECLARA EN `clases` CON `producida_por_composicion`.
 *    El universo de clases queda autocontenido: `integridad_comprometida` y
 *    `convergencia_sistemica` estan en el catalogo como cualquier otra, con su eje, y
 *    ademas dicen que regla las emite. El cargador valida las tres coherencias que
 *    esa convencion habilita: que el `rule_id` que declaran exista y coincida, que
 *    ninguna clase compuesta sea alcanzable desde un corte de la funcion de clase —no
 *    sale de un valor, sale de una combinacion— y que la dependencia entre
 *    composiciones apunte hacia ATRAS en el orden de declaracion, para evaluarlas en
 *    una sola pasada sin punto fijo ni riesgo de ciclo.
 *
 * 2. UNA CLASE SIN EJE NO AFIRMA NADA SOBRE NINGUN EJE de ADR-006, y por eso no es
 *    hallazgo. Es como el dominio expresa "esto esta dentro de lo esperado" sin que
 *    el motor tenga que conocer el identificador `sin_compromiso`. La unica excepcion
 *    es la clase de fallback, que tampoco tiene eje pero SI se reporta: no afirma nada
 *    del paciente, afirma algo del modulo, y callarla escondería la taxonomia incompleta.
 *
 * ==============================================================================
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type {
  DomainManifest,
  IssueSink,
  ValidationCode,
  ValidationResult,
} from "@techsphere/contracts";
import { ErrorDeDominio } from "./errores.ts";

// El vocabulario de `ValidationIssue` es del modulo de contratos; los tres
// ayudantes para poblarlo no estan en su superficie publica y no se amplia esa
// superficie desde aqui: son cuatro lineas y el tipo —que es lo que de verdad
// tiene que ser compartido— si viene de alli.

function agregar(sink: IssueSink, path: string, code: ValidationCode, message: string, hint: string): void {
  sink.push({ path, code, message, hint });
}

function resultado(issues: IssueSink): ValidationResult {
  return { valid: issues.length === 0, issues };
}

function describir(valor: unknown): string {
  if (valor === null) return "null";
  if (valor === undefined) return "undefined";
  if (Array.isArray(valor)) return `array de ${valor.length} elemento(s)`;
  if (typeof valor === "string") return `la cadena ${JSON.stringify(valor)}`;
  if (typeof valor === "object") return `un objeto con claves [${Object.keys(valor).join(", ")}]`;
  return `${typeof valor} ${String(valor)}`;
}

// ---------------------------------------------------------------------------
// Forma del dominio ya cargado
// ---------------------------------------------------------------------------

/** Los tres ejes de ADR-006. El dominio reparte sus unidades entre ellos. */
export type EjeDominio = "funcionalidad" | "interaccion" | "integridad";

export const EJES_DOMINIO: readonly EjeDominio[] = ["funcionalidad", "interaccion", "integridad"];

export interface ClaseDeclarada {
  id: string;
  /** `null` = la clase no afirma nada sobre ningun eje, y por tanto no es hallazgo. */
  eje: EjeDominio | null;
  descripcion: string;
  es_fallback: boolean;
  /**
   * `rule_id` de la composicion que la emite, cuando la clase no sale de la funcion
   * de clase sino de una combinacion. Es lo que deja el universo de clases
   * autocontenido sin que el cargador tenga que tratarla como caso especial.
   */
  producida_por_composicion: string | null;
}

export type Operador = ">=" | ">" | "<=" | "<" | "==";

/** Un corte de la funcion de clase sobre una magnitud. Se evaluan EN ORDEN. */
export interface Corte {
  operador: Operador;
  valor: number;
  clase: string;
  rule_id: string;
  /** Mecanismo de modificadores (Motor A §2.1). El dominio C1 no declara ninguno. */
  modificador?: { id: string; tramo: string };
}

export interface MapeoCategorico {
  valor: string;
  clase: string;
  rule_id: string;
  modificador?: { id: string; tramo: string };
}

export type TipoDeUnidad = "quantity" | "scale" | "categorical" | "boolean";

export interface FuncionDeClaseUnidad {
  unidad: string;
  tipo: TipoDeUnidad;
  /** Magnitudes: cortes en orden, gana el primero que aplica. */
  cortes: Corte[];
  /** Ordinales y booleanos: mapa valor -> clase. */
  mapa: MapeoCategorico[];
}

export interface Composicion {
  rule_id: string;
  nombre: string;
  clases_requeridas: string[];
  /** Unidades de origen admisibles (spec §7.4). Ausente = cualquiera. */
  unidades_requeridas: string[] | null;
  clase_producida: string;
  modificador?: { id: string; tramo: string };
}

export interface ModificadorDeclarado {
  id: string;
  valores: Array<string | number>;
  /** Tramo -> valores que lo componen. */
  tramos: Array<{ id: string; valores: Array<string | number> }>;
}

export interface Dominio {
  version: string;
  nombre: string;
  checksum: string;
  declaracion: string;
  validez_clinica: DomainManifest["validez_clinica"];
  /** eje -> unidades declaradas en el. */
  ejes: Map<EjeDominio, string[]>;
  /** unidad -> eje. Es lo que puebla `coverage.no_evaluadas[].eje_afectado`. */
  ejeDeUnidad: Map<string, EjeDominio>;
  clases: Map<string, ClaseDeclarada>;
  claseFallback: string;
  funcionDeClase: Map<string, FuncionDeClaseUnidad>;
  /**
   * Los `unit_id` que este dominio reconoce (hallazgo D5). Una unidad que no este
   * aqui es ERROR DE CABLEADO, no hueco de dominio, y no debe colapsar al fallback
   * en silencio: se reporta como no evaluable con causa propia.
   */
  unidadesCanonicas: Set<string>;
  composiciones: Composicion[];
  /** Clases producidas por composicion, en orden de declaracion. */
  clasesCompuestas: Map<string, Composicion>;
  modificadores: Map<string, ModificadorDeclarado>;
  /** Unidades minimas para declarar una clase convergente (Motor A §5.2). */
  umbralConvergencia: number;
  /** Unidades cuya perdida deja ciego tambien al eje de interaccion. */
  unidadesQueAlimentanComposiciones: Set<string>;
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

const REF = "docs/Ordenes-de-Trabajo-Capa-Determinista.md WO-26";

/** Carga desde disco. Es el UNICO acceso a disco del modulo, y ocurre antes de evaluar. */
export function cargarDominioDesdeArchivo(ruta: string): Dominio {
  const bytes = readFileSync(ruta);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let crudo: unknown;
  try {
    crudo = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    throw new ErrorDeDominio(ruta, [
      {
        path: "",
        code: "tipo_invalido",
        message: `El archivo no es JSON valido: ${(e as Error).message}`,
        hint: `El dominio se carga y se valida entero antes de la primera evaluacion (${REF}).`,
      },
    ]);
  }
  return construirDominio(crudo, checksum, ruta);
}

/** Carga desde un objeto ya en memoria. Para pruebas: el checksum se declara. */
export function cargarDominio(crudo: unknown, checksum: string, fuente = "en memoria"): Dominio {
  return construirDominio(crudo, checksum, fuente);
}

export function manifiestoDe(d: Dominio): DomainManifest {
  return {
    domain_version: d.version,
    domain_name: d.nombre,
    checksum: d.checksum,
    clases: d.clases.size,
    composiciones: d.composiciones.length,
    modificadores: [...d.modificadores.keys()].sort(),
    validez_clinica: d.validez_clinica,
  };
}

// ---------------------------------------------------------------------------
// Validacion estructural — falla al cargar, señalando el elemento
// ---------------------------------------------------------------------------

function construirDominio(crudo: unknown, checksum: string, fuente: string): Dominio {
  const sink: IssueSink = [];
  const raiz = objeto(sink, "", crudo, "el archivo de dominio");
  if (!raiz) throw new ErrorDeDominio(fuente, sink);

  const version = cadena(sink, "domain_version", raiz["domain_version"]);
  const nombre = cadena(sink, "domain_name", raiz["domain_name"]);

  // ADR-010 / WO-26 paso 5 — la declaracion tiene que ser legible FUERA de contexto.
  const declaracion = cadena(sink, "_declaracion", raiz["_declaracion"], {
    hint:
      `Todo archivo de dominio declara su validez en su propia cabecera, para que sea imposible ` +
      `confundirlo con dominio clinico validado incluso leido suelto. Sin experto que la valide, ` +
      `la taxonomia es sintetica y el archivo tiene que decirlo (ADR-010, ADR-012, ${REF} paso 5).`,
  });

  const validezCruda = raiz["validez_clinica"];
  let validez: DomainManifest["validez_clinica"] = "sin_validez_clinica_dominio_sintetico";
  if (validezCruda !== undefined) {
    if (validezCruda === "validado_por_experto" || validezCruda === "sin_validez_clinica_dominio_sintetico") {
      validez = validezCruda;
    } else {
      agregar(
        sink,
        "validez_clinica",
        "valor_fuera_de_enum",
        `Se recibio ${describir(validezCruda)}.`,
        `Solo "sin_validez_clinica_dominio_sintetico" o "validado_por_experto" (ADR-010). El default ` +
          `cuando el campo no viene es el sintetico: la validez clinica se declara, no se presume.`,
      );
    }
  }

  const clases = leerClases(sink, raiz["clases"]);
  const claseFallback = [...clases.values()].filter((c) => c.es_fallback);
  if (claseFallback.length !== 1) {
    agregar(
      sink,
      "clases",
      claseFallback.length === 0 ? "campo_ausente" : "duplicado",
      `Debe haber EXACTAMENTE una clase con "es_fallback": true; hay ${claseFallback.length}.`,
      `La clase de fallback es lo que garantiza el cierre total: todo valor sin mapeo cae ahi y el ` +
        `motor nunca lanza ni deja un hueco (Motor A §4.3). Sin ella, un valor imprevisto del paciente ` +
        `tumbaria la evaluacion; con dos, el cierre deja de ser determinista.`,
    );
  }

  const ejes = leerEjes(sink, raiz["ejes"]);
  const ejeDeUnidad = new Map<string, EjeDominio>();
  for (const [eje, unidades] of ejes) {
    for (const u of unidades) {
      const previo = ejeDeUnidad.get(u);
      if (previo !== undefined) {
        agregar(
          sink,
          `ejes.${eje}`,
          "duplicado",
          `La unidad ${JSON.stringify(u)} esta declarada en dos ejes: ${previo} y ${eje}.`,
          `Cada unidad informa UN eje de ADR-006. Es lo que permite decir que eje queda ciego cuando ` +
            `la unidad no se pudo evaluar (ADR-009), y con dos ejes esa respuesta seria ambigua.`,
        );
      }
      ejeDeUnidad.set(u, eje);
    }
  }

  const funcionDeClase = leerFuncionDeClase(sink, raiz["funcion_de_clase"], clases);

  // Coherencia cruzada: toda unidad tiene eje y funcion de clase, en los dos sentidos.
  for (const unidad of funcionDeClase.keys()) {
    if (!ejeDeUnidad.has(unidad)) {
      agregar(
        sink,
        `funcion_de_clase.${unidad}`,
        "referencia_rota",
        `La unidad tiene funcion de clase pero no esta declarada en ningun eje.`,
        `Sin eje, sus hallazgos no saben a que parte del reporte pertenecen y su ausencia no sabe que ` +
          `eje deja ciego (ADR-006, ADR-009). Declarala en "ejes" (${REF}).`,
      );
    }
  }
  for (const unidad of ejeDeUnidad.keys()) {
    if (!funcionDeClase.has(unidad)) {
      agregar(
        sink,
        `ejes`,
        "referencia_rota",
        `La unidad ${JSON.stringify(unidad)} esta en un eje pero no tiene funcion de clase.`,
        `Una unidad sin funcion de clase colapsaria SIEMPRE al fallback, inflando fallback_rate sin que ` +
          `nadie lo note. Declara sus cortes o quitala del eje (${REF}).`,
      );
    }
  }

  const modificadores = leerModificadores(sink, raiz["modificadores"]);
  const { composiciones, clasesCompuestas } = leerComposiciones(
    sink,
    raiz["composiciones"],
    clases,
    funcionDeClase,
    modificadores,
  );
  comprobarModificadoresDeFuncionDeClase(sink, funcionDeClase, modificadores);
  comprobarClasesCompuestas(sink, clases, funcionDeClase, clasesCompuestas);

  const unidadesCanonicas = leerUnidadesCanonicas(sink, raiz["unidades_canonicas"], funcionDeClase);
  const umbral = leerUmbral(sink, raiz["umbral_convergencia"]);

  if (sink.length > 0) throw new ErrorDeDominio(fuente, sink);

  const unidadesQueAlimentanComposiciones = new Set<string>();
  const clasesExigidas = new Set(composiciones.flatMap((c) => c.clases_requeridas));
  for (const fn of funcionDeClase.values()) {
    const alcanzables = [...fn.cortes.map((c) => c.clase), ...fn.mapa.map((m) => m.clase)];
    if (alcanzables.some((c) => clasesExigidas.has(c))) {
      unidadesQueAlimentanComposiciones.add(fn.unidad);
    }
  }
  for (const comp of composiciones) {
    for (const u of comp.unidades_requeridas ?? []) unidadesQueAlimentanComposiciones.add(u);
  }

  return {
    version: version ?? "",
    nombre: nombre ?? "",
    checksum,
    declaracion: declaracion ?? "",
    validez_clinica: validez,
    ejes,
    ejeDeUnidad,
    clases,
    claseFallback: claseFallback[0]?.id ?? "",
    funcionDeClase,
    unidadesCanonicas,
    composiciones,
    clasesCompuestas,
    modificadores,
    umbralConvergencia: umbral,
    unidadesQueAlimentanComposiciones,
  };
}

function leerClases(sink: IssueSink, valor: unknown): Map<string, ClaseDeclarada> {
  const clases = new Map<string, ClaseDeclarada>();
  const arreglo = lista(sink, "clases", valor);
  if (!arreglo) return clases;

  arreglo.forEach((item, i) => {
    const ruta = `clases[${i}]`;
    const obj = objeto(sink, ruta, item, "una clase");
    if (!obj) return;
    const id = cadena(sink, `${ruta}.id`, obj["id"]);
    if (id === undefined) return;
    if (clases.has(id)) {
      agregar(sink, `${ruta}.id`, "duplicado", `La clase ${JSON.stringify(id)} ya estaba declarada.`, `Los identificadores de clase son la moneda del reporte y de la traza: repetirlos hace que dos hallazgos distintos sean indistinguibles.`);
      return;
    }
    const ejeCrudo = obj["eje"];
    let eje: EjeDominio | null = null;
    if (ejeCrudo !== null && ejeCrudo !== undefined) {
      if (typeof ejeCrudo === "string" && (EJES_DOMINIO as readonly string[]).includes(ejeCrudo)) {
        eje = ejeCrudo as EjeDominio;
      } else {
        agregar(
          sink,
          `${ruta}.eje`,
          "valor_fuera_de_enum",
          `Se recibio ${describir(ejeCrudo)}.`,
          `Los ejes son los tres de ADR-006: funcionalidad, interaccion, integridad. O null, que significa ` +
            `"esta clase no afirma nada sobre ningun eje" y es como se declara lo esperado.`,
        );
      }
    }
    const producida = obj["producida_por_composicion"];
    if (producida !== undefined && (typeof producida !== "string" || producida.trim() === "")) {
      agregar(sink, `${ruta}.producida_por_composicion`, "tipo_invalido", `Se recibio ${describir(producida)}.`, `Si la clase la emite una composicion, el campo lleva el rule_id de esa composicion. Si sale de la funcion de clase, se omite.`);
    }

    clases.set(id, {
      id,
      eje,
      descripcion: typeof obj["descripcion"] === "string" ? obj["descripcion"] : "",
      es_fallback: obj["es_fallback"] === true,
      producida_por_composicion: typeof producida === "string" ? producida : null,
    });
  });

  return clases;
}

function leerEjes(sink: IssueSink, valor: unknown): Map<EjeDominio, string[]> {
  const ejes = new Map<EjeDominio, string[]>();
  const obj = objeto(sink, "ejes", valor, "el reparto de unidades por eje");
  if (!obj) return ejes;

  for (const eje of EJES_DOMINIO) {
    const bloque = objeto(sink, `ejes.${eje}`, obj[eje], `el eje ${eje}`);
    if (!bloque) continue;
    const unidades = lista(sink, `ejes.${eje}.unidades`, bloque["unidades"]);
    if (!unidades) continue;
    const ids: string[] = [];
    unidades.forEach((u, i) => {
      const id = cadena(sink, `ejes.${eje}.unidades[${i}]`, u);
      if (id !== undefined) ids.push(id);
    });
    ejes.set(eje, ids);
  }

  return ejes;
}

function leerFuncionDeClase(
  sink: IssueSink,
  valor: unknown,
  clases: Map<string, ClaseDeclarada>,
): Map<string, FuncionDeClaseUnidad> {
  const fn = new Map<string, FuncionDeClaseUnidad>();
  const obj = objeto(sink, "funcion_de_clase", valor, "la funcion de clase");
  if (!obj) return fn;

  for (const [unidad, cuerpoCrudo] of Object.entries(obj)) {
    if (unidad.startsWith("_")) continue;
    const ruta = `funcion_de_clase.${unidad}`;
    const cuerpo = objeto(sink, ruta, cuerpoCrudo, `la funcion de clase de ${unidad}`);
    if (!cuerpo) continue;

    const tipoCrudo = cuerpo["tipo"];
    const tipos: TipoDeUnidad[] = ["quantity", "scale", "categorical", "boolean"];
    if (typeof tipoCrudo !== "string" || !(tipos as string[]).includes(tipoCrudo)) {
      agregar(sink, `${ruta}.tipo`, "valor_fuera_de_enum", `Se recibio ${describir(tipoCrudo)}.`, `Tipos admitidos: ${tipos.join(", ")}. El tipo decide si el valor se compara por corte o por mapa.`);
      continue;
    }
    const tipo = tipoCrudo as TipoDeUnidad;

    const cortes: Corte[] = [];
    const mapa: MapeoCategorico[] = [];

    if (tipo === "quantity" || tipo === "scale") {
      const arreglo = lista(sink, `${ruta}.cortes`, cuerpo["cortes"]);
      arreglo?.forEach((item, i) => {
        const r = `${ruta}.cortes[${i}]`;
        const c = objeto(sink, r, item, "un corte");
        if (!c) return;
        const operadores: Operador[] = [">=", ">", "<=", "<", "=="];
        const op = c["operador"];
        if (typeof op !== "string" || !(operadores as string[]).includes(op)) {
          agregar(sink, `${r}.operador`, "valor_fuera_de_enum", `Se recibio ${describir(op)}.`, `Operadores admitidos: ${operadores.join(" ")}.`);
          return;
        }
        const v = c["valor"];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          agregar(sink, `${r}.valor`, "tipo_invalido", `Se recibio ${describir(v)}.`, `El corte compara magnitudes: el valor tiene que ser un numero finito.`);
          return;
        }
        const clase = referenciaDeClase(sink, `${r}.clase`, c["clase"], clases);
        const rule_id = cadena(sink, `${r}.rule_id`, c["rule_id"], {
          hint: `Sin rule_id el hallazgo no es reconstruible, y los rule_id son la fuente unica de Decision.traces.rules_fired (spec §6.4, invariante 1).`,
        });
        if (clase === undefined || rule_id === undefined) return;
        const corte: Corte = { operador: op as Operador, valor: v, clase, rule_id };
        const mod = leerModificadorDeRegla(sink, r, c["modificador"]);
        if (mod) corte.modificador = mod;
        cortes.push(corte);
      });
    } else {
      const m = objeto(sink, `${ruta}.mapa`, cuerpo["mapa"], `el mapa de ${unidad}`);
      if (m) {
        for (const [clave, destinoCrudo] of Object.entries(m)) {
          if (clave.startsWith("_")) continue;
          const r = `${ruta}.mapa.${clave}`;
          const destino = objeto(sink, r, destinoCrudo, "una entrada del mapa");
          if (!destino) continue;
          const clase = referenciaDeClase(sink, `${r}.clase`, destino["clase"], clases);
          const rule_id = cadena(sink, `${r}.rule_id`, destino["rule_id"], {
            hint: `Sin rule_id el hallazgo no es reconstruible (spec §6.4, invariante 1).`,
          });
          if (clase === undefined || rule_id === undefined) continue;
          const entrada: MapeoCategorico = { valor: clave, clase, rule_id };
          const mod = leerModificadorDeRegla(sink, r, destino["modificador"]);
          if (mod) entrada.modificador = mod;
          mapa.push(entrada);
        }
      }
    }

    if (cortes.length === 0 && mapa.length === 0) {
      agregar(
        sink,
        ruta,
        "vacio",
        `La unidad no declara ningun corte ni ninguna entrada de mapa.`,
        `Una unidad sin funcion de clase colapsa siempre al fallback. Si es lo que se quiere, quitala ` +
          `del dominio; si no, declara sus cortes (${REF} paso 2).`,
      );
    }

    fn.set(unidad, { unidad, tipo, cortes, mapa });
  }

  return fn;
}

function leerModificadorDeRegla(
  sink: IssueSink,
  ruta: string,
  valor: unknown,
): { id: string; tramo: string } | null {
  if (valor === undefined || valor === null) return null;
  const obj = objeto(sink, `${ruta}.modificador`, valor, "un modificador de regla");
  if (!obj) return null;
  const id = cadena(sink, `${ruta}.modificador.id`, obj["id"]);
  const tramo = cadena(sink, `${ruta}.modificador.tramo`, obj["tramo"]);
  if (id === undefined || tramo === undefined) return null;
  return { id, tramo };
}

function leerModificadores(sink: IssueSink, valor: unknown): Map<string, ModificadorDeclarado> {
  const mods = new Map<string, ModificadorDeclarado>();
  if (valor === undefined) return mods;
  const obj = objeto(sink, "modificadores", valor, "el catalogo de modificadores");
  if (!obj) return mods;

  for (const [id, cuerpoCrudo] of Object.entries(obj)) {
    if (id.startsWith("_")) continue;
    const ruta = `modificadores.${id}`;
    const cuerpo = objeto(sink, ruta, cuerpoCrudo, `el modificador ${id}`);
    if (!cuerpo) continue;
    const valores = lista(sink, `${ruta}.valores`, cuerpo["valores"]);
    if (!valores) continue;
    const admitidos: Array<string | number> = [];
    valores.forEach((v, i) => {
      if (typeof v === "string" || typeof v === "number") admitidos.push(v);
      else agregar(sink, `${ruta}.valores[${i}]`, "tipo_invalido", `Se recibio ${describir(v)}.`, `Un modificador transversal es un escalar: string o number.`);
    });

    const tramos: ModificadorDeclarado["tramos"] = [];
    const tramosCrudos = cuerpo["tramos"];
    if (tramosCrudos !== undefined) {
      const arreglo = lista(sink, `${ruta}.tramos`, tramosCrudos);
      arreglo?.forEach((t, i) => {
        const r = `${ruta}.tramos[${i}]`;
        const obj2 = objeto(sink, r, t, "un tramo");
        if (!obj2) return;
        const tid = cadena(sink, `${r}.id`, obj2["id"]);
        const vals = lista(sink, `${r}.valores`, obj2["valores"]);
        if (tid === undefined || !vals) return;
        const propios: Array<string | number> = [];
        vals.forEach((v, j) => {
          if (typeof v !== "string" && typeof v !== "number") {
            agregar(sink, `${r}.valores[${j}]`, "tipo_invalido", `Se recibio ${describir(v)}.`, `Un tramo agrupa valores escalares del modificador.`);
            return;
          }
          if (!admitidos.includes(v)) {
            agregar(
              sink,
              `${r}.valores[${j}]`,
              "referencia_rota",
              `El tramo ${JSON.stringify(tid)} agrupa el valor ${JSON.stringify(v)}, que no esta en ${ruta}.valores.`,
              `Un tramo es una particion de los valores declarados. Agrupar uno que no existe deja una rama ` +
                `del dominio inalcanzable y nadie se entera (${REF} paso 2).`,
            );
            return;
          }
          propios.push(v);
        });
        tramos.push({ id: tid, valores: propios });
      });
    }

    mods.set(id, { id, valores: admitidos, tramos });
  }

  return mods;
}

function comprobarModificadoresDeFuncionDeClase(
  sink: IssueSink,
  funcionDeClase: Map<string, FuncionDeClaseUnidad>,
  modificadores: Map<string, ModificadorDeclarado>,
): void {
  const revisar = (ruta: string, mod: { id: string; tramo: string } | undefined): void => {
    if (!mod) return;
    const declarado = modificadores.get(mod.id);
    if (!declarado) {
      agregar(sink, ruta, "referencia_rota", `La regla exige el modificador ${JSON.stringify(mod.id)}, que no esta declarado.`, `Los modificadores se declaran una vez en "modificadores" y las reglas los referencian (Motor A §2.1).`);
      return;
    }
    if (!declarado.tramos.some((t) => t.id === mod.tramo)) {
      agregar(sink, ruta, "referencia_rota", `El modificador ${JSON.stringify(mod.id)} no declara el tramo ${JSON.stringify(mod.tramo)}.`, `Tramos declarados: ${declarado.tramos.map((t) => t.id).join(", ") || "(ninguno)"}.`);
    }
  };
  for (const fn of funcionDeClase.values()) {
    fn.cortes.forEach((c, i) => revisar(`funcion_de_clase.${fn.unidad}.cortes[${i}].modificador`, c.modificador));
    fn.mapa.forEach((m) => revisar(`funcion_de_clase.${fn.unidad}.mapa.${m.valor}.modificador`, m.modificador));
  }
}

function leerComposiciones(
  sink: IssueSink,
  valor: unknown,
  clases: Map<string, ClaseDeclarada>,
  funcionDeClase: Map<string, FuncionDeClaseUnidad>,
  modificadores: Map<string, ModificadorDeclarado>,
): { composiciones: Composicion[]; clasesCompuestas: Map<string, Composicion> } {
  const composiciones: Composicion[] = [];
  const clasesCompuestas = new Map<string, Composicion>();
  if (valor === undefined) return { composiciones, clasesCompuestas };
  const arreglo = lista(sink, "composiciones", valor);
  if (!arreglo) return { composiciones, clasesCompuestas };

  arreglo.forEach((item, i) => {
    const ruta = `composiciones[${i}]`;
    const obj = objeto(sink, ruta, item, "una composicion");
    if (!obj) return;

    const rule_id = cadena(sink, `${ruta}.rule_id`, obj["rule_id"], {
      hint: `Una composicion sin rule_id activa una lectura que nadie puede citar (spec §6.4, invariante 1).`,
    });
    const nombre = cadena(sink, `${ruta}.nombre`, obj["nombre"]);
    const producida = cadena(sink, `${ruta}.clase_producida`, obj["clase_producida"], {
      hint: `Es el significado que ninguna parte tiene por separado (spec §7.4).`,
    });

    const requeridasCrudas = lista(sink, `${ruta}.clases_requeridas`, obj["clases_requeridas"]);
    const requeridas: string[] = [];
    requeridasCrudas?.forEach((c, j) => {
      const id = cadena(sink, `${ruta}.clases_requeridas[${j}]`, c);
      if (id === undefined) return;
      const declarada = clases.get(id);
      if (!declarada) {
        agregar(
          sink,
          `${ruta}.clases_requeridas[${j}]`,
          "referencia_rota",
          `La composicion exige la clase ${JSON.stringify(id)}, que no esta declarada en "clases".`,
          `El universo de clases es autocontenido: incluso las clases compuestas se declaran, con su eje y ` +
            `con el rule_id que las emite. Una clase exigida y no declarada produce hallazgos que el resto ` +
            `del sistema no sabe leer (${REF} paso 2).`,
        );
        return;
      }
      // Encadenamiento: si la clase la emite una composicion, tiene que ser una ANTERIOR.
      if (declarada.producida_por_composicion !== null && !clasesCompuestas.has(id)) {
        agregar(
          sink,
          `${ruta}.clases_requeridas[${j}]`,
          "referencia_rota",
          `La composicion exige ${JSON.stringify(id)}, que la emite ${JSON.stringify(declarada.producida_por_composicion)} y esa regla no esta declarada ANTES.`,
          `Una composicion puede encadenar sobre otra —es lo que hace la convergencia sistemica sobre la ` +
            `integridad comprometida— pero la dependencia tiene que apuntar hacia atras en el orden de ` +
            `declaracion. Asi las composiciones se evaluan en una sola pasada y en orden fijo, sin punto ` +
            `fijo ni ciclos: la trazabilidad termino a termino es la razon de existir de esta capa (ADR-008).`,
        );
        return;
      }
      requeridas.push(id);
    });

    if (requeridas.length === 0 && requeridasCrudas !== undefined) {
      agregar(sink, `${ruta}.clases_requeridas`, "vacio", `La composicion no exige ninguna clase.`, `Una composicion se activa por la presencia del conjunto COMPLETO de clases requeridas; sin conjunto, se activaria siempre.`);
    }

    let unidades: string[] | null = null;
    const unidadesCrudas = obj["unidades_requeridas"];
    if (unidadesCrudas !== undefined) {
      const arr = lista(sink, `${ruta}.unidades_requeridas`, unidadesCrudas);
      if (arr) {
        unidades = [];
        arr.forEach((u, j) => {
          const id = cadena(sink, `${ruta}.unidades_requeridas[${j}]`, u);
          if (id === undefined) return;
          if (!funcionDeClase.has(id)) {
            agregar(sink, `${ruta}.unidades_requeridas[${j}]`, "referencia_rota", `La composicion admite como origen la unidad ${JSON.stringify(id)}, que no existe en la funcion de clase.`, `Las unidades de origen admisibles restringen de donde pueden salir las clases requeridas (spec §7.4).`);
            return;
          }
          unidades!.push(id);
        });
      }
    }

    if (rule_id === undefined || nombre === undefined || producida === undefined) return;

    // La clase producida SE DECLARA en `clases`, y ademas tiene que decir que esta
    // regla la emite. Sin ese marcador, una clase compuesta y una clase base con el
    // mismo id serian indistinguibles en el reporte: no se sabria si el hallazgo
    // salio de una unidad o de una combinacion.
    const declaradaProducida = clases.get(producida);
    if (!declaradaProducida) {
      agregar(
        sink,
        `${ruta}.clase_producida`,
        "referencia_rota",
        `La composicion produce ${JSON.stringify(producida)}, que no esta declarada en "clases".`,
        `Declarala con su eje y con "producida_por_composicion": ${JSON.stringify(rule_id)}. Asi el universo ` +
          `de clases queda autocontenido y su eje se lee del catalogo como el de cualquier otra (${REF} paso 1).`,
      );
    } else if (declaradaProducida.producida_por_composicion !== rule_id) {
      agregar(
        sink,
        `${ruta}.clase_producida`,
        "incoherencia",
        declaradaProducida.producida_por_composicion === null
          ? `La clase ${JSON.stringify(producida)} esta declarada como clase base pero la produce ${JSON.stringify(rule_id)}.`
          : `La clase ${JSON.stringify(producida)} dice que la emite ${JSON.stringify(declaradaProducida.producida_por_composicion)} y la produce ${JSON.stringify(rule_id)}.`,
        `El catalogo y las composiciones tienen que coincidir en QUE regla emite cada clase compuesta: es ` +
          `lo que permite recorrer un hallazgo hacia atras hasta la combinacion que lo origino, y con dos ` +
          `versiones de esa verdad la traza deja de ser reconstruible (spec §6.4, invariante 3).`,
      );
    }
    if (clasesCompuestas.has(producida)) {
      agregar(sink, `${ruta}.clase_producida`, "duplicado", `Otra composicion ya produce ${JSON.stringify(producida)}.`, `Dos reglas que emiten la misma clase compuesta hacen ambigua la traza hacia atras.`);
    }

    const comp: Composicion = {
      rule_id,
      nombre,
      clases_requeridas: requeridas,
      unidades_requeridas: unidades,
      clase_producida: producida,
    };
    const mod = leerModificadorDeRegla(sink, ruta, obj["modificador"]);
    if (mod) {
      const declarado = modificadores.get(mod.id);
      if (!declarado) {
        agregar(sink, `${ruta}.modificador.id`, "referencia_rota", `Modificador no declarado: ${JSON.stringify(mod.id)}.`, `Declaralo en "modificadores" (Motor A §2.1).`);
      } else if (!declarado.tramos.some((t) => t.id === mod.tramo)) {
        agregar(sink, `${ruta}.modificador.tramo`, "referencia_rota", `Tramo no declarado: ${JSON.stringify(mod.tramo)}.`, `Tramos: ${declarado.tramos.map((t) => t.id).join(", ") || "(ninguno)"}.`);
      }
      comp.modificador = mod;
    }

    // Las clases base requeridas se cubren con unidades DISTINTAS: si la composicion
    // exige mas clases base que unidades admisibles, no puede activarse nunca.
    const base = requeridas.filter((c) => clases.has(c));
    if (unidades !== null && base.length > unidades.length) {
      agregar(
        sink,
        `${ruta}.unidades_requeridas`,
        "incoherencia",
        `Exige ${base.length} clase(s) base pero solo admite ${unidades.length} unidad(es) de origen.`,
        `Cada ocurrencia de una clase requerida se cubre con una unidad DISTINTA —es lo que hace que ` +
          `"apetito y sueño cedidos" signifique dos unidades y no una contada dos veces—, asi que la regla ` +
          `nunca podria activarse.`,
      );
    }

    composiciones.push(comp);
    clasesCompuestas.set(producida, comp);
  });

  return { composiciones, clasesCompuestas };
}

/**
 * Coherencia de las clases compuestas contra la funcion de clase.
 *
 * Una clase que emite una composicion NO puede salir tambien de un corte: si un
 * valor por si solo la produjera, la composicion seria decorativa y el reporte no
 * distinguiria "esto lo dijo una unidad" de "esto solo existe entre unidades", que
 * es la frontera entre el eje de funcionalidad y el de interaccion (spec §6.4).
 */
function comprobarClasesCompuestas(
  sink: IssueSink,
  clases: Map<string, ClaseDeclarada>,
  funcionDeClase: Map<string, FuncionDeClaseUnidad>,
  clasesCompuestas: Map<string, Composicion>,
): void {
  const alcanzablesDesdeValor = new Map<string, string>();
  for (const fn of funcionDeClase.values()) {
    for (const c of fn.cortes) alcanzablesDesdeValor.set(c.clase, `${fn.unidad}.cortes`);
    for (const m of fn.mapa) alcanzablesDesdeValor.set(m.clase, `${fn.unidad}.mapa.${m.valor}`);
  }

  for (const clase of clases.values()) {
    if (clase.producida_por_composicion === null) continue;

    if (!clasesCompuestas.has(clase.id)) {
      agregar(
        sink,
        `clases.${clase.id}.producida_por_composicion`,
        "referencia_rota",
        `Declara que la emite ${JSON.stringify(clase.producida_por_composicion)}, y ninguna composicion con ese rule_id la produce.`,
        `O sobra el marcador —la clase sale de la funcion de clase— o falta la composicion. Una clase ` +
          `compuesta que ninguna regla emite es una clase inalcanzable, y el motor no puede avisarlo en ` +
          `runtime porque su ausencia se ve igual que "no se dio el caso" (${REF} paso 2).`,
      );
    }

    const origen = alcanzablesDesdeValor.get(clase.id);
    if (origen !== undefined) {
      agregar(
        sink,
        `funcion_de_clase.${origen}`,
        "incoherencia",
        `La clase ${JSON.stringify(clase.id)} la emite una composicion y ademas la produce un valor suelto.`,
        `Si un valor por si solo la produjera, la composicion seria decorativa y el reporte no distinguiria ` +
          `lo que ocurre DENTRO de una unidad de lo que solo existe ENTRE unidades — que es la frontera ` +
          `entre el eje de funcionalidad y el de interaccion (spec §6.4).`,
      );
    }
  }
}

/**
 * Hallazgo D5 — los `unit_id` canonicos del dominio.
 *
 * El archivo puede declararlos explicitamente; si no lo hace, son las claves de la
 * funcion de clase. Se valida que las dos listas coincidan exactamente, porque el
 * proposito de la lista es distinguir un ERROR DE CABLEADO —un `unit_id` que la
 * conversacional escribio distinto— de un hueco de dominio, y una lista que no
 * corresponde con el motor no distingue nada.
 */
function leerUnidadesCanonicas(
  sink: IssueSink,
  valor: unknown,
  funcionDeClase: Map<string, FuncionDeClaseUnidad>,
): Set<string> {
  const delMotor = new Set(funcionDeClase.keys());
  if (valor === undefined) return delMotor;

  const arreglo = lista(sink, "unidades_canonicas", valor);
  if (!arreglo) return delMotor;

  const declaradas = new Set<string>();
  arreglo.forEach((u, i) => {
    const id = cadena(sink, `unidades_canonicas[${i}]`, u);
    if (id === undefined) return;
    if (!delMotor.has(id)) {
      agregar(
        sink,
        `unidades_canonicas[${i}]`,
        "referencia_rota",
        `Declara la unidad ${JSON.stringify(id)}, que no tiene funcion de clase.`,
        `La lista existe para distinguir un error de cableado de un hueco de dominio; si incluye unidades ` +
          `que el motor no sabe clasificar, no distingue nada (${REF} paso 2).`,
      );
      return;
    }
    declaradas.add(id);
  });

  for (const u of delMotor) {
    if (!declaradas.has(u)) {
      agregar(
        sink,
        "unidades_canonicas",
        "incoherencia",
        `La unidad ${JSON.stringify(u)} tiene funcion de clase y no aparece en la lista canonica.`,
        `Las dos listas tienen que coincidir exactamente, o una unidad legitima se reportaria como error ` +
          `de cableado.`,
      );
    }
  }

  return declaradas;
}

function leerUmbral(sink: IssueSink, valor: unknown): number {
  const PORDEFECTO = 2;
  if (valor === undefined) return PORDEFECTO;
  const obj = objeto(sink, "umbral_convergencia", valor, "el umbral de convergencia");
  if (!obj) return PORDEFECTO;
  const n = obj["unidades_minimas_para_patron_compartido"];
  if (n === undefined) return PORDEFECTO;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 2) {
    agregar(
      sink,
      "umbral_convergencia.unidades_minimas_para_patron_compartido",
      "fuera_de_rango",
      `Se recibio ${describir(n)}.`,
      `El umbral es un entero >= 2: con una sola unidad no hay patron compartido sino un caso unico, y ` +
        `declararlo como patron seria enunciar como sistemico lo que es local (Motor A §5.4).`,
    );
    return PORDEFECTO;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Primitivas de lectura — ninguna devuelve `undefined` en silencio
// ---------------------------------------------------------------------------

function objeto(
  sink: IssueSink,
  path: string,
  valor: unknown,
  que: string,
): Record<string, unknown> | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    agregar(sink, path, valor === undefined ? "campo_ausente" : "tipo_invalido", `Se esperaba ${que} y se recibio ${describir(valor)}.`, `Revisa la forma del archivo de dominio (${REF} paso 1).`);
    return null;
  }
  return valor as Record<string, unknown>;
}

function lista(sink: IssueSink, path: string, valor: unknown): unknown[] | null {
  if (!Array.isArray(valor)) {
    agregar(sink, path, valor === undefined ? "campo_ausente" : "tipo_invalido", `Se esperaba un arreglo y se recibio ${describir(valor)}.`, `Revisa la forma del archivo de dominio (${REF} paso 1).`);
    return null;
  }
  return valor;
}

function cadena(
  sink: IssueSink,
  path: string,
  valor: unknown,
  opciones?: { hint?: string },
): string | undefined {
  if (typeof valor !== "string" || valor.trim() === "") {
    agregar(
      sink,
      path,
      valor === undefined ? "campo_ausente" : typeof valor === "string" ? "vacio" : "tipo_invalido",
      `Se esperaba una cadena no vacia y se recibio ${describir(valor)}.`,
      opciones?.hint ?? `Revisa la forma del archivo de dominio (${REF} paso 1).`,
    );
    return undefined;
  }
  return valor;
}

function referenciaDeClase(
  sink: IssueSink,
  path: string,
  valor: unknown,
  clases: Map<string, ClaseDeclarada>,
): string | undefined {
  const id = cadena(sink, path, valor);
  if (id === undefined) return undefined;
  if (!clases.has(id)) {
    agregar(
      sink,
      path,
      "referencia_rota",
      `La funcion de clase mapea a ${JSON.stringify(id)}, que no esta en el universo de clases.`,
      `Toda clase referida tiene que existir en "clases". Una clase huerfana produce hallazgos que el ` +
        `resto del sistema no sabe leer, y el fallo aparecería en runtime y no al cargar (${REF} paso 2).`,
    );
    return undefined;
  }
  return id;
}

/** Introspeccion sin lanzar. Para la consola de auditoria y las pruebas. */
export function validarDominio(crudo: unknown, checksum = "sin-checksum"): ValidationResult {
  const sink: IssueSink = [];
  try {
    construirDominio(crudo, checksum, "validacion");
  } catch (e) {
    if (e instanceof ErrorDeDominio) sink.push(...e.issues);
    else throw e;
  }
  return resultado(sink);
}
