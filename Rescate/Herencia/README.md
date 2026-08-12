# Tech Sphere Challenge 2 — Agente de Voz Post-operatorio

Agente de voz de seguimiento post-operatorio en español (Colombia): conversa con el paciente, entiende sus síntomas contra una base de conocimiento clínico y decide cuándo alertar a personal capacitado.

> **Principio rector: aislamiento del modelo de decisión.** Toda la arquitectura se modeló antes de conocer qué modelo se usaría, separando **forma** de **contenido**. Cada capa desconoce la implementación de las otras y se comunica por contratos.
>
> **Esa apuesta se pagó el 7 de agosto, y se cobró dos veces el mismo día.** La ficha técnica no trajo un modelo único sino una lista cerrada de cuatro, y **dos de ellos resultaron estar apagados**. El sistema migró primero a un modelo local pequeño; horas después, con la autorización de la organización para usar los modelos sucesores, migró a nube conservando el local como respaldo. **Ningún puerto, ningún contrato y ninguna capa tuvo que reescribirse en ninguna de las dos migraciones**: cambió el binding y se registraron cinco decisiones nuevas (ADR-017 a ADR-021). El volcado completo está en [`docs/Acta-7AGO.md`](docs/Acta-7AGO.md).

> ## ▶ Arranque rápido
>
> **Node 22+ y una credencial de Groq.** Dos terminales, un comando por línea.
>
> **Terminal 1 — backend:**
> ```
> cd slice
> copy .env.example .env
> npm install
> npm start
> ```
>
> **Terminal 2 — interfaz de voz:**
> ```
> cd voice-interface
> npm install
> npm run voz:preparar
> npm run dev
> ```
>
> Antes de `npm start`, abra `slice/.env` y pegue su credencial en `GROQ_API_KEY`.
> En macOS o Linux, use `cp` en lugar de `copy`.
>
> Abra `http://localhost:5173` y hable. Detalle completo, verificación y modo sin credencial en [**Cómo correrlo**](#cómo-correrlo).

## Estado

**Este commit contiene solo el modelado.** Arquitectura, especificaciones por capa, órdenes de trabajo, lógicas generales reutilizables, guías de ejecución y el acta del volcado de la ficha técnica. La implementación entra a partir de aquí, capa por capa, siguiendo las órdenes de trabajo.

## Decisiones de arquitectura

**Modelo (G3).** **Ruta de nube con un modelo de linaje sucesor** de la lista permitida como primaria, y la **ruta local conservada como respaldo** — para que el arranque no dependa de credenciales de terceros y para asegurar la demostración en vivo. **Un solo modelo para los dos roles de LLM del sistema** (entrevistador y decisor), lo que hace la conformidad auditable con un grep. Criterio de elección entre candidatos: **calidad del español por encima de capacidad de razonamiento**, porque el razonamiento estructural lo absorbe la capa determinista y el rol que conversa es el que se evalúa en tono y registro — y se decide **midiendo, no argumentando**. Justificación, alternativas evaluadas y descartes: ADR-017 y ADR-021; fundamento de conformidad en [`docs/Respuesta-Organizacion-7AGO.md`](docs/Respuesta-Organizacion-7AGO.md).

**Consistencia.** El rol decisor corre con temperatura cero, pero eso **no da determinismo** en un modelo hospedado. La consistencia del sistema no viene del modelo: viene del segundo voto —una tabla declarada, idéntica ante el mismo caso— y de que un voto negativo no puede apagar uno positivo. Se mide y se reporta como **estabilidad de decisión**.

**Voz.** React + Vite + TypeScript; STT con **Groq Whisper**, TTS con **Piper** (WASM, en el navegador). Cierre de turno en push-to-talk y en modo automático por pausas, con **pausa retroactiva**: el tiempo de espera se adapta al ritmo del paciente — a menor velocidad de habla, más paciencia. Voz, RAG y embeddings son stack libre en el reto; solo el modelo de lenguaje está restringido.

**Decisión.** Dos votos independientes —uno probabilístico del modelo, uno determinista por tabla declarada— combinados por **disyunción sin veto**: un sí actúa, dos noes no actúan. Todo estado no decidible degrada hacia el humano. Ninguna sesión termina sin resumen estructurado.

## Estructura

```
.
├── docs/                # Especificaciones por capa, órdenes de trabajo, lógicas
│                        # generales, guías de ejecución, acta y plan
├── scripts/             # Arnés del ensayo de arranque en entorno limpio
├── Arquitectura v0.3 - Handoff Analista.md
└── LICENSE              # MIT
```

La implementación (`voice-interface/`, capa conversacional, determinista y de decisión) entra en los commits siguientes, una orden de trabajo a la vez.

## Documentación

**Empezar por aquí:** `Arquitectura v0.3 - Handoff Analista.md` (el plano) y `docs/Acta-7AGO.md` (el contraste del plano contra el material real del reto).

- `docs/Estado-Vivo.md` — **protocolo de sincronía entre sesiones.** El proyecto lo construyen varias sesiones de IA en paralelo bajo un solo director; este es el único documento que se escribe *durante* el trabajo y no *sobre* el trabajo. Dice dónde está parada la cadena —binding vigente, decisiones de las últimas horas, hallazgos y supuestos superados— sin narrar cómo se llegó. Nació de una colisión real: dos sesiones construyendo sobre bindings distintos sin saberlo.

- `Arquitectura v0.3 - Handoff Analista.md` — arquitectura de referencia por capas, fronteras, ADR-001 y el cierre del PENDIENTE-7AGO (§10).
- `docs/Acta-7AGO.md` — **volcado de la ficha técnica**: diecisiete decisiones de cierre con su justificación, las sorpresas encontradas, la verificación de los doce supuestos de arquitectura y las siete contradicciones detectadas al materializar los contratos.
- `docs/Respuesta-Organizacion-7AGO.md` — consulta a la organización sobre los modelos apagados de la lista permitida, su respuesta, y cómo se interpreta. **Fundamento de conformidad con la compuerta G3.**
- `docs/Especificacion-Interfaz-Voz.md` — spec de la capa de interfaz (ADR-001 ampliado, contrato `/turn`).
- `docs/Ordenes-de-Trabajo-Interfaz-Voz.md` — paquetes de trabajo de la capa de voz (WO-00…WO-12).
- `docs/Documentacion-Modulo-Interfaz-Voz.md` — documentación del módulo de voz: flujo, tecnologías, decisiones justificadas y la pausa retroactiva. Su infografía: `docs/Infografia-Interfaz-Voz.html`.
- `docs/Logica-Gobierno-Conversacional.md` — motor de entrevista **agnóstico de dominio** (estados [-3,+3], tres impactos por turno, ciclo retroactivo), generalizado del Modelero Chencha. Activo reutilizable fuera de este proyecto.
- `docs/Especificacion-Capa-Conversacional.md` — spec del entrevistador/intérprete e **instanciación** del motor: ADR-002 (un modelo, dos roles), ADR-003 (suficiencia local vs. global), ADR-004 (no destrucción de evidencia), ADR-005 (gobierno por estados), **ADR-019** (el entrevistador no ve el RAG), **ADR-020** (misión no negociable y salida clínica anclada a fuente) y el **contrato Conversacional ↔ Decisión** (cierra RT-12).
- `docs/Ordenes-de-Trabajo-Capa-Conversacional.md` — paquetes de trabajo de la capa conversacional (WO-13…WO-24, más WO-23b: banco de entradas adversas).
- `docs/Documentacion-Modulo-Capa-Conversacional.md` — documentación del módulo conversacional: flujo, tecnologías, decisiones justificadas y el motor de estados. Su infografía: `docs/Infografia-Capa-Conversacional.html`.
- `docs/Logica-General-Determinista-Convergencia-Derivacion-Colapso.md` — motor determinista **agnóstico de dominio** (derivación taxonómica, colapso clasificatorio, convergencia matricial), generalizado de la calculadora de patrones patogénicos. Activo reutilizable fuera de este proyecto.
- `docs/Guia-Motores-Deterministas-Criterio-Contextual.md` — referencia de ingeniería: los dos motores deterministas (clasificatorio y relacional dinámico), su vocabulario desambiguado y el criterio para elegir entre ellos.
- `docs/Especificacion-Capa-Determinista.md` — spec del módulo de evaluación estructural e **instanciación** de los motores: ADR-006 (funcionalidad/interacción/integridad, no diagnóstico), ADR-007 (no pondera), ADR-008 (Motor A en runtime), ADR-009 (la no evaluabilidad es resultado), ADR-010 (destilación, no recuperación) y el **contrato `DeterministicPort`**.
- `docs/Ordenes-de-Trabajo-Capa-Determinista.md` — paquetes de trabajo de la capa determinista (WO-25…WO-35).
- `docs/Especificacion-Capa-Decision.md` — spec de la capa de decisión: ADR-011 (RAG sin pacientes), ADR-012 (marco generado/inferido), ADR-013 (ponderación OR sin veto), ADR-014 (a la falla actúa humano), ADR-015 (estándar re-indexable), ADR-016 (resumen estructurado: ninguna sesión sin `CallSummary`), **ADR-017** (lista cerrada, criterio de elección, un modelo para ambos roles), **ADR-018** (criticidad ternaria) y **ADR-021** (ruta nube primaria, local como respaldo, y por qué la consistencia no viene del modelo), más los contratos `PatientStorePort`, `KnowledgePort`, `KnowledgeConsolePort` y `SummarySinkPort`.
- `docs/Ordenes-de-Trabajo-Capa-Decision.md` — paquetes de trabajo de la capa de decisión (WO-36…WO-47, incluida WO-45b — resumen estructurado; solo WO-47 está bloqueada).
- `docs/Documentacion-Modulo-Capa-Decision.md` — documentación del módulo de decisión: flujo, tecnologías, decisiones justificadas y la lógica de la alerta (dos votos, disyunción sin veto, degradación a humano). Su infografía: `docs/Infografia-Capa-Decision.html`.
- `docs/Documentacion-Modulo-Capa-Determinista.md` — documentación del módulo determinista: flujo, decisiones justificadas y los tres ejes de evaluación. Su infografía: `docs/Infografia-Capa-Determinista.html`.
- `docs/Analisis-y-Secuencia-de-Modelado.md` — registro del proceso de diseño y de las reversiones.
- `docs/Plan-de-Construccion-7-10-Ago.md` — plan de ejecución por automatismos: regla forma/contenido para el paralelismo, día a día, líneas de corte y checklist nocturno de compuertas.
- `docs/Ensayo-Compuerta-2.md` + `scripts/ensayo-arranque.ps1` — protocolo y arnés para verificar el arranque en ≤15 min en entorno limpio. Lo que se prueba no es el software: es el README.
- Guías de ejecución asistida, una por capa: `docs/Guia-Ejecucion-Claude-Code.md` (voz), `-Conversacional.md`, `-Determinista.md` y `-Decision.md`.

## Las cuatro capas

**Interfaz de voz.** Único punto de contacto con el paciente. Convierte voz en texto y texto en voz, y nada más: no entiende, no extrae, no decide, no sabe qué modelo hay detrás. Eso es lo que hace intercambiables STT y TTS.

**Conversacional.** El entrevistador. Modula el *cómo* —tono, naturalidad, regionalismos— y produce contexto estructurado a partir de lo que el paciente dice. La cadencia la gobierna un **motor de estados determinista** ([-3,+3], tres impactos por turno, cierre por estancamiento y no por contador de intentos), de modo que cada movimiento conversacional es explicable desde el registro. No juzga suficiencia clínica, no consulta el RAG y no origina contenido clínico.

**Determinista.** Evalúa **funcionalidad, interacción e integridad sistémica** sobre el contexto ya declarado suficiente. Explícitamente **no diagnostica** y no emite alerta: entrega evidencia trazable que la capa de decisión pondera. Es reproducible y auditable regla a regla, que es lo que un modelo probabilístico no puede ofrecer.

**Decisión.** La única autoridad. Genera el marco contextual por sesión, gobierna el bucle de suficiencia, compone los dos votos y produce la decisión con su razón y sus trazas. Toda sesión cierra con un resumen estructurado ensamblado del registro — no inferido por el modelo.

## Activos reutilizables

Dos piezas de este repositorio son **agnósticas de dominio** y sirven fuera de este proyecto:

- `docs/Logica-General-Gobierno-Conversacional.md` — motor de entrevista por estados, con ciclo retroactivo y cierre por estancamiento.
- `docs/Logica-General-Determinista-Convergencia-Derivacion-Colapso.md` — motor de derivación taxonómica, colapso clasificatorio y convergencia matricial.

Las specs de las capas conversacional y determinista son **instanciaciones** de estos dos motores al dominio post-operatorio, no diseños ad hoc.

## Cómo correrlo

**Requisitos: Node 22 o superior** (se usa el ejecutor de TypeScript nativo) y una credencial de Groq.
Nada más. No hay que instalar modelos, ni bases de datos, ni Docker. **El índice del corpus va preconstruido y versionado**: no se indexa nada al arrancar.

> **Un comando por línea.** No se encadenan con `&&`: Windows PowerShell 5.1 no lo admite y aborta la línea entera. Donde diga `copy`, en macOS o Linux use `cp`.

### 1 · Backend

```
cd slice
copy .env.example .env
```

Abra `slice/.env` y pegue su credencial en `GROQ_API_KEY`. Después:

```
npm install
npm start
```

Queda escuchando en `http://localhost:8000`.

`.env.example` trae ya el modelo correcto. **No cambie `GROQ_MODEL_LLM`**: la guarda de modelo permitido lo valida al arrancar y un nombre fuera de la lista no levanta el proceso.

### 2 · Interfaz de voz — otra terminal

```
cd voice-interface
npm install
npm run voz:preparar
npm run dev
```

`voz:preparar` descarga la voz en español (~110 MB) una sola vez. `npm run dev` abre `http://localhost:5173`.

`npm run voz:preparar` es **opcional**. Si lo omite, la aplicación arranca igual y usa la voz del sistema operativo, y lo dice en su cabecera — pero la voz suena peor.

> **Deje la página cargada un momento antes de hablar.** El motor de voz tarda unos segundos en estar listo; si habla en el primer segundo, ese turno sale con la voz del sistema y el resto con la buena.

### 3 · Comprobar antes de hablarle al micrófono

```
cd slice
npm run humo
```

Recorre una llamada completa por HTTP y comprueba las cuatro cosas que tienen que ser ciertas: que arranca con las capas reales, que el contrato del turno tiene la forma que la interfaz lee, que la llamada termina dejando su resumen, y que la urgencia corta y escala. **Sale con código 1 si algo falla.**

Si el humo pasa, lo único que puede fallar después es el micrófono o la credencial, y las dos cosas se ven a simple vista.

### 4 · Conocimiento vivo — subir y retirar un documento

```
cd decision
npm install
npm run demo:g5
```

Ingiere un documento nuevo, comprueba que el agente lo usa, lo retira, y comprueba que deja de usarlo. **Es autoverificable: sale con código 1** si el documento ya estaba antes de subirlo, si no aparece después, si sigue apareciendo tras el retiro, si su identificador deja de resolver, o si un documento sin capa de texto no es rechazado.

Para operar la consola a mano: `npm run consola`.

### Sin credencial también arranca

Sin `GROQ_API_KEY` el recorrido completo se puede hacer igual: **la extracción, el módulo determinista, la recuperación documental y el resumen son reales y no tocan la red.** Lo que cae es el voto probabilístico —pasa a guion— y la redacción —pasa a plantillas—. Las dos caídas **se anuncian** en el arranque y en `/health`.

Una demo que corre degradada y no lo dice es una demo que miente. Para la sesión evaluada la credencial sí hace falta: sin ella no hay voz natural ni voto del modelo.

### Qué entra en el reloj y qué no

| Dentro | Fuera |
|---|---|
| `npm install` de `slice`, `voice-interface` y `decision` | Descarga de la voz (`voz:preparar`), como cualquier activo versionable |
| Pegar la credencial en `.env` | Indexación del corpus — **va preconstruida** |
| `npm start` y `npm run dev` | Las pruebas de evaluación posteriores |

Protocolo de ensayo cronometrado en `docs/Ensayo-Compuerta-2.md`.

## Créditos y licencia

Modelado, arquitectura y construcción: **Arcandan López Aburto** (Medellín, Colombia), para el Tech Sphere Challenge 2026 de Source Meridian.

El dataset clínico y el corpus documental son material del reto y **no se distribuyen en este repositorio**. Los datos del reto son sintéticos y no han sido validados clínicamente: no sirven para ninguna finalidad clínica, diagnóstica ni asistencial.

MIT — ver `LICENSE`.
