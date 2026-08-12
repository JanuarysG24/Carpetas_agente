# Interfaz de prueba — solo la capa conversacional, voz a voz

Herramienta mínima para conversar **de voz a voz** con el agente entrevistador — sin decisión, sin RAG y sin escalamiento — tal como se pidió: solo verificar que la conversación entre paciente y agente funciona bien antes de meterle lo demás.

- **Voz → texto:** Whisper `large-v3` en Groq (misma API key, misma ruta de nube que el entrevistador).
- **Texto → voz:** la voz del sistema operativo/navegador (`speechSynthesis`), tal como recomienda el plan del reto para el primer día — cierra el ciclo ya, sin esperar a Piper/Kokoro. Se puede cambiar después sin tocar nada del backend.
- **Control:** botón de mantener-presionado-para-hablar (push-to-talk), la salida segura que recomienda el plan para una demo en vivo. También queda el campo de texto como respaldo/depuración.

Usa `buildFrameGenerico` de `@techsphere/decision` únicamente para tener el catálogo real de las 6 unidades del dominio (fiebre, dolor, herida, movilidad, apetito, sueño) con su léxico y regionalismos reales — es estructura pura, cero criterio clínico, así que no rompe el alcance pedido.

## Cómo correrla

> ⚠️ **Esto NO se abre haciendo doble clic en `index.html`.** Es una aplicación cliente-servidor: si la abres como archivo (`file:///C:/...`), el navegador no puede llamar al backend y todo falla con *"Failed to fetch"*. Hay que levantar el servidor y entrar por `http://localhost:8787`.

### 1. Pon tu clave

Abre el archivo **`.env`** que está en esta misma carpeta y pega tu clave de Groq después del `=`:

```
GROQ_API_KEY=gsk_tuclavereal...
```

Es gratis en [console.groq.com](https://console.groq.com/) → *API Keys*. El `.env` está en `.gitignore`, así que no se sube al repositorio (la rúbrica exige que no haya credenciales en el repo público).

### 2. Instala y compila los paquetes

Los paquetes se enlazan entre sí por `file:../...`, y esos enlaces no sobreviven bien la sincronización de OneDrive. Abre **PowerShell** en `Rescate\Herencia` y corre esto una vez, en orden:

```powershell
cd contracts      ; npm install ; npm run build ; cd ..
cd deterministic  ; npm install ; npm run build ; cd ..
cd conversational ; npm install ; npm run build ; cd ..
cd decision       ; npm install ; npm run build ; cd ..
cd interfaz-conversacional ; npm install
```

Si algún `npm install` se queja de que no encuentra `@techsphere/contracts` (o `deterministic`/`conversational`), es la causa que ya diagnosticó `Estafeta-Plan-de-Trabajo.md` §2.1: los symlinks se rompieron en la copia. Volver a correr `npm install` en ese paquete, con la carpeta hermana ya presente, lo resuelve.

### 3. Arranca el servidor

Desde `Rescate\Herencia\interfaz-conversacional`:

```powershell
npm start
```

Debe imprimir `Interfaz conversacional de prueba: http://localhost:8787`. **Deja esa ventana abierta** — mientras corra, el servidor está vivo.

> No uses `GROQ_API_KEY=tu_clave npm start`: esa sintaxis es de bash y **falla en PowerShell y en cmd**. Por eso la clave va en el archivo `.env`.

### 4. Abre el navegador

Escribe **`http://localhost:8787`** en la barra de direcciones de **Chrome o Edge** (son los que mejor soportan `MediaRecorder` y las voces en español de `speechSynthesis`). El navegador va a pedir permiso de micrófono la primera vez; acéptalo.

Si algo falla, la página ahora te dice cuál de las dos causas es: abierta como archivo, o servidor caído.

El agente saluda primero **hablando** (así es una llamada de seguimiento real). Para responder: **mantén presionado** el botón rojo 🎤, habla, y suelta — se transcribe con Whisper y se envía solo, como una llamada de verdad. El campo de texto de abajo sigue ahí por si quieres escribir en vez de hablar (útil para depurar rápido sin usar el micrófono).

## Qué vas a ver

- **Columna izquierda:** el chat — lo que dice el agente (y lo dice en voz alta) y lo que transcribió de tu voz, con la latencia medida **desde que dejaste de hablar hasta que el agente empieza a responder** — la métrica que más pesa según el plan del reto.
- **Columna derecha:** el estado interno de cada unidad en vivo — `raw` (lo que dijiste literal), `normalized` (el valor que el motor extrajo, o `null` si nunca lo inventa), `state`, `confidence`, causa y cierre. Es la forma más directa de comprobar la regla que no se negocia: **si no lo dijiste, no existe**.

## Cosas concretas para probar

- Habla con regionalismos ambiguos ("me arde", "estoy maluco", "un calorcito", "una molestia") y mira si `normalized` se queda en `null` para las que no cuantifican — no debería inventar un número.
- Di una frase de bandera roja ("estoy sangrando mucho") y verifica que corta el guion (aparece el aviso rojo en el panel).
- Deja pasar varios turnos sin responder claro y mira cómo sube `intentos_sin_exito` antes de que la unidad se cierre por degradación.
- Prueba audio adverso a propósito: hablando bajito, con ruido de fondo, tosiendo, cortándote a media frase — es donde se encuentran los problemas reales, según el propio plan.
- Botón **Reiniciar** arranca una sesión nueva desde cero.

## Nota sobre esta verificación

No pude probar el tramo de red real (Whisper/Groq) desde donde yo trabajo — el entorno en el que armé esto no tiene salida a internet ni micrófono. Sí verifiqué: que el servidor arranca, sirve la página, y que `/api/transcribir` llega hasta Groq y responde con un error limpio (no un cuelgue) cuando la clave es inválida. El primer round-trip real de voz hay que probarlo en tu máquina.

## Qué NO hace (a propósito)

No decide si hay que alertar a nadie, no consulta el corpus clínico, no arma el resumen de la llamada. Eso es la capa de decisión, que ya está construida y probada aparte — esto es solo el frente conversacional que pediste probar primero.
