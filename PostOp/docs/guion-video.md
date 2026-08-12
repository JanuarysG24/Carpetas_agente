# Guion del video — demo + preguntas de cierre

**Duración sugerida: 6–8 minutos.** El reto no fija un máximo, pero la rúbrica pesa fluidez y claridad, no extensión — mejor corto y sin relleno.

---

## Antes de grabar (checklist)

- [ ] `plantilla-chat-voz.html` abierto en el navegador, con la clave de Groq ya guardada (no grabar el paso de pegar la clave — no es parte de lo que evalúan).
- [ ] Un documento de prueba listo para subir a la consola de conocimiento — **uno que NO esté en el corpus de 107 documentos**, para que quede claro que el agente aprende algo nuevo en vivo. (Puede ser el mismo "Cuidado del drenaje quirúrgico Jackson-Pratt" usado en la evidencia del informe, u otro.)
- [ ] Micrófono probado, ambiente sin ruido.
- [ ] Editor o visor abierto en la función `PROMPT()` de `plantilla-chat-voz.html`, para el segmento donde se muestra el prompt.
- [ ] Pestaña **Métricas** limpia (sesión nueva) para que las cifras que se muestren sean de la corrida que se graba, no de una prueba anterior.

---

## 0:00 – 0:30 · Apertura

*Cámara o solo voz en off sobre la pantalla de bienvenida de la app.*

> Esto es Source Meridian: un agente de voz que llama a pacientes después de una cirugía, conversa con ellos en español colombiano sobre cómo va su recuperación, y decide con dos mecanismos independientes si el caso necesita que una persona del equipo clínico intervenga. Todo corre en un solo archivo HTML, sin servidor.

---

## 0:30 – 2:30 · Demo — consola de conocimiento (compuerta G5)

*Pantalla: pestaña 📚 Conocimiento.*

1. Mostrar la lista de documentos actual (sin el documento de prueba todavía).
2. Preguntarle al agente algo que **solo** el documento nuevo podría responder (en la pestaña Llamada) → debe decir que no está en su base de conocimiento.
3. Volver a Conocimiento, subir el documento de prueba (arrastrar o pegar texto) → mostrar la insignia **"✓ procesado y disponible"** apenas termina.
4. Volver a Llamada, hacer la misma pregunta → el agente ahora responde y cita el `doc_id` del documento nuevo.
5. Volver a Conocimiento, retirar el documento.
6. Repetir la pregunta una tercera vez → el agente vuelve a decir que no está en su base.

> La consola de conocimiento no es un panel de configuración aparte: es la misma base que usa el motor de búsqueda del agente. Subir un documento lo pone disponible de inmediato, sin reiniciar nada; retirarlo lo hace desaparecer igual de rápido. Y noten que en ningún momento el agente inventó una respuesta cuando no tenía la fuente — dijo explícitamente que no sabía.

---

## 2:30 – 5:00 · Demo — llamada de voz y decisión

*Pantalla: pestaña 📞 Llamada, conversación completa hablada (push-to-talk).*

Guion sugerido de lo que dice el "paciente" (puede ser el propio usuario hablando, con un caso que dispare rojo — fiebre alta + apetito muy disminuido + sueño muy alterado, para que se vea la escalada):

> — Buenas, ¿cómo se ha sentido desde la cirugía?
> — (paciente) Pues anoche me dio como calentura, me marcó 38 y algo...
> *(seguir la conversación completa hasta el cierre — el agente debe pedir número exacto si el paciente da algo ambiguo, confirmar lo entendido en sus palabras, y avanzar por los seis aspectos sin usar formulario ni listas)*

Al cierre de la llamada, mostrar la **tarjeta de veredicto** con los dos votos:

> Aquí están los dos votos por separado: el del modelo, que escuchó toda la conversación y da su lectura en lenguaje natural, y el del motor de reglas, que evalúa exactamente los mismos seis valores contra reglas clínicas fijas — fiebre sobre 37.9, apetito muy disminuido y sueño muy alterado juntos, por ejemplo, siempre da rojo, sin importar cómo lo redactó el modelo. Si cualquiera de los dos vota escalar, el caso escala. Ninguno de los dos puede vetar al otro.

