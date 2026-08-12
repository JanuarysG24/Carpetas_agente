# Estafeta — Agente de voz postoperatorio

**Para quien recibe el relevo.** Este documento dice qué hay, qué está verificado, qué falta y en qué orden construirlo. No narra la historia del proyecto: dice dónde está parada la cadena y dónde entrar.

Fecha de corte: **11 de agosto de 2026**.

---

## 1 · La respuesta corta

**No se empieza de cero.** De las cuatro capas del sistema, **dos están implementadas y verificadas**, y el contrato contra el que se escriben las otras dos ya existe y ya está probado.

Lo que falta es la **capa conversacional** y la **interfaz de voz**. Todo lo demás —decisión, evaluación determinista, consola de conocimiento, RAG, resumen estructurado— corre hoy.

---

## 2 · Estado verificado, no reportado

Esto no es el estado que dice el README heredado: es el resultado de ejecutar las suites el 11 de agosto.

| Módulo | Pruebas | Resultado |
|---|---:|---|
| `contracts` | 51 | **51 pasan, 0 fallan** |
| `deterministic` | 93 | **93 pasan, 0 fallan** |
| `decision` | 170 | **170 pasan, 0 fallan** |
| **Total** | **314** | **314 pasan** |

Cómo reproducirlo, en cada módulo:

```
npm test
```

Si algo de esto se rompe más adelante, la referencia es este número. No se avanza sobre rojo.

### 2.1 · Dos arreglos de arranque, ya diagnosticados

La copia heredada llega con dos defectos **de empaquetado, no de lógica**. Sin ellos fallan las 314; con ellos pasan las 314.

1. **`@techsphere/contracts` no está enlazado.** `decision` y `deterministic` lo declaran como `file:../contracts`, y en `node_modules/@techsphere/` los directorios llegaron vacíos: eran enlaces simbólicos y no sobrevivieron a la copia. Se resuelve con `npm install` en cada módulo con `contracts/` presente como carpeta hermana, o copiando `contracts/` dentro de `node_modules/@techsphere/`.
2. **`dominio/` está en la raíz y el código lo busca en `docs/dominio/`.** Mover o copiar `dominio-postop-v0.1.json` y `lexico-postop-v0.1.json` a `docs/dominio/`.

Hacer esto **primero**. Hasta que las 314 no estén en verde en la máquina de quien recibe, no se escribe código nuevo: no habría contra qué medir.

---

## 3 · La arquitectura, en cuatro capas

Cada capa desconoce la implementación de las otras y se comunica por contratos tipados. Esa es la propiedad que hace que el sistema sobreviva a un cambio de modelo sin reescribirse.

| Capa | Qué hace | Estado |
|---|---|---|
| **Interfaz de voz** | Voz→texto y texto→voz. Nada más: no entiende, no extrae, no decide | **Falta** |
| **Conversacional** | El entrevistador. Modula el *cómo*: tono, naturalidad, regionalismos. Produce contexto estructurado | **Falta** |
| **Determinista** | Evalúa funcionalidad, interacción e integridad. No diagnostica, no alerta: entrega evidencia trazable | ✅ 93 pruebas |
| **Decisión** | La única autoridad. Gobierna el bucle de suficiencia, compone los votos, emite la decisión y el resumen | ✅ 170 pruebas |

### 3.1 · La costura conversacional ↔ decisión

Vive entera en **`contracts/src/conversational.ts`**, ya escrita y ya probada. Es el documento más importante para quien reciba el relevo, y conviene leerlo antes que este plan. Lo que fija:

