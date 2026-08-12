# Corpus — textos derivados (sidecars)

**Regla de ingesta:** cuando existe un `.txt` en esta carpeta con la **misma ruta relativa** que un PDF del corpus, la ingesta **usa el `.txt`** en lugar de extraer del PDF.

```
dataset/textos/Appendicitis/DOC.pdf   →   docs/corpus-texto/Appendicitis/DOC.txt
```

El `doc_id`, la trazabilidad y la cita **siguen apuntando al PDF original**. Este texto es *derivado*, igual que el índice vectorial: la fuente sigue siendo el documento (ADR-015).

---

## Por qué existe, y por qué no es OCR en runtime

Un PDF sin capa de texto no se puede ingerir. Las tres salidas eran: excluirlo, meter OCR en el arranque, o **extraerlo una vez fuera de línea y versionar el resultado**.

Se elige la tercera, por el mismo criterio que el índice preconstruido (Acta §4 D-10): **el reloj de la compuerta 2 no debe ver ningún trabajo que se pueda hacer antes**. OCR en el arranque costaría minutos por documento; aquí cuesta cero.

Y excluir habría sido peor de lo que parecía — ver abajo.

---

## Qué se encontró al medirlo, y por qué la cifra anterior estaba mal

Se había registrado que **12 de los 107 PDF no sueltan texto**. Medido con dos extractores independientes (`pypdf` y `pdftotext`), el reparto real es:

| | Cuántos | Diagnóstico | Acción |
|---|---|---|---|
| Extraen bien | **102** | — | Ninguna |
| Densidad baja (165–766 car./pág.) pero **texto real** | **4** | **No es un defecto: son guías visuales para pacientes.** Tienen poco texto por página porque están hechas de ilustraciones | **Ninguna.** Se ingieren normal |
| Sin capa de texto | **1** | Póster académico de una página, imagen JPEG única | Sidecar por OCR |

**La verificación que lo resolvió:** se OCR-eó una página de `PLAN CASERO REEMPLAZO TOTAL DE RODILLA` —uno de los de baja densidad— y dio **735 caracteres, exactamente los mismos** que la extracción directa. No había texto atrapado en imágenes: el documento simplemente tiene poco texto. OCR no aporta nada ahí.

**Por qué importa haberlo comprobado.** Tres de los cuatro documentos de baja densidad son `PLAN CASERO REEMPLAZO TOTAL DE RODILLA`, `PLAN DE CUIDADO COLECISTECTOMIA` y `Colon Cancer Surgery and Recovery` — **planes de cuidado post-operatorio dirigidos al paciente**, que es exactamente el material más pertinente del corpus para este agente. Excluirlos por una cifra no verificada habría quitado lo más on-target que hay.

---

## Sidecars presentes

| Documento | Motivo | Herramienta | Limitación declarada |
|---|---|---|---|
| `Appendicitis/REVISIÓN DE LA LITERATURA SOBRE LA APENDICITIS AGUDA PEDIATRICA…` | 1 página, imagen JPEG sin capa de texto | `pdftoppm` 300 ppp + `tesseract` 4.1.1 | **Solo modelo `eng` disponible**; el documento está en español, así que los acentos vienen degradados (*indicacién*, *quirtirgico*) y algún término puede estar mal transcrito. El texto es semánticamente legible y suficiente para recuperación, **no para cita literal** |

**Relevancia clínica del único sidecar:** es un póster de epidemiología de apendicitis **pediátrica** en Colombia. El agente atiende adultos post-operados, así que su aporte al caso de uso es bajo. Se incluye porque ya existe y no cuesta nada, no porque haga falta.

---

## Cómo añadir otro sidecar

1. Comprobar que el PDF **de verdad** no suelta texto, con **dos extractores** — un solo extractor puede fallar donde otro acierta.
2. Comprobar que OCR **aporta más** que la extracción directa. Si da lo mismo, el documento simplemente tiene poco texto y no necesita sidecar.
3. Generar el `.txt` con el encabezado de procedencia: herramienta, versión, idioma del modelo, fecha y ruta del original.
4. Declararlo en la tabla de arriba **con su limitación**.

**Ningún sidecar se genera en tiempo de ejecución.** Si aparece un PDF sin texto durante la sesión de evaluación —por ejemplo, el documento con el que el jurado prueba la compuerta 5—, la consola debe **decirlo** en vez de ingerir vacío en silencio: un documento que se acepta y no aporta nada es peor que uno rechazado con su razón.
