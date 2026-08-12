# `@techsphere/decision` — capa de decisión

La **única autoridad de decisión** del sistema. Las otras tres capas preparan; ninguna decide. Esta define qué necesita saber, juzga cuándo alcanza, y emite el acto terminal: **alertar o no alertar al personal humano**, con razón, trazas y resumen.

> **La regla que ordena la capa entera: a la falla, actúa humano.** No existe ningún camino de código que termine sin `Decision`, ni ninguna sesión que termine sin `CallSummary`. Todo timeout es finito y su expiración produce **alerta**, no reintento indefinido. Un sistema de seguridad cuyo modo de fallo es el silencio no es un sistema de seguridad.

Esta capa **no re-tipa nada**: `ContextFrame`, `UnitResult`, `FrameVerdict`, `Decision`, `Vote`, `CallSummary` y los ocho puertos vienen de `@techsphere/contracts`. La capa **implementa** `DecisionPort`, no lo redefine.

## Estado

| WO | Qué cierra | Estado |
|---|---|---|
| **WO-36** | Guarda de G3 por ruta · adaptador de nube · estándar de ingesta · degradación segura de ADR-014 | ✅ |
| **WO-37** | Base de pacientes: dos vistas · proyección explícita hacia el marco · cierre por identidad no verificada | ✅ |
| **WO-38** | Almacén de fuentes: `retire` que archiva · historia que no se reescribe · registro con quién, qué y cuándo | ✅ |
| **WO-39** | Índice léxico BM25 detrás de `KnowledgePort` · semántica de caliente · estrategia registrada entera | ✅ |
| **WO-40** | **Consola de conocimiento — COMPUERTA 5** | ✅ |
| **WO-41…WO-44** | **El bucle de decisión: marco, suficiencia por predicado, tabla VD y ponderador OR** | ✅ |
| **WO-45 · WO-45b** | **Sesión anotada contra el modelo real · entrega a los dos destinos** | ✅ |
| **WO-47 §1** | **Modelo real enchufado en la ruta primaria** | ✅ |
| WO-46 | Métricas del reto | 🔲 |

```bash
npm run verify    # chequeo de tipos + las 166 pruebas
npm run demo:g5   # el ciclo de la compuerta 5, paso a paso
```

---

## La compuerta G3 vive aquí, y es la única que descalifica

G3 no despuntúa: **descalifica**, y se verifica *"contra tus dependencias, tu configuración y tu código"*. Las tres cosas están cubiertas por prueba, en ese orden, porque en ese orden las mira un auditor.

**Una guarda por ruta, no una sola** (ADR-021 §8c-bis.1). Validar un nombre de modelo es validarlo contra el catálogo de un proveedor concreto, y los catálogos no son intercambiables: una lista que mezclara nombres de Ollama con identificadores de nube aceptaría cualquier cosa de cualquiera de los dos mundos.

| Ruta | Modelo | Papel |
|---|---|---|
| `nube_groq` | `llama-3.3-70b-versatile` | **Primaria.** Sucesor de linaje de Llama 3.1 70B |
| `nube_google` | `gemini-3.5-flash` | Seguro del 5-sep. Conserva G4; requiere facturación |

**La ruta local se retiró por completo (ADR-025).** Se evaluó como respaldo, se midió, falló G4 en el turno que G4 examina y se retiró — los números siguen en `bench/` como la evidencia de que la decisión tuvo respaldo. Lo que la decidió: costaba `ollama pull` **dentro del reloj de G2**, y el requisito que decía proteger no existe, porque G2 dice literalmente *"≤15 min siguiendo el README, credenciales incluidas"*. La **estructura** de listas por ruta se conserva íntegra: es el arreglo de H16.

Tres reglas de auditoría, todas con prueba:

1. **Ningún SDK de proveedor.** Se habla HTTP plano con el `fetch` nativo. `npm ls` no encuentra `groq-sdk`, `openai`, `@google/generative-ai` ni `ollama`. Las dos dependencias de runtime son paquetes de este mismo repositorio —`@techsphere/contracts` y `@techsphere/deterministic`—; **de terceros, ninguna**, y hay prueba de que todas empiezan por `@techsphere/`.
2. **Una sola constante de modelo por ruta.** El identificador no aparece en el código fuera de `src/modelo/rutas.ts` — la prueba ignora comentarios a propósito: lo que no puede repetirse es la constante, no la explicación.
3. **Ningún adaptador arranca si su modelo no está en su lista.** El fallo es al levantar el proceso, no al primer turno: un sistema que descubre en producción que usa un modelo no permitido ya falló la compuerta. Y la guarda corre **antes** que la credencial — un proceso mal configurado no debe llegar a quejarse de que le falta la clave.

El modo de fallo que esto cierra ya ocurrió (H16): al migrar de local a nube quedó protegida solo la ruta local. La salvaguarda existía, se veía en el código, y cubría justo la ruta que menos importa.

## La garantía de esquema la da el validador, no el decodificador

`llama-3.3-70b-versatile` **no admite `json_schema`**, solo `json_object` (corrección B2): JSON válido garantizado, conformidad con el esquema no. La promesa de ADR-017 —*"imposible por construcción, no improbable por prompt"*— no se cumple con el decodificador en la ruta primaria, así que sube una capa:

> de **"el decodificador no puede emitir inválido"** a **"el sistema no puede aceptar inválido"**.

1. Toda salida estructurada cruza el validador del módulo de contratos.
2. Una salida que no valida se reintenta de forma **acotada**, con el error de esquema encima.
3. Agotados los reintentos se lanza `ErrorDeSalidaNoValidable` y el llamador degrada por ADR-014. **La incapacidad de producir salida válida es un resultado declarado, no una excepción** — misma filosofía que ADR-009, donde la no evaluabilidad es resultado y no vacío.

Es más fuerte que la versión original porque **no depende del proveedor**. Verificable inyectando respuestas malformadas: JSON disconforme, texto que no es JSON y respuestas truncadas por techo de tokens (que se nombran *truncamiento*, no *JSON inválido* — culpar al modelo de eso es culparlo de algo que es del decodificador, H7). El sistema nunca las incorpora.

El prompt se arma con **prefijo estable primero y cola volátil al final** (ADR-023), y el adaptador lo impone por firma: no hay dónde interpolar un `session_id` arriba. En local vale 6–8× de prefill; en Groq **no cambia los tokens de entrada** (B6), así que abarata el precio de esa porción pero no relaja el techo de 12 000 TPM.

`temperature: 0` en el rol `decider`, y no en `interviewer`. Pero conviene ser exacto: **temperatura cero no produce determinismo** en un modelo hospedado. La consistencia del sistema viene del VD —tabla declarada, idéntica ante el mismo caso— y de la disyunción sin veto.

## Estándar de ingesta: un documento vacío se rechaza con su razón

El contrato ya exige metadatos y prohíbe datos de paciente **por esquema** (ADR-011). Lo que esta capa añade es lo único que el contrato no puede saber solo: **si el cuerpo trae texto**.

El caso, con nombre y apellido: *el jurado prueba la compuerta 5 subiendo un documento suyo*. Si resulta ser un escaneo, la consola tiene que **decirlo en ese momento**. Un documento que se acepta y no aporta nada es peor que uno rechazado con su razón, porque después alguien pregunta por su contenido y el agente no sabe por qué no lo tiene.

La salida es el **sidecar** (`docs/corpus-texto/README.md`): un `.txt` con la misma ruta relativa que el PDF tiene prioridad sobre él, se genera **fuera de línea**, y el `doc_id` y la cita siguen apuntando al original — el texto es derivado, igual que el índice (ADR-015). Mismo criterio que el índice preconstruido: **el reloj de la compuerta 2 no debe ver ningún trabajo que se pueda hacer antes.** OCR en el arranque costaría minutos por documento; así cuesta cero.