*Pantalla: pestaña 📊 Métricas.*

> Y estas son las métricas de esta misma llamada: latencia entre que el paciente termina de hablar y el agente empieza a responder, tokens consumidos por turno, cuántas consultas RAG se hicieron, y el costo estimado — todo lo que pide la rúbrica para el README.

---

## 5:00 – 6:00 · El prompt (no omitir)

*Pantalla: función `PROMPT()` en `plantilla-chat-voz.html`, con scroll lento mientras se habla — no hace falta leerlo completo en voz alta.*

> Todo este comportamiento sale de un solo prompt de sistema, sin fine-tuning. Tres decisiones ahí que valen la pena señalar: primero, cuando el paciente da una cifra ambigua — "un calorcito", "me despierto varias veces" — la instrucción es pedir el número exacto, nunca estimarlo; es la salvaguarda contra que el modelo invente precisión clínica que el paciente no dio. Segundo, tiene prohibido tranquilizar clínicamente — nunca decir "eso no es nada" — porque eso puede hacer que alguien no consulte cuando debería. Y tercero, cualquier dato clínico que el agente afirme tiene que venir citado con el documento que lo respalda; si no hay fuente, dice que no sabe.

*(El prompt completo, verbatim, queda documentado en `docs/informe-final.md §3` — no hace falta transcribirlo en el video, solo mostrarlo en pantalla y señalar estos tres puntos.)*

---

## 6:00 – 7:00 · Pregunta 1 — ¿cómo se lo vendería a un cliente?

*Frente a cámara.*

> El problema: después de una cirugía, el seguimiento telefónico de rutina hoy lo hace personal de enfermería, con tiempo limitado y sin una forma sistemática de decidir cuándo un paciente necesita atención antes de la cita programada. Eso genera dos fallas opuestas: pacientes con complicaciones reales que no se detectan a tiempo, y personal saturado repitiendo llamadas de control a pacientes que van bien.
>
> Lo que construí llama al paciente, conversa en su idioma y su registro — no un formulario leído en voz alta — y decide con dos mecanismos independientes si el caso necesita a una persona: uno es el juicio del modelo escuchando la conversación completa; el otro son reglas clínicas declaradas y auditables, que no dependen de que el modelo se acuerde de aplicarlas bien. Basta que uno de los dos diga que hay que escalar para que se escale.
>
> El valor diferencial frente a un chatbot de síntomas genérico: cada respuesta clínica que da el agente está anclada a un documento real de la base de conocimiento, visible y auditable, y esa base se actualiza sin tocar código. No es una demo que "suena" médica; es un sistema donde se puede rastrear por qué dijo lo que dijo.

---

## 7:00 – 8:00 · Pregunta 2 — la decisión técnica más relevante

*Frente a cámara.*

> La decisión más relevante fue abandonar una arquitectura de capas separadas a mitad de la sesión y volver a un solo archivo sin servidor.
>
> La alternativa era un monorepo con cuatro paquetes TypeScript — contratos, capa conversacional, capa determinista, capa de decisión — con 334 pruebas automatizadas ya en verde, arquitectónicamente más cercana a un sistema de producción real. La descarté porque el enlace entre esos paquetes depende de symlinks de `npm install`, y en mi entorno de desarrollo, sincronizado por OneDrive, esos enlaces se corrompen al pasar de un sistema a otro — lo confirmé viendo el error en vivo. La compuerta de arranque en quince minutos no perdona una segunda oportunidad, así que apostar toda la entrega a que ese enlace sobreviviera en la máquina del jurado era un riesgo que no valía la pena correr.
>
> El riesgo que sí acepté: un solo archivo es más difícil de extender en equipo y no tiene la garantía de tipos en tiempo de compilación de la versión heredada. Con dos semanas más, no volvería al enlace por symlinks — empaquetaría el mismo diseño de contratos tipados en un solo build con Vite o esbuild, y agregaría streaming de audio continuo en vez de push-to-talk por turnos.

---

## Cierre

> Eso es Source Meridian. Gracias.
