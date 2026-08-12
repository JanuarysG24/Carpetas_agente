# Diagrama de arquitectura y flujo de decisión

**Source Meridian — Agente de voz post-operatorio · Tech Sphere Challenge 2026**

> Diagramas en Mermaid — se renderizan directamente en GitHub. No representan diseño visual (no evaluado); representan flujo de datos y de decisión (sí evaluado).

---

## 1 · Arquitectura de la solución

Una sola aplicación cliente (`plantilla-chat-voz.html`), sin backend propio. Las únicas dos salidas de red son directas a Groq Cloud, autenticadas con la clave que el usuario pega en Ajustes y que vive solo en `localStorage` de esa pestaña.

```mermaid
flowchart TB
    subgraph Navegador["Navegador del usuario — plantilla-chat-voz.html"]
        direction TB

        subgraph UI["Interfaz — 3 pestañas"]
            Llamada["📞 Llamada\n(interfaz de llamada)"]
            Conocimiento["📚 Conocimiento\n(consola de administración)"]
            Metricas["📊 Métricas"]
        end

        Mic["Botón mantener-presionado\nMediaRecorder API"]
        TTS["speechSynthesis\n(voz del sistema operativo)"]

        subgraph Motor["Motor en memoria (JS puro)"]
            Config["Config\nlocalStorage: clave, proveedor, modelo, voz"]
            Prompt["PROMPT()\nplantilla del entrevistador"]
            KB["KB — BM25\n107 docs semilla + subidos en consola\n~6.000 fragmentos indexados"]
            Decision["votoDeterminista() + ponderar()\ndisyunción sin veto"]
            Extraccion["extraer()\nparseo del bloque RESUMEN"]
        end

        Llamada --> Mic
        Mic -- "audio/webm" --> Whisper
        Llamada --> TTS
        Conocimiento -- "ingerir() / retirarDoc()" --> KB
        Metricas -. lee .-> Registro["registro[] + metricas[]\nen memoria"]
    end

    Whisper["Groq · Whisper large-v3-turbo\nPOST /openai/v1/audio/transcriptions"]
    Groq["Groq · llama-3.3-70b-versatile\nPOST /openai/v1/chat/completions"]

    Whisper -- texto transcrito --> Motor
    Motor -- "recuperar(consulta) → 2-3 fragmentos" --> KB
    KB -- "fragmentos + doc_id" --> Prompt
    Prompt -- "system + historial" --> Groq
    Groq -- "respuesta + [doc_id] citados + usage.tokens" --> Motor
    Motor --> Extraccion
    Extraccion -- "seis aspectos normalizados" --> Decision
    Decision -- "criticidad, escalar, razón" --> Llamada
    Motor --> TTS

    style Groq fill:#2fe3ff,color:#031018
    style Whisper fill:#2fe3ff,color:#031018
    style Decision fill:#38f0b0,color:#031018
```

**Por qué no hay backend propio.** El reto permite orquestación libre; se eligió cliente-puro porque elimina el mayor riesgo de la compuerta G2 (≤15 min, credenciales incluidas): no hay servidor que pueda fallar por symlinks rotos, variables de entorno mal cargadas, ni puertos ocupados. Groq expone CORS para llamadas directas desde el navegador, así que no hace falta un proxy.

---

## 2 · Flujo de un turno de conversación

```mermaid
sequenceDiagram
    actor P as Paciente
    participant UI as Interfaz (botón de voz)
    participant W as Groq Whisper
    participant M as Motor (BM25 + prompt)
    participant L as Groq Llama 3.3 70B
    participant D as Motor de decisión

    P->>UI: mantiene presionado y habla
    UI->>UI: MediaRecorder graba (estado: escuchando)
    P->>UI: suelta el botón (fin de habla — t0)
    UI->>W: POST audio/transcriptions
    W-->>UI: texto transcrito
    UI->>M: recuperar(texto + unidades faltantes, k=3)
    M->>M: BM25 sobre índice invertido (sin red)
    M->>L: POST chat/completions (system=PROMPT+fragmentos, historial)
    L-->>M: respuesta + [doc_id] citados + usage.tokens
    M->>UI: texto de respuesta (visible, con citas)
    UI->>UI: speechSynthesis.speak() → onstart = t1
    Note over UI: latencia reportada = t1 − t0
    M->>D: si la respuesta trae el bloque RESUMEN → extraer()
    D->>D: votoDeterminista(valores) + voto del modelo (tu_lectura)
    D->>D: ponderar(VP, VD) → disyunción sin veto
    D-->>UI: tarjeta de veredicto (verde/amarillo/rojo, escalar sí/no)
```