Los umbrales salen de medir el corpus real con dos extractores, no de intuición, y el sesgo está puesto hacia **aceptar**:

| Densidad | Qué es | Qué hace la consola |
|---|---|---|
| < 40 car./pág. | Sin capa de texto | **Rechaza**, y dice dónde va su sidecar |
| 40–800 car./pág. | Texto real, poco: guías visuales para pacientes | **Ingiere** y avisa |
| > 800 car./pág. | Normal | Ingiere |

La franja del medio importa más de lo que parece: tres de los cuatro documentos de densidad baja del corpus son **planes de cuidado post-operatorio dirigidos al paciente**, que es el material más pertinente que hay para este agente. Excluirlos por una cifra no verificada habría quitado lo mejor.

## La degradación segura de ADR-014, como función pura

`leerMarco(frame, units)` lee el marco hidratado contra el marco pedido y dice qué falta y por qué. `decisionPorDegradacion` y `decisionPorContextoIncompleto` construyen la `Decision` de las ramas de ADR-014 con las invariantes **en el cuerpo y no en el llamador** —`escalate: true`, `context_complete: false`, `reason` no vacío—, validada contra el contrato antes de devolverla.

**ADR-022 — el atajo existe solo hacia `need_more`, jamás hacia `sufficient`.** Este módulo no exporta ninguna función que diga "suficiente", y la ausencia es normativa: completitud estructural no es suficiencia clínica, y un predicado que pudiera cerrar el bucle sería una regla estructural decidiendo un asunto clínico. Un marco completo **se consulta** al modelo, que puede pedir más igual.

### La prueba que había que fijar antes de que el andamio desapareciera

Un marco cuyas unidades llegan `hidratada_sin_normalizar` produce **siempre** `contexto_incompleto` con `escalate: true`. Se prueba como **propiedad sobre 300 combinaciones** de `state`, `confidence`, `raw` y `coverage_met`: no interesa que un camino funcione, interesa que **no exista ninguna combinación de calidad de extracción que abra un camino al silencio**.

Verifica la propiedad de seguridad de ADR-014 **con independencia de la calidad de la extracción**, que es justo lo que ningún test posterior podrá aislar tan limpio: cuando la conversacional extraiga de verdad, este caso dejará de ser el 100 % de las corridas y habrá que fabricarlo a mano. Es una garantía que hoy se tiene gratis y que mañana costaría construir.

## La base de pacientes: dos vistas, y una proyección que no se puede saltar

`verifyIdentity` y `getCase` viven en **módulos distintos**, y el que expone la primera no importa al segundo. La conversacional no puede filtrar lo que no recibe: el veredicto son un enum y una referencia **opaca** —token declarado, no hash del nombre, porque un identificador reversible por diccionario divulga lo mismo que la referencia promete no divulgar y encima parece seguro—.

Un detalle que parece de forma y es de fondo: **nombre real con verificador equivocado devuelve `no_encontrado`**, no `ambiguo`. Distinguir esos dos casos confirmaría que el nombre sí está en la base, y convertiría la verificación en un oráculo de pertenencia con el que se sondea la base un nombre a la vez.

### Lo que cruza hacia el marco es una proyección, no el caso

ADR-019 le prohíbe al entrevistador el contexto recuperado y ADR-020 le manda hablar del **proceso**, no del **cuadro**. Si el `PatientCase` entrara entero al `ContextFrame`, esa prohibición quedaría burlada por la puerta de al lado: el modelo no vería el RAG, pero vería la historia del paciente, **que es peor**.

Al marco cruzan tres cosas y ninguna más: **`patient_ref`** opaca, **`unit_ids`** a cubrir y **`dia_postop`**, que llega hasta la determinista por el marco y no por el prompt. Nada de diagnóstico, procedimiento ni antecedentes.