- **La conversacional no juzga suficiencia.** Juzga suficiencia *local* (¿esta unidad quedó descrita?). La suficiencia *global* —¿ya alcanza para decidir?— es del decisor y solo del decisor.
- **El bucle.** El decisor responde `FrameVerdict`: o `sufficient` con la `Decision`, o `need_more` con un `frame_delta` que trae **solo las unidades reabiertas**. Ese delta es el checklist de contexto faltante, y vuelve a la conversacional como temas a explorar.
- **El marco no trae preguntas, trae `intent`.** Prosa dirigida a la conversacional que dice *qué* hay que saber, nunca *cómo* preguntarlo ni qué significa clínicamente. El criterio clínico vive entero del lado del decisor.
- **La conversacional no sabe en qué ronda va.** A propósito: saberlo le permitiría modular su insistencia según el presupuesto del decisor, y eso sería filtrar criterio de suficiencia global a una capa que por diseño no lo tiene.
- **La evidencia no se destruye.** `raw` guarda siempre el literal del paciente. Y el vacío se tipifica: `no_sabe` ≠ `no_comprende` ≠ `sin_respuesta` ≠ `rehusa`. Colapsarlos en `null` destruye señal que solo esta capa puede observar, porque es la única presente cuando el paciente calla.
- **`state` y `confidence` no son lo mismo y ambas viajan.** `state` (entero, [-3,+3]) mide la salud de la extracción: qué tan sana fue la conversación que produjo el dato. `confidence` (real, [0,1]) mide la fidelidad del mapeo al léxico. Son independientes y las combinaciones cruzadas son reales.
- **La incoherencia y la incompletud ya tienen salida.** `reason_code: "incongruencia"` y `"contexto_incompleto"` → escalamiento humano. Es un acto del decisor, no de la conversacional.

### 3.2 · Lo que la conversacional tiene prohibido

Escrito aquí porque es el error más fácil de cometer al implementarla:

- No consulta el RAG.
- No origina contenido clínico. Lo clínico que diga sale de `say_to_patient`, que el decisor entrega y ella solo reformula con tono y regionalismos.
- No diagnostica, no interpreta síntomas, no decide escalar.
- No emite el reporte estructurado. El resumen lo ensambla el decisor **desde el registro**, no lo infiere un modelo.

---

## 4 · Lo que se hereda funcionando

### `decision/` — la capa de decisión

Implementa el bucle completo: marco contextual por sesión, suficiencia por predicado, tabla de voto determinista, ponderador y entrega.

- **Dos votos, disyunción sin veto.** Uno probabilístico (modelo), uno determinista (tabla declarada). Un sí actúa; dos noes no actúan. El voto determinista dispara pero no veta.
- **A la falla, actúa humano.** No existe camino de código que termine sin `Decision`, ni sesión que termine sin `CallSummary`. Todo timeout es finito y su expiración produce **alerta**, no reintento.
- **`escalate` y `criticality` no se colapsan.** El booleano es la acción; la criticidad ternaria (verde/amarillo/rojo) es la lectura, y es la que se contrasta contra el dataset etiquetado. Colapsarlas perdería el amarillo, que es el 16 % de los casos y el único tramo donde la decisión es interesante.
- **La consola de conocimiento (G5) está hecha y tiene demo ejecutable:**

  ```
  npm run demo:g5
  ```

  Ingesta → se recupera → retiro → deja de recuperarse, en el mismo proceso y sin reiniciar. Ese es el guion que se graba para el video.

### `deterministic/` — el evaluador estructural

Aritmética pura: sin red, sin modelos, sin cliente HTTP por construcción. Evalúa funcionalidad, interacción e integridad sistémica sobre contexto ya declarado suficiente. Reproducible byte a byte, auditable regla a regla — que es exactamente lo que un modelo probabilístico no puede ofrecer. Métricas sobre 160 trayectorias etiquetadas incluidas.

### `contracts/` — los tipos y los puertos

Ocho puertos, los validadores de esquema y la costura de §3.1. Ninguna capa re-tipa nada: todas importan de aquí.

### Datos

- `corpus-texto/` y `decision/corpus/` — ~500 documentos clínicos ya extraídos a texto plano, con índice preconstruido y versionado. **No se indexa nada al arrancar**, que es lo que mantiene G2 dentro del reloj.
- `dominio/` — dominio y léxico postoperatorio en JSON.
- `decision/salidas/sesiones/` — sesiones anotadas de muestra: degradación, OR-rojo, urgencia.

