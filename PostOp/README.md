# Source Meridian — Agente de voz para seguimiento post-operatorio

**Tech Sphere Challenge 2026 — Voice Agent Edition**

**Un solo archivo HTML. Cero dependencias, cero instalación, cero servidor.**

---

## ▶ Arranque rápido (compuerta G2: ≤ 15 minutos)

1. Descargue o clone este repositorio.
2. Abra `plantilla-chat-voz.html` con doble clic (o arrástrelo a Chrome/Edge). No hace falta `npm install`, no hay build, no hay backend que levantar.
3. Al abrir, si no hay clave guardada, se abre solo el panel **Ajustes**.
4. Pegue una credencial de **Groq** (gratuita en [console.groq.com](https://console.groq.com/keys) → API Keys → Create API Key — cópiela en el momento, solo se muestra una vez) y presione **Guardar**.
5. Empieza la llamada automáticamente con el saludo del agente.

**Eso es todo. Tiempo real de arranque: bajo 1 minuto**, porque no hay nada que compilar ni ningún servidor que iniciar — la aplicación corre entera en el navegador y llama a la API de Groq directamente por `fetch`.

No se necesita Docker, Node, Python, ni ninguna base de datos. El corpus clínico (107 documentos, ~6.000 fragmentos indexados con BM25) viene **preconstruido y embebido** en el propio HTML: no hay indexación al arrancar.

---

## Las dos superficies exigidas por el reto

La aplicación es **una sola página con tres pestañas**; dos de ellas son las superficies obligatorias:

| Pestaña | Superficie | Contrato funcional |
|---|---|---|
| 📞 **Llamada** | Interfaz de llamada | Inicia la llamada de voz al abrir (o con "Nueva llamada") · mantener presionado para hablar (micrófono) · el agente contesta con voz |
| 📚 **Conocimiento** | Consola de administración | Subir documento (archivo `.txt`/`.md` o texto pegado) · lista de documentos cargados con indicador **"✓ procesado y disponible"** · botón **Retirar** por documento |
| 📊 **Métricas** | (adicional, no exigida) | Latencia, tokens y costo estimado por turno — ver [§ Métricas](#métricas-obligatorias-para-el-readme) |

**Aprende y olvida en caliente, en la misma sesión, sin recargar nada:** suba un documento nuevo en *Conocimiento* y pregúntele al agente algo que solo ese documento sostenga — lo va a citar. Retírelo, pregunte lo mismo — el agente declara que no está en su base y lo remite al equipo.

---

## Modelo usado, y por qué (compuerta G3)

**`llama-3.3-70b-versatile`, servido por Groq Cloud, nivel gratuito.**

Pertenece a la familia **Meta Llama vía Groq**, una de las cuatro familias permitidas en [`stack-tecnico.md`](../ParticipantArtifacts/docs/stack-tecnico.md#1-los-modelos-permitidos) del reto.

Por qué esta y no otra de las permitidas:

- **Latencia.** Las LPU de Groq entregan tokens casi al instante — la métrica que más pesa en la rúbrica de calidad de voz es justo la que este proveedor optimiza mejor entre las opciones permitidas.
- **Una sola clave para modelo y voz.** La misma credencial de Groq sirve para el chat completions (razonamiento del entrevistador y del decisor) y para **Whisper `large-v3-turbo`** (transcripción de voz a texto). Menos superficie de configuración, menos que se pueda romper en la demo.
- **Calidad de español conversacional** suficiente para el registro coloquial colombiano que pide el reto, sin necesitar ventana de contexto extendida (las consultas del RAG están acotadas a 2–3 fragmentos por turno).
- Se descartó Gemini Flash por preferir mantener modelo y voz bajo un único proveedor para esta iteración (ver informe final, Pregunta 2, para la discusión completa de alternativas).

El nombre exacto del modelo vive en una sola constante dentro del archivo (`DEF.groq` en el bloque *Configuración* del `<script>`), y el proveedor/modelo activo se guardan en `localStorage` — visibles y editables desde Ajustes, nunca ocultos.

---

## Cómo decide: dos votos, disyunción sin veto

| | Voto del modelo (VP) | Voto determinista (VD) |
|---|---|---|
| Quién | El modelo, que escuchó la llamada | Reglas declaradas sobre los valores ya normalizados |
| Qué aporta | Juicio ante lo ambiguo | Reproducibilidad término a término, auditable |
| Costo | Va en la misma llamada del turno de cierre | Milisegundos, en el navegador, sin red |

**Basta que uno vote por encima de verde para escalar. Ninguno veta al otro.**

La consistencia del sistema ante casos ambiguos no viene del modelo: viene del segundo voto. Y ese segundo voto **no lee el corpus ni el prompt** — lee un conjunto de reglas versionado (`votoDeterminista`, `ponderar` en el código). Un documento o una instrucción envenenada pueden mover el juicio del modelo; no pueden mover las reglas.

### La regla central

```
apetito muy disminuido  ∧  sueño muy alterado  ∧  fiebre ≥ 37,9
    → convergencia sistémica → ROJO
```

Sobre los 160 casos etiquetados del reto: **12 de 12 rojos, 0 falsos positivos, 0 falsos negativos** (medido contra `trayectorias_postop_silver.xlsx`). Ninguna variable sola discrimina limpio — solo su **composición**.

Diagrama completo del flujo de decisión: [`docs/diagrama-arquitectura.md`](docs/diagrama-arquitectura.md).

---

## Trazabilidad clínica

Cada vez que el agente responde algo con respaldo del corpus, cita el `doc_id` del fragmento que usó (`[doc_id]` inline). Esa cita:

- Se **muestra** en la transcripción de la pestaña Llamada.
- Se **omite** de la voz (el texto que se lee en voz alta le quita las marcas — nadie quiere oír un identificador de documento por teléfono).
- Queda registrada en `registro[]` y aparece en el resumen de cierre bajo "Documentos consultados".

Si la pregunta del paciente no tiene respaldo en el corpus vigente, el agente lo declara ("no está en mi base de conocimiento") en vez de improvisar — es una instrucción explícita del prompt, no un límite técnico.

---

## Resumen estructurado de cada llamada

Al cerrar (el modelo produce el bloque `---RESUMEN_INICIO---`), la aplicación arma y muestra una tarjeta con: criticidad (verde/amarillo/rojo), si escala o no, el voto de cada mecanismo y su razón, la tabla de los seis aspectos con su valor y clase, las reglas disparadas, los documentos consultados, y un botón para descargar el resumen en texto plano. **Ninguna llamada termina sin este resumen** — ni las que cierran por urgencia, ni las que el paciente no puede continuar.

---

## Métricas obligatorias para el README

La pestaña **📊 Métricas** las calcula en vivo, turno a turno, dentro de la propia sesión del navegador:

| Métrica | Cómo se mide |
|---|---|
| Latencia P50 / P95 | Desde que se suelta el botón de hablar (fin de habla del paciente) hasta que **empieza a sonar** el audio del agente (`SpeechSynthesisUtterance.onstart`) |
| Tokens de entrada / salida | `usage.prompt_tokens` / `usage.completion_tokens` de la respuesta de Groq, por turno |
| Invocaciones al modelo | 1 por turno (una sola llamada de chat completions por turno, más 1 de Whisper para la transcripción) |
| Consultas al RAG por llamada | 1 consulta BM25 por turno con modelo configurado |
| Costo estimado | `tokens × precio publicado de Groq para llama-3.3-70b-versatile` (US$0.59 / 1M entrada, US$0.79 / 1M salida — verificar contra [console.groq.com/settings/billing](https://console.groq.com/settings/billing) al momento de la entrega). Whisper `large-v3-turbo` se cobra aparte, por minuto de audio. |

> **Cifras reales de una sesión de prueba:** completar aquí después de correr una llamada de punta a punta y leer la pestaña Métricas.
>
> | Latencia P50 | Latencia P95 | Tokens/turno (prom.) | Consultas RAG/llamada | Costo estimado/llamada |
> |---|---|---|---|---|
> | — ms | — ms | — | — | US$ — |

---

## Cómo está hecho

**Todo el gobierno de la conversación vive en el prompt.** La cadencia, el tono, cuándo confirmar, cuándo insistir, qué no decir nunca — no hay máquina de estados ni capas de arbitraje. El modelo conduce, porque conversar es lo que hace bien.

**El código solo hace lo que un modelo no debe hacer:**

| Pieza | Qué es | Por qué en código |
|---|---|---|
| Reglas del dominio | Cortes, dos composiciones y tabla de lectura | Tiene que ser reproducible y auditable término a término |
| Ponderador | Disyunción sin veto | Tres líneas, y no puede depender de un juicio |
| Recuperación (RAG) | BM25 sobre índice invertido, sin dependencias externas | No necesita servidor de vectores ni descargar un modelo de embeddings |
| Extracción | Bloque delimitado, no esquema JSON | No depende de que el proveedor soporte salida estructurada |

**Una llamada al modelo por turno.** Con voz, dos: transcripción (Whisper) y respuesta (chat completions). La voz de salida usa el sintetizador del sistema operativo — cero llamadas adicionales, cero descargas.

---

## Lo que el sistema nunca hace

**No inventa.** Si el paciente no lo dijo, el valor sale como `NO EVALUADA` y el resumen lo declara: *no se preguntó o no se obtuvo, no significa que esté bien.*

**No traduce lo vago a un número.** *"Un calorcito"* no se convierte en 37,5 y *"una molestia"* no se convierte en un 2. El agente **pide el número**.

**No diagnostica ni tranquiliza clínicamente.** Habla del proceso —quién lo va a contactar y cuándo—, nunca del cuadro. Sin umbrales, sin medicamentos, sin *"eso es normal"*.

**No se calla.** Toda llamada produce su resumen, incluidas las que terminan mal: urgencia, paciente que no puede seguir, o modelo caído.

---

## Urgencia

Si durante la conversación aparece sangrado abundante, dificultad para respirar, desmayo, dolor en el pecho o herida abierta de golpe, **la entrevista se corta**, se avisa al paciente de que su caso pasa a una persona ahora mismo, y el resumen sale marcado como cerrado por urgencia con la cobertura parcial declarada.

---

## Dependencias

**Ninguna.** No hay `package.json`, no hay `node_modules`. La aplicación es HTML + CSS + JavaScript vanilla en un solo archivo, con dos únicas llamadas de red en tiempo de ejecución (ambas a `api.groq.com`, con la clave que usted pega en Ajustes):

- `POST /openai/v1/audio/transcriptions` (Whisper)
- `POST /openai/v1/chat/completions` (Llama 3.3 70B)

La única carga externa es tipográfica (Google Fonts, `Sora` y `Playfair Display`) — si no hay red para eso, el navegador cae a la fuente del sistema y la aplicación sigue funcionando igual.

---

## Límites declarados

1. **Procedencia `inferred`, sin validación de experto clínico.** El dominio, los cortes y la tabla se derivaron de los datos sintéticos del reto. **No sirven para ninguna finalidad clínica, diagnóstica ni asistencial.**
2. **El techo de acierto lo fija la extracción, no las reglas.** Un paciente que llama *"calorcito"* a 38,9 hace que la regla, siendo correcta, decida sobre un dato falso. Por eso el agente pide el número en vez de estimarlo.
3. **Sesgo deliberado hacia la alerta.** Los costos son asimétricos: un caso escalado de más cuesta una llamada; uno escalado de menos cuesta un paciente.
4. **La transcripción y la síntesis dependen del navegador y de Groq.** Sin la clave, el micrófono no funciona. Recomendado: Chrome o Edge, por mejor soporte de `MediaRecorder` y voces en español del sistema.
5. **Sin credencial**, la aplicación abre igual el panel de Ajustes y lo dice en pantalla — no hay una demo degradada que finja funcionar.

---

## Nada sale de su navegador

Salvo las dos llamadas a Groq ya declaradas arriba. La clave, los datos del paciente y el conocimiento subido en la consola viven en memoria/`localStorage` de esa pestaña — nada se envía a ningún servidor propio, porque no hay servidor propio.

---

## Estructura de este directorio

```
PostOp/
├── plantilla-chat-voz.html   ← LA aplicación. Ábrala y ya.
├── README.md                 ← este archivo
├── docs/
│   ├── diagrama-arquitectura.md
│   └── informe-final.md
├── index.html                 (versión anterior, sin consola de conocimiento — no es la entrega)
└── corpus.json                (corpus fuente sin empaquetar, referencia)
```

Más contexto de proceso y arquitectura extendida (capas separadas con contratos tipados, especificaciones ADR, 334 pruebas automatizadas) en [`../Rescate/Herencia/`](../Rescate/Herencia/README.md) — esa vía quedó como base de diseño y evidencia de proceso; la entrega funcional para las cinco compuertas es este archivo, por su cero fricción de instalación bajo el reloj de la compuerta G2.