La selección es una función declarada en `casos.ts`, no "lo que el orquestador toma", y la diferencia se ve el día en que alguien añade un campo al caso: con la proyección explícita el campo nuevo no aparece hasta que alguien lo agregue a mano y explique por qué. **Hay una prueba de exactamente eso** — se le añaden al caso un diagnóstico oncológico y una nota de enfermería, y no llegan al marco.

`dia_postop` se emite **tal cual**: el dominio declara `[1, 3, 7, 14]` y un día 6 pierde el tramo con *warning* declarado, sin alterar ninguna regla (hoy ningún corte ni composición está condicionado por él). Mapearlo al valor declarado más cercano sería decidir que un día 6 es "temprano" o "tardío", y eso es criterio clínico que esta capa no escribe.

## Una llamada que muere en la identidad sigue debiendo un resumen

Es ADR-016 y es el borde que nadie prueba. Si el orquestador cortara antes de crear sesión no habría resumen, y **una llamada que no dejó rastro es indistinguible de una llamada que nunca ocurrió** — justo lo que ADR-009 prohíbe en la otra capa: la no evaluabilidad es un resultado, no un vacío.

`cierrePorIdentidadNoVerificada` produce `Decision` + `CallSummary` validados: escala con `contexto_incompleto`, `findings` vacío y `rounds: 0` —que juntos cuentan que no es que no se hallara nada, es que no se llegó a preguntar—, y va a los dos destinos. **No es un caso de error, es un desenlace**, y de los que más le importan a quien opera el sistema: alguien contestó ese teléfono y no pudo demostrar quién era, y eso puede ser confusión, sedación o mal estado.

No sustituye al camino de `identity: unverified` con marco genérico (WO-42), que es para la llamada que sigue adelante. El tratamiento **clínico** de la identidad no verificada sigue siendo del director (WO-47 §7); esto fija la plomería.

## El almacén de fuentes: el documento es la verdad, el índice es derivado

**`retire` archiva, no borra.** Es ADR-004 aplicado al conocimiento: la traza de una `Decision` de hace un mes tiene que resolver su `doc_id` aunque el documento ya no esté vigente. Un `doc_ids` que no resuelve es **peor** que una traza vacía, porque parece auditable y no lo es. Por eso hay dos operaciones distintas: `vigente(doc_id)` devuelve `null` si se retiró, y `resolver(doc_id)` devuelve el archivado.

**La historia no se reescribe.** Un `doc_id` vigente no se puede sobrescribir: una corrección es *retirar e ingerir versión nueva*, y eso crea la revisión 2 dejando la 1 intacta con su fecha de retiro. Así la revisión que sustentó una decisión sigue existiendo tal como era cuando la sustentó.

**El estándar se aplica en la ingesta**, no antes ni a mano: un documento sin capa de texto se rechaza nombrando la razón y la ruta de su sidecar, uno con datos de paciente se rechaza por ADR-011, y uno de densidad baja entra con el aviso **anotado en el registro** — el operador tiene que verlo dicho.

El chunking por defecto depende del `kind` (sección para protocolos y procedimientos, párrafo para cuidados y complicaciones), pero **el techo es uniforme y bajo**: 150 tokens. No es un parámetro de calidad de recuperación, es el presupuesto de latencia de la sesión. Medido (H9): dos chunks de 2000 caracteres son 1474 tokens de prompt y **72 s de prefill**; bajar el techo llevó la sesión completa de 104 s a 43 s sin tocar nada más.

El registro lleva **quién, qué y cuándo** de cada operación. No es contabilidad: una decisión solo es auditable si se sabe qué conocimiento estaba vigente cuando se tomó.

## El índice: léxico hoy, y el puerto es el que lo hace reversible