### Documentación heredada

`Especificacion-Capa-Decision.md` (64 KB) y `Especificacion-Capa-Determinista.md` (32 KB): los ADR con las alternativas evaluadas y por qué se descartaron. **Es la materia prima de la Pregunta 2 del video.** No hay que reconstruir ese razonamiento: hay que leerlo y citarlo.

---

## 5 · Lo que falta, y su hueco documental

### 5.1 · La capa conversacional

Es el trabajo principal. **Aviso importante:** la `Especificacion-Capa-Conversacional.md` **no llegó en la copia heredada**. Las dos specs que sí están son la de decisión y la de determinista.

Esto no bloquea, pero cambia el método: la especificación efectiva de la capa conversacional es **`contracts/src/conversational.ts`**, que está densamente comentado y trae las decisiones con su justificación. Se implementa contra el tipo, no contra la prosa.

Módulo `@techsphere/conversational`, con las funciones que el resto del sistema ya espera (visibles en `decision/scripts/muestra-estratificada.mjs`):

```
cargarMarco · iniciarSesion · conducirTurno · cerrarPendientesPorCorte · unidadesParaEntrega
```

Respetar esos nombres: hay código heredado que ya los importa.

### 5.2 · La interfaz de voz

**Esta es la única decisión de arquitectura que queda abierta, y es de quien dirige, no de quien implementa.** Dos formas, y no son intercambiables:

**(a) La forma heredada — push-to-talk contra un contrato `/turn`.** Es lo que el resto del sistema ya asume: React + Vite + TypeScript, STT con Whisper de Groq, TTS con Piper en el navegador (WASM), cierre de turno por pulsación y por pausa adaptativa. Encaja sin fricción con la capa de decisión tal como está construida, que razona por turnos.

**(b) LiveKit Agents.** Trae el servidor de medios, el turn-taking y el manejo de interrupciones ya resueltos, y un frontend completo listo (`livekit-examples/agent-starter-react`, Next.js, gratuito). Gana en calidad de conversación, que son 15 puntos de la rúbrica.

**El costo de (b) no es aprender LiveKit: es que asume un pipeline en streaming continuo, y la capa de decisión heredada está construida sobre un intercambio por turnos.** Injertar uno en otro es rearquitectura, no integración. Con el tiempo disponible, la recomendación es **(a)**, y dejar (b) como la respuesta a "¿qué cambiarías con dos semanas más?" en el video.

El TTS en español no es negociable en ninguna de las dos: el de Groq es inglés y árabe. Piper o Kokoro, local.

---

## 6 · Orden de trabajo

Ordenado por compuertas eliminatorias, no por comodidad. Lo que no pasa las compuertas no se puntúa.

**Paso 0 — Recuperar el terreno (antes que nada).**
Aplicar los dos arreglos de §2.1. Correr las tres suites. **314 en verde o no se sigue.** Correr `npm run demo:g5` y ver el ciclo completo con los propios ojos: eso es G5 ya cerrada.

**Paso 1 — La capa conversacional contra el contrato.**
Implementar `@techsphere/conversational` con las cinco funciones de §5.1. El motor de estados ([-3,+3], cierre por estancamiento y no por contador de intentos) es lo que hace explicable cada movimiento conversacional. Escribir sus pruebas al mismo tiempo, no después.

**Paso 2 — El prompt del entrevistador.**
Un prompt, no una máquina de estados codificada a mano. Reglas de forma que no se negocian: una pregunta por turno; confirma comprensión antes de seguir; no repregunta lo ya respondido; no diagnostica; **si el paciente no lo dijo, no se inventa**. Es contexto postoperatorio: el agente llama, ya sabe quién es el paciente y qué procedimiento tuvo. No pregunta nombre ni motivo.

**Paso 3 — La interfaz de voz.**
Según la decisión de §5.2. Cierra G4. Es el paso con más riesgo de latencia: medir desde el primer día, no al final.

