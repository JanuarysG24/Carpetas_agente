# `@techsphere/deterministic` — capa determinista

Módulo **puro** de evaluación estructural. Recibe el marco ya declarado suficiente y devuelve un reporte sobre los tres ejes de ADR-006 —**funcionalidad, interacción e integridad sistémica**— con trazas reconstruibles hasta el valor de entrada.

No diagnostica, no puntúa, no recomienda, no decide, no interpreta lenguaje natural, no consulta documentos y no aprende en ejecución. Es aritmética sobre valores ya normalizados. Su valor en el sistema es exactamente ese: ser el mecanismo cuyo **modo de fallo es distinto** al del modelo de lenguaje — dos votos correlacionados no son dos votos (ADR-013).

> **El binding del modelo cambió dos veces en un solo día (ADR-017 → ADR-021) y este módulo no se enteró.** No invoca ningún modelo, no tiene cliente HTTP y su única dependencia de runtime es el módulo de contratos. Esa inmunidad no es un efecto lateral: es la costura de aislamiento que hace que su voto sea idéntico ante el mismo caso cuando el del voto probabilístico no lo es.

## Uso

```ts
import { cargarDominioDesdeArchivo, MotorDeterminista } from "@techsphere/deterministic";

const dominio = cargarDominioDesdeArchivo("docs/dominio/dominio-postop-v0.1.json");
const det = new MotorDeterminista(dominio);

const reporte = det.evaluate(req);   // SÍNCRONO y puro
```

Lo invoca **la capa de decisión**, una sola vez por sesión, después de resolver `FrameVerdict.status = "sufficient"` y antes de construir la `Decision`. No se invoca en `escalateNow` —en urgencia no hay bucle ni tiempo de análisis estructural— y **no se expone como herramienta de un modelo**: si el LLM decidiera cuándo llamarlo, los dos votos dejarían de ser independientes.

## Qué garantiza, y cómo está probado

| Propiedad | Dónde se prueba |
|---|---|
| **Pureza** — sin red, sin disco, sin reloj, sin azar, sin estado | `wo31-pureza.test.ts` 2/7, espiando `fs`, `fetch`, `Date.now` y `Math.random` durante `evaluate` |
| **Identidad** — misma petición → mismo reporte **byte a byte** | 1/7, comparado por serialización y no campo a campo |
| **Invariancia al orden** — permutar `units` no cambia nada | 4/7 |
| **Cierre total** — ningún valor lanza; lo no mapeado cae al fallback | 5/7, con doce valores hostiles incluidos `__proto__` y `😷` |
| **Conservación (ADR-009)** — `evaluadas + no_evaluadas = total` | 6/7 y `wo27-elegibilidad.test.ts` |
| **ADR-007** — ni `alert`, ni `score`, ni `risk`, ni `severity`, ni `recommendation`, ni `diagnosis` | `wo25-contratos.test.ts`, recorriendo en profundidad **reportes realmente producidos** |
| **Versión obligatoria** — `domain_version` discordante falla, no calcula | `wo26-dominio.test.ts` |

`npm run verify` corre las 87 pruebas y el chequeo de tipos.

## El dominio es dato, no código

El motor no conoce clínica. La taxonomía entra por archivo y se valida **entera al cargar**: clase huérfana, doble fallback, composición rota, dependencia hacia adelante, unidad sin eje, tramo inexistente y umbral menor que 2 se rechazan señalando el elemento. Un dominio que solo explota a mitad de una evaluación produce reportes que parecen válidos, y este módulo existe para que eso no pueda pasar.

Tres reglas de lectura del archivo que no son obvias:

1. **Las clases compuestas se declaran en `clases`, con `producida_por_composicion`.** `integridad_comprometida` y `convergencia_sistemica` están en el catálogo como cualquier otra, con su eje, y además dicen qué regla las emite. El cargador valida las tres coherencias que esa convención habilita: que el `rule_id` declarado exista y coincida, que **ninguna clase compuesta sea alcanzable desde un corte** —no sale de un valor, sale de una combinación— y que la dependencia entre composiciones apunte **hacia atrás** en el orden de declaración, para evaluarlas en una sola pasada sin punto fijo ni ciclos.
2. **Una clase sin `eje` no es hallazgo.** Es como el dominio dice "esto está dentro de lo esperado" sin que el motor tenga que conocer el identificador `sin_compromiso`. La excepción es la clase de fallback: no afirma nada del paciente, afirma que la taxonomía no cubrió el valor, y callarlo escondería el único dato que permite mantener el dominio.
3. **Un `unit_id` fuera de `unidades_canonicas` es error de cableado, no hueco de dominio** (hallazgo D5). No colapsa al fallback en silencio: va a `coverage.no_evaluadas` con causa `unidad_fuera_del_dominio` y un aviso que nombra las unidades válidas. `fallback_rate` mide si la taxonomía cubre los **valores** que reporta la gente, y un `unit_id` mal escrito la haría ver incompleta cuando lo que está mal es el cable.