Recuperación **BM25 sobre índice invertido**, con normalización mínima para español —minúsculas, sin tildes, sin palabras vacías, sin *stemmer*— detrás del mismo `KnowledgePort.retrieve` que ya estaba en contratos. **La firma no cambia.**

Por qué léxico: **quien consulta no es el paciente con habla libre, es el decisor con el vocabulario canónico del dominio** (ADR-019). La brecha semántica que justifica los embeddings se abre cuando la consulta y el documento usan palabras distintas para lo mismo, y aquí el que pregunta ya habla el idioma del corpus. Contra guías clínicas y con esas consultas, lo léxico rinde.

Y si mañana no rindiera, la mejora vectorial entra **detrás del mismo puerto sin tocar a ningún consumidor** — que es la arquitectura haciendo exactamente el trabajo para el que se diseñó, y va al informe como tal.

**Nunca resultados silenciosamente incomparables.** Lo que se registra no es "el modelo" sino la **estrategia completa**: familia, parámetros y normalización, todo en un descriptor —`lexical-bm25/k1=1.2/b=0.75/es-minusculas-sin-tildes-sin-vacias-v1`—. Dos índices con la misma familia y distinta normalización producen puntajes que no son comparables, así que consultar esperando otro descriptor **falla explícito** en vez de devolver evidencia que parece buena y no lo es. Es la misma disciplina que protegerá el salto a vectorial, donde lo que habrá que registrar son modelo, cuantización y convención de prefijos.

El techo de chunk subió de 150 a 350 tokens: H9 lo había fijado por prefill de la ruta local, que ya no existe (ADR-025), y sin ventana de modelo de embedding no hay nada que trunque en silencio. Lo que sigue acotándolo es el techo de **12 000 TPM** de la ruta primaria, porque cada chunk recuperado viaja en el prompt del decisor — un presupuesto un orden de magnitud más holgado que el anterior.

## El corpus real, y el hallazgo que lo hacía inútil

Los 107 documentos del reto están **extraídos fuera de línea y versionados** en `decision/corpus/` (5,7 MB). `MaterialReto/` no se versiona, así que ese texto derivado es lo que hace el repositorio **autocontenido**: el jurado clona y tiene el corpus. Y la carga cuesta **180 ms** frente a los minutos que cuesta extraer 107 PDF — el reloj de G2 no ve trabajo que se pueda hacer antes.

**107 ingeridos, 0 rechazados.** El cero no significa que el estándar no muerda: el único PDF sin capa de texto del corpus tiene sidecar y por eso entra. Como ese camino quedaba sin ejercitar contra nada real, hay un PDF sin texto en `test/fixtures/` y la demo lo pasa por la ingesta.

### El troceo era el cuello, no la estrategia de recuperación

Primera medición sobre el corpus real: **mediana de fragmento 31 caracteres**, 70 % por debajo de 100. No eran párrafos cortos — eran encabezados, viñetas, números de página y líneas de índice, porque `pdftotext` deja una línea en blanco por todas partes.

Con BM25 eso no es solo inútil, es **activamente dañino**: la normalización por longitud premia al fragmento corto que contiene el término, así que a la consulta `dehiscencia` le ganaba *"• Los cuidados con la herida quirúrgica"* y a `signos_alarma` le ganaba *"• Signos de alarma"*. **La consulta parecía funcionar y devolvía un título.**

> **Y lo vectorial no lo habría salvado.** El vector de un encabezado de tres palabras es tan pobre como su bolsa de palabras. Era troceo, no estrategia — conviene comprobarlo antes de gastar §8c-bis.4 en el problema equivocado.

Piso de fragmento en 500 caracteres (los bloques se acumulan, y el encabezado queda pegado al texto que encabeza) y tablas y pies de figura fuera **antes** de fusionar. Mediana: **~890 caracteres**.

### El piso de relevancia es por cobertura, no por puntaje