**Paso 4 — Integración extremo a extremo.**
Voz → conversacional → decisión → voz. La sesión anotada contra el modelo real ya existe en `decision/salidas/sesiones/` como referencia de qué debe salir.

**Paso 5 — El ensayo de G2, en máquina limpia.**
Levantar siguiendo el README propio, al pie de la letra, con cronómetro. **Lo que se prueba no es el software: es el README.** Si no llega en 15 minutos, se corrige el README, no la explicación.

**Paso 6 — Los cuatro entregables.**
Repositorio, diagrama, informe final y video. El informe declara el modelo usado y por qué. El diagrama debe corresponder a lo implementado: el jurado toma elementos al azar y los busca en el código.

---

## 7 · Reparto sugerido

| Frente | Quién | Por qué |
|---|---|---|
| Recuperación del terreno y capa conversacional | Quien conoce la arquitectura | Requiere leer el contrato y las specs heredadas |
| Prompt del entrevistador, léxico y regionalismos | Quien tenga el habla local | El reto se juega en español coloquial y regional, y el criterio de voz evalúa jerga y entradas adversas |
| Interfaz de voz | A definir tras §5.2 | |
| Ensayo de G2 y video | Ambos | G2 se verifica cronometrado; el video pesa 15 puntos |

El frente del léxico regional no es cosmético: `UnitLexicon` en el contrato tiene un campo `synonyms` (regionalismo → término canónico) y otro `requires_precision` para las expresiones que *tocan* la unidad sin cuantificarla —"calorcito", "molestia", "poquito"—. Esas últimas **no** se traducen a un valor: producen `normalized: null` con el `raw` intacto y disparan el reflejo. Traducir "molestia" a un 2 inventa un dato que el paciente no dijo. Poblar bien esas dos listas, con habla real, es trabajo de alto rendimiento por hora invertida.

---

## 8 · Reglas que no se rediscuten

Están decididas, tienen ADR y tienen prueba. Cambiarlas cuesta más de lo que rinde.

1. **Un solo modelo para los dos roles de LLM** (entrevistador y decisor). Hace la conformidad con G3 auditable con un `grep`.
2. **Ningún SDK de proveedor.** Se habla HTTP plano con el `fetch` nativo de Node. `npm ls` no debe encontrar ningún cliente de terceros: las únicas dependencias de runtime son paquetes del propio repositorio. Hay prueba de esto.
3. **Una sola constante de modelo por ruta**, en `decision/src/modelo/rutas.ts`. El nombre no aparece en ningún otro archivo. Hay prueba de esto.
4. **La guarda de G3 corre al arrancar el proceso**, antes incluso de pedir la credencial. Un sistema que descubre en producción que usa un modelo no permitido ya falló la compuerta.
5. **El sistema no puede aceptar salida inválida.** La ruta primaria no admite `json_schema`, solo `json_object`: JSON válido garantizado, conformidad con el esquema no. Por eso toda salida estructurada cruza el validador de contratos, se reintenta de forma acotada con el error de esquema encima, y agotados los reintentos se degrada a humano. **La incapacidad de producir salida válida es un resultado declarado, no una excepción.**
6. **Ninguna sesión termina sin `CallSummary`.** Ensamblado desde el registro, no inferido por el modelo.

---

## 9 · Cómo verificar que algo está hecho

Vale para todo el proyecto y para el jurado, que califica solo lo observable:

- **Se abre el artefacto, no se lee el informe.** Cuanto mejor razonado esté el reporte de lo que se hizo, más urgente es correr la prueba.
- Una capa está hecha cuando **sus pruebas pasan**, no cuando su código existe.
- G5 está cerrada cuando se ve el ciclo subir→recuperar→retirar→dejar de recuperar corriendo, no cuando la consola compila.
- G2 está cerrada cuando alguien que no escribió el README levanta el sistema siguiéndolo, con cronómetro.
