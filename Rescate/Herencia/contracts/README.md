# `@techsphere/contracts` — módulo compartido de contratos

Superficie única e importable por las **cuatro capas**. Contiene exclusivamente **tipos**, **puertos** (interfaces sin implementación) y **validación de esquema**. No contiene lógica de negocio de ninguna capa, ni transporte, ni dependencia de ningún modelo de lenguaje.

Es el paso bloqueante del plan de construcción: mientras no compile, no se abre ningún otro frente.

```bash
cd contracts && npm install && npm run verify
```

`verify` = `typecheck` + `test`. Las dos cosas tienen que estar verdes antes de tocar cualquier capa.

---

## Qué hay dentro

| Archivo | Qué declara | Instancia |
|---|---|---|
| `src/conversational.ts` | `ContextFrame`, `UnitSpec`, `UnitResult`, `FrameVerdict`, `Decision`, `Criticality`, `ReasonCode` | Spec conversacional §8.2, §15.1 |
| `src/deterministic.ts` | `DeterministicRequest`, `DeterministicReport`, `ClassHit`, `CompositionHit`, `StructureHit`, `DomainManifest` | Spec determinista §6.2, §6.3, §6.4 |
| `src/knowledge.ts` | `SourceDocument` y el contrato del corpus | Spec de decisión §8.2, §8.3 |
| `src/patient.ts` | `PatientCase`, `IdentityClaim`, `IdentityVerdict` | Spec de decisión §4 |
| `src/summary.ts` | `CallSummary`, `Vote`, `SummaryDestination` | Spec de decisión §8b (ADR-016) |
| `src/ports.ts` | Los ocho puertos | Las tres specs |
| `src/validation/` | Validadores con mensajes accionables | Los criterios de aceptación del Paso 0 |

`knowledge.ts` y `patient.ts` están **separados a propósito**: ADR-011 no es una regla de contenido sino de estructura, y si conocimiento y estado viven en el mismo archivo la separación depende de que alguien recuerde la prosa.

---

## Las cinco reglas que este módulo hace cumplir

**1. `escalate` y `criticality` no se colapsan (ADR-018).** `escalate` es la **acción** y es lo único sobre lo que opera el ponderador OR. `criticality` es la **lectura** de gravedad, no se pondera y es lo que se contrasta contra `label_ground_truth`. El booleano **no se llama `alert`**: teniendo `criticality` al lado, `alert` invita a leerse como sinónimo de `criticality === "rojo"`, que es la confusión exacta que ADR-018 elimina. El término sobrevive solo en `alert_channel`, que es un destino de entrega.

**2. El reporte determinista no admite `alert`, `score`, `risk`, `severity`, `recommendation` ni `diagnosis` (ADR-007).** La ausencia es normativa y está protegida por prueba negativa en dos niveles.

**3. El corpus no contiene pacientes (ADR-011).** `SourceDocument` no tiene campo de identidad y `kind` no admite tipos de paciente. Un documento con datos de paciente se rechaza **por esquema**, no por convención.

**4. `state` no es `confidence` (ADR-005).** Es el punto de confusión más probable del proyecto, y por eso está documentado en el propio tipo:

| | `state` | `confidence` |
|---|---|---|
| Mide | **Salud de la extracción**: qué tan sana fue la conversación que lo produjo | **Fidelidad del mapeo**: ¿este texto corresponde a este concepto del léxico? |
| Naturaleza | Acumulada, por unidad | Instantánea, por acto de normalización |
| Origen | Aritmética determinista | Capa probabilística |
| Rango | entero en `[-3, +3]` | real en `[0, 1]` |

Son independientes, y las dos combinaciones cruzadas son reales: `confidence: 0.9` con `state: -2` (dato nítido, fuente inestable) y `confidence: 0.3` con `state: +3` (conversación fluida sobre algo que no mapea al léxico).

**5. El transporte queda fuera del tipo.** Ningún puerto menciona HTTP, JSON ni proceso. Hay un test que declara dos implementaciones de `DecisionPort` —una en proceso y otra que serializa— y las recorre por la misma variable tipada.

---

## Cómo se usa la validación

Todo validador devuelve `ValidationResult`, **nunca lanza por sí solo y nunca devuelve `undefined`**. Acumula todos los problemas, no solo el primero.

```ts
import { validateContextFrame, exigirValido } from "@techsphere/contracts";

const res = validateContextFrame(marco);
if (!res.valid) {
  // Cada problema trae path, code, message (qué pasó) y hint (qué hacer).
  for (const issue of res.issues) log.warn(issue);
}

// En una frontera donde seguir con un dato inválido es peor que caerse:
exigirValido("ContextFrame de la sesión s_0042", validateContextFrame(marco));
```

Los validadores además comprueban **coherencias entre campos válidos por separado**, que es donde vive el error caro:

- `escalate: false` con un `reason_code` de las ramas de ADR-014 → rechazado. *A la falla, actúa humano.*
- `context_complete: false` con `escalate: false` → rechazado. Es la degradación segura.
- Un voto que dice escalar con una decisión que no escala → rechazado. El VD dispara pero **no veta**.
- `closure: "declarado"` con `cause: "no_comprende"` → rechazado. Un `no_sabe` limpio es un turno sano y no debe ponderarse como un fracaso.
- `coverage.ratio` que no se corresponde con las listas → rechazado. Es el número que el decisor consulta antes de emitir `escalate: false`.

---

## Compuerta G3

Este paquete tiene **cero dependencias de runtime**, y en particular ninguna de ningún modelo de lenguaje. Las dos de desarrollo son el compilador de TypeScript y sus tipos. El modelo del sistema es `llama3.2:3b` local sobre Ollama para los dos roles (ADR-017), y vive detrás de `ConversationalEngine` y `DecisionEngine` — que este módulo declara y **no** implementa.

---

## Límites

No implementa ningún puerto. No conoce el dataset. No trae criterio clínico: el `ContextFrame` transporta estructura, y si alguna vez transportara un umbral (*"si la temperatura supera 38.5 marcar infección"*), la frontera entre capas se habría roto.