El primer intento fue un umbral absoluto de BM25 y estaba mal: **el puntaje no está normalizado** y escala con el corpus, así que el valor calibrado sobre 6 176 fragmentos dejaba el corpus semilla de 4 devolviendo siempre vacío, y se habría descalibrado solo al crecer. Un umbral que hay que recalibrar es un umbral que algún día no se recalibra.

Lo que sí es libre de escala es **cuánta de la pregunta contesta el fragmento**: la fracción de términos distintos de la consulta que casa. Por debajo, `retrieve` devuelve **vacío** — devolver el mejor de un mal lote es fabricar respaldo, y el decisor lo citaría con su `doc_id`. Es ADR-024 en la capa de recuperación.

Y lo que no se pudo citar **se declara**: `CallSummary.evidence_gaps`, espejo exacto de `coverage.no_evaluadas`. Un sistema que declara sobre qué no pudo citar es más fuerte que uno que cita cualquier cosa.

## La consola: COMPUERTA 5

```bash
npm run demo:g5
```

El guion completo, en un solo proceso y sin reiniciar nada: se siembra el corpus · el decisor consulta y **no** encuentra lo que aún no existe · se ingiere un documento nuevo · **la misma consulta lo encuentra** · se retira · **la misma consulta deja de encontrarlo** · y la traza histórica **sigue resolviendo** su `doc_id`. Termina rechazando un escaneo con la ruta de su sidecar y mostrando el registro. La transcripción está en [`docs/evidencia-decision/demo-consola-g5.txt`](../docs/evidencia-decision/demo-consola-g5.txt).

La demo **falla con código de salida 1** si cualquiera de las cuatro afirmaciones no se cumple: no es un guion que imprime lo que uno quiere leer.

La consola es la **superficie del puerto**, no un producto aparte: `ingest`, `retire`, `list`, `reindex`, `status` y nada más. Toda operación queda en el registro con quién, qué y cuándo, porque una decisión solo es auditable si se sabe qué conocimiento estaba vigente cuando se tomó.

Y la ayuda **declara la asimetría** donde el operador podría esperar lo contrario: el conocimiento se actualiza en caliente; **la taxonomía determinista no** — esa cambia solo por versión (ADR-010). Son dos garantías distintas y el sitio para decirlo es donde alguien va a operar.

## El bucle de decisión

**El marco se genera, no se escribe** (ADR-012). `buildFrame` toma la proyección del caso —referencia opaca, unidades y `dia_postop`— y monta las seis unidades del dominio con el léxico destilado de 948 turnos reales, respetando sus tres categorías: `synonyms` produce `normalized`, `requires_precision` lo deja en `null` con el `raw` intacto y dispara reflejo, y los atenuadores **no entran en ninguna unidad** porque modulan `confidence`, que es campo de otra capa.

**El marco no lleva red flags, y no es un pendiente: es una decisión.** Un umbral clínico en el marco del entrevistador viola ADR-020 —el agente habla del proceso, no del cuadro— y ADR-019. El escalamiento lo producen los dos votos.

**La suficiencia se decide por predicado** (ADR-022). Una `required` sin cerrar produce `need_more` **sin llamar al modelo** y **nombrando la unidad que faltaba** — el `frame_delta` deja de ser una inferencia sobre qué repreguntar y pasa a ser consecuencia directa del estado. El atajo existe solo hacia `need_more`: hay una prueba de que este paquete no exporta nada que declare suficiencia.

**El VD es la tabla del dominio**, `referencia_tabla_vd`, que discrimina por **clase presente**. No la del andamio, que leía `integridad.lectura === "comprometida"` — verificado contra el dataset, eso también es cierto en el caso amarillo, así que habría pintado de rojo casi todo. Y **no mira `dia_postop`**: meterlo separaría la banda amarilla, y si el VD resolviera lo dudoso el voto probabilístico sobraría.

**El ponderador no tiene ni un parámetro**, y esa es la garantía: un ponderador configurable es uno que alguien puede apagar. La ausencia de veto se prueba por exhaución sobre las dos entradas. La criticidad no se pondera: se registra la más grave, y eso no cambia la acción.