Los nodos estructurales del eje de integridad son los **ejes del dominio**, porque el árbol que este dominio declara es `eje → unidades`. Un `StructureHit` por unidad repetiría uno a uno los hallazgos de `funcionalidad.clases`: el nodo tiene que ser más grueso que el hallazgo para que la afirmación sea del **caso** y no de la parte.

> ⚠️ **Si vas a renderizar esto en lenguaje, lee X1 antes.** `origen_unit_ids` es **procedencia de la evidencia, no pertenencia al eje** (spec §6.4, hallazgo D10): una clase compuesta aporta las unidades de sus partes, que pueden ser de otro eje. `ST-interaccion` llega con `["apetito","fiebre","sueno"]` y el dominio pone una sola unidad en ese eje. Rendirlo como "unidades comprometidas" afirmaría que el apetito compromete el eje de interacción, que el dominio no dice. **Se rinde como "evidencia considerada"; la razón la da `clases_contribuyentes`.** La regla vive en X1 del Estado Vivo — esto es un apuntador, no una segunda copia.

## Verificación sobre los 160 casos

`test/trayectorias-160.test.ts` alimenta los valores de `trayectorias_postop_silver.xlsx` como entrada **ya normalizada**, directamente, sin conversacional y sin modelo:

```
CO-02  →  12 verdaderos positivos · 0 falsos positivos · 0 falsos negativos
fallback_rate 0 en los 160 · cobertura 1,0 · reproducible byte a byte
```

Esto mide **el motor aislado de la extracción**, y por eso es legítimo pese a H17: esa advertencia es sobre la tubería completa con la conversacional en andamio, no sobre aritmética alimentada con normalizados.

Lo que el número **no** significa, y va al informe con estas palabras: es calibración sobre datos **sintéticos**, y una regla con cero error sobre 12 positivos probablemente esté recuperando el generador del dataset, no una verdad clínica (procedencia `inferred`, ADR-012). Además fija el **techo**: la regla opera sobre normalizados, y un paciente minimizador que llama "calorcito" a 38,9 °C hace que la regla, siendo correcta, decida sobre un dato falso. La distancia hasta el techo la marca la calidad de la extracción, no esta capa.

Y el amarillo **no** se separa, deliberadamente: si el voto determinista resolviera también la zona ambigua, el probabilístico sería redundante y ADR-013 perdería su fundamento.

## Métricas

```bash
npm run metricas
```

Corrida sobre los 160 casos (`salidas/metricas-determinista.json`):

| | valor |
|---|---|
| n invocaciones | 160 |
| latencia media | **~0,12 ms** · p50 ~0,06 ms · máx 3,7 ms |
| `fallback_rate` | 0,000 |
| `coverage.ratio` | 1,000 |
| tokens / costo | **no aplican** — este módulo no invoca ningún modelo |

La latencia se mide **desde fuera**, con el decorador `DeterministaMedido`: meterle un reloj a la función pura solo para demostrar que es pura la volvería impura. El contraste con los ~12,5 s que costaba una sola llamada de suficiencia al modelo es el argumento de la arquitectura de dos votos.

`fallback_rate` es la métrica de **mantenimiento del dominio**: alto en uso real significa taxonomía incompleta, no paciente raro.

## Regenerar el fixture de los 160 casos

```bash
npm run fixture
```

Requiere `MaterialReto/` (que no se versiona). El fixture sí está commiteado, así que las pruebas corren sin el dataset.

## Órdenes de trabajo cubiertas

WO-25 (contratos) · WO-26 (cargador y semilla) · WO-27 (elegibilidad y cobertura) · WO-28 (colapso) · WO-29 (convergencia de clase y composiciones) · WO-30 (ensamblador) · WO-31 (arnés de pureza) · WO-32 (integración, en `slice/`) · WO-33 (métricas).

**No cubiertas, y a propósito:** WO-34 (Motor B offline de calibración) y la ampliación del alcance C1. Tres clases de estado y dos composiciones es la línea de corte declarada, por asignación de horas.
