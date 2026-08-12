# Agente de voz para seguimiento post-operatorio

**Un archivo. Sin compilar, sin dependencias, sin servidor.**

Abrir `index.html` → **Ajustes** → proveedor, clave y datos del paciente → **Guardar**. Ya está.

Requiere una credencial de Groq (gratuita) o, alternativamente, Gemini, OpenRouter u Ollama local.

---

## Qué hace

Llama al paciente operado hace pocos días, conversa con él en español colombiano sobre seis aspectos de su recuperación, **confirma lo que entendió antes de avanzar**, y al cerrar decide si el caso necesita a una persona del equipo — con sus razones y sus reglas a la vista.

**Con voz de punta a punta:** micrófono → transcripción → conversación → voz de salida. Si vuelve a pulsar el micrófono mientras el agente habla, se calla y le escucha.

---

## Cómo decide: dos votos, disyunción sin veto

| | Voto del modelo | Voto determinista |
|---|---|---|
| Quién | El modelo, que escuchó la llamada | Reglas sobre los valores ya normalizados |
| Qué aporta | Juicio ante lo ambiguo | Reproducibilidad término a término |
| Coste | Va en la misma llamada del turno de cierre | **Décimas de milisegundo**, en el navegador |

**Basta que uno vote por encima de verde para escalar. Ninguno veta al otro.**

La consistencia del sistema ante casos ambiguos no viene del modelo: viene del segundo voto. Y ese segundo voto **no lee el corpus ni el prompt** — lee un conjunto de reglas versionado. Un documento o una instrucción envenenada pueden mover el juicio del modelo; no pueden mover las reglas.

### La regla central

```
apetito muy disminuido  ∧  sueño muy alterado  ∧  fiebre ≥ 37,9
    → convergencia sistémica → ROJO
```

Sobre los 160 casos etiquetados del reto: **12 de 12 rojos, 0 falsos positivos, 0 falsos negativos.**

Ninguna variable sola discrimina — el día ≥7 arrastra 68 falsos positivos, la herida 30, el dolor 20. Solo su **composición** separa limpio.

### La banda amarilla no se resuelve, y es deliberado

La tabla de lectura **no separa el tramo dudoso**. Si lo hiciera, el voto del modelo sería redundante y el diseño de dos votos perdería su razón de ser. La ambigüedad es del problema; el sistema la refleja en vez de fingir que no existe.

---

## Cómo está hecho

**Todo el gobierno de la conversación vive en el prompt.** La cadencia, el tono, cuándo confirmar, cuándo insistir, qué no decir nunca — no hay máquina de estados ni capas de arbitraje. El modelo conduce, porque conversar es lo que hace bien.

**El código solo hace lo que un modelo no debe hacer:**

| Pieza | Qué es | Por qué en código |
|---|---|---|
| Reglas del dominio | Cortes, dos composiciones y tabla de lectura | Tiene que ser reproducible y auditable término a término |
| Ponderador | Disyunción sin veto | Tres líneas, y no puede depender de un juicio |
| Extracción | Bloque delimitado, no esquema JSON | No depende de que el proveedor soporte salida estructurada |
| Cobertura | Etiquetas que **solo informan** | No gobiernan lo que se pregunta |

**Una llamada al modelo por turno.** Con voz, dos: transcripción y respuesta. La voz de salida usa el sintetizador del sistema operativo — cero llamadas, cero descargas.

---

## Lo que el sistema nunca hace

**No inventa.** Si el paciente no lo dijo, el valor sale como `NO EVALUADA` y el resumen lo declara: *no se preguntó o no se obtuvo, no significa que esté bien.* La instrucción está en el prompt y el resumen la respeta.

**No traduce lo vago a un número.** *"Un calorcito"* no se convierte en 37,5 y *"una molestia"* no se convierte en un 2. El agente **pide el número**. Traducirlo sería fabricar precisión que el paciente no dio, en el campo que las reglas leen como si fuera medido.

**No diagnostica ni tranquiliza clínicamente.** Habla del proceso —quién lo va a contactar y cuándo—, nunca del cuadro. Sin umbrales, sin medicamentos, sin *"eso es normal"*.

**No se calla.** Toda llamada produce su resumen, incluidas las que terminan mal: urgencia, paciente que no puede seguir, o modelo caído.

---

## Urgencia

Si durante la conversación aparece sangrado abundante, dificultad para respirar, desmayo, dolor en el pecho o herida abierta de golpe, **la entrevista se corta**, se avisa al paciente de que su caso pasa a una persona ahora mismo, y el resumen sale marcado como cerrado por urgencia con la cobertura parcial declarada.

---

## Sin credencial

Arranca igual y recorre la llamada con una lista fija de preguntas, **y lo dice en pantalla**. Lo que no hay sin credencial es evaluación ni voz natural. Una demo que corre degradada y no lo avisa, miente.

---

## Límites declarados

1. **Procedencia `inferred`, sin validación de experto clínico.** El dominio, los cortes y la tabla se derivaron de los datos sintéticos del reto. **No sirven para ninguna finalidad clínica, diagnóstica ni asistencial.**
2. **La separación perfecta de la regla central es sospechosa.** Doce positivos, cero error: es más probable que recupere el generador del dataset que una verdad clínica.
3. **El techo de acierto lo fija la extracción, no las reglas.** Un paciente que llama *"calorcito"* a 38,9 hace que la regla, siendo correcta, decida sobre un dato falso. Por eso el agente pide el número en vez de estimarlo.
4. **Sesgo deliberado hacia la alerta.** Los costos son asimétricos: un caso escalado de más cuesta una llamada; uno escalado de menos cuesta un paciente.
5. **La transcripción depende de Groq.** Sin esa clave el micrófono no funciona, aunque el chat sí.

---

## Nada sale de su navegador

Salvo las llamadas al proveedor que usted configure. La clave y los datos viven en `localStorage`.