**Antes del silencio, la cobertura.** Si los dos votos callan pero una `required` no se evaluó, el caso es incompletud y no silencio: el falso negativo por omisión queda bloqueado por regla, no por criterio.

**Ningún camino termina sin `Decision`, y ninguna sesión sin `CallSummary`.** Los cuatro cierres —tabla OR, degradación, urgencia y falla— pasan por el mismo sitio, y el resumen se **destila del ledger**: el modelo no es fuente de ningún campo estructurado.

## El enchufe del modelo real, y si la forma aguantó

Se escribió una predicción falsable —*"si enchufar el modelo exige tocar el ponderador o los puertos, la forma estaba mal"*— y se comprobó contra la ruta primaria con credencial real:

| Pieza | Hubo que tocarla |
|---|---|
| Ponderador · tabla VD · puertos · ensamblador · orquestador | **Nada** |
| Cableado | La línea `motor:` |

Caso rojo: VP rojo + VD-01 por `CO-02` → escala. Caso verde: VP verde + VD-05 **sin una sola regla disparada** → no escala. Sesión completa en **1,2–1,3 s** de reloj de pared, contra los 34–43 s de la ruta local retirada — el número que respalda ADR-025.

Y el caso verde real es la demostración de por qué había que corregir el contrato: llegó con `rules_fired` vacío, que es exactamente lo que la regla vieja declaraba inválido. Lo que la reemplaza no mira los hallazgos sino **si se miró**: bajo `evaluado`, lo que no puede estar vacío son las unidades evaluadas. *"Miré seis y todas estaban bien"* es un resultado; *"miré cero"* es un fallo.

```bash
GROQ_API_KEY=... node scripts/enchufe-nube.mjs
```

## La sesión anotada y la entrega

[`docs/evidencia-decision/sesion-anotada.md`](../docs/evidencia-decision/sesion-anotada.md) es **material de entrega**, no salida de prueba: los tres cierres del sistema —tabla OR, degradación y urgencia— uno detrás de otro, contra el modelo real y el corpus real, con la cadena de evidencia completa en cada uno.

> enunciado literal → unidad (`UnitResult`) → regla del reporte (`rule_id`) → regla de lectura (`vd_rule`) → `Decision.traces` → `CallSummary` → destinos

Se destila del **ledger**, recogido mientras la sesión ocurría. Nada se reconstruye al final.

Un detalle que el artefacto capturó y que no estaba guionizado: **el caso rojo costó dos rondas**. El predicado dio el marco por estructuralmente completo y fue el **modelo** el que pidió reabrir — exactamente el desempate que ADR-022 le reserva. Es la evidencia de que el agente indaga antes de decidir, y no la escribimos: ocurrió.

**La entrega** aplica la política de destinos: el archivo **siempre** y **primero** —una alerta sin caso que la sustente es peor que una alerta tardía—, el canal solo cuando escala, y con el caso completo en vez de un timbre. Si el canal se cae, el resumen persiste y **la falla queda escrita**: un fallo de entrega sin rastro es indistinguible de una entrega que nunca hizo falta.

```bash
GROQ_API_KEY=... node scripts/sesion-anotada.mjs
```

## Órdenes de trabajo cubiertas

WO-36 (contratos y puertos, con el binding y su guarda cableados dentro en vez de al final: es la compuerta que descalifica) · WO-37 (base de pacientes, con la proyección hacia el marco y el desenlace de identidad) · WO-38 (almacén de fuentes y estándar de ingesta) · WO-39 (índice léxico) · WO-40 (consola — compuerta 5) · WO-41 (marcos) · WO-42 (bucle) · WO-43 (tabla VD) · WO-44 (ponderador) · WO-45 (sesión anotada) · WO-45b (entrega) · WO-47 §1 (binding real).