---

## 3 · Flujo de decisión — dos votos, disyunción sin veto

```mermaid
flowchart LR
    Turno["Turno de cierre:\nel modelo produce\nRESUMEN_INICIO…RESUMEN_FIN"] --> Extraer["extraer()\nseis aspectos + tu_lectura + urgencia"]

    Extraer --> VP["Voto del modelo (VP)\ntu_lectura declarada por el LLM\nverde / amarillo / rojo"]
    Extraer --> Valores["Valores normalizados\nfiebre, dolor, herida,\nmovilidad, apetito, sueño"]

    Valores --> Clasificar["clasificar() por unidad\n(reglas FC-*)"]
    Clasificar --> Componer["componer()\nCO-01: apetito+sueño cedidos\nCO-02: + fiebre → convergencia sistémica"]
    Componer --> VD["Voto determinista (VD)\ntabla de lectura declarada\nVD-01…VD-05"]

    VP --> Ponderar{"ponderar(VP, VD)\ndisyunción SIN veto"}
    VD --> Ponderar

    Ponderar -- "ambos verde" --> Verde["🟢 VERDE\nno escala"]
    Ponderar -- "cualquiera ≥ amarillo" --> NoVerde["escala"]
    NoVerde --> Amarillo["🟡 AMARILLO\nse anota, seguimiento del equipo"]
    NoVerde --> Rojo["🔴 ROJO\ncontacto hoy mismo"]

    Bandera["Bandera roja durante\nla conversación\n(sangrado, disnea, dolor torácico…)"] -. "corta la entrevista\nde inmediato, sin esperar cierre" .-> Rojo

    Verde --> Resumen["CallSummary\nsiempre se produce,\nincluso en cierres degradados"]
    Amarillo --> Resumen
    Rojo --> Resumen

    style VP fill:#8d97e8,color:#031018
    style VD fill:#2fe3ff,color:#031018
    style Rojo fill:#ff6b8b,color:#031018
    style Amarillo fill:#ffcf5c,color:#031018
    style Verde fill:#38f0b0,color:#031018
```

**Regla central verificada contra los 160 casos etiquetados del reto** (`trayectorias_postop_silver.xlsx`):

```
apetito muy_disminuido  ∧  sueño muy_alterado  ∧  fiebre ≥ 37.9
    → convergencia_sistemica → VD-01 → rojo
```

12 de 12 rojos capturados por esta composición, 0 falsos positivos, 0 falsos negativos. Ninguna variable sola discrimina — el corte por día ≥7 solo, por ejemplo, arrastra decenas de falsos positivos; solo la **composición** de las tres separa limpio.

---

## 4 · Compuerta 5 — conocimiento vivo

```mermaid
flowchart LR
    Subir["Consola › Subir documento\n(.txt/.md o texto pegado)"] --> Ingerir["ingerir(doc_id, título, texto, kind)"]
    Ingerir --> Trocear["Trocea en párrafos,\npiso de 500 caracteres"]
    Trocear --> Indexar["indexar()\nBM25: tf, df, idf, avgdl"]
    Indexar --> Disponible["✓ procesado y disponible\n(visible en la lista)"]
    Disponible --> Recuperable["El siguiente recuperar()\nya lo puede encontrar"]

    Retirar["Consola › Retirar"] --> RetirarFn["retirarDoc(doc_id)"]
    RetirarFn --> Borra["Sale de KB.docs y KB.frags"]
    Borra --> Reindexar["indexar() de nuevo"]
    Reindexar --> Olvidado["El siguiente recuperar()\nya NO lo encuentra"]

    style Disponible fill:#38f0b0,color:#031018
    style Olvidado fill:#ff6b8b,color:#031018
```

Verificado con un documento sintético que no pertenece a ningún corpus entregado ("Cuidado del drenaje quirúrgico Jackson-Pratt"): aparece en la recuperación tras subirlo, desaparece tras retirarlo. Prueba reproducible en `docs/informe-final.md` § evidencia.
