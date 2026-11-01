# Hallazgos a remediar (escenario complejo)

Mezcla de una vulnerabilidad de **dependencia** (se corrige con bump) y una de **código**
(se corrige editando la fuente). El objetivo es validar que el enjambre maneja ambos.

| ID | Tipo | Ubicación | Remediación esperada |
|---|---|---|---|
| GHSA-jf85-cpcp-j695 | deps | `package.json` (lodash 4.17.11) | bump mínimo que cierra el CVE |
| FINDING-CODE-01 | código | `index.js` → `listFiles()` | command injection: reemplazar `exec` con concatenación por `execFile("ls", ["-la", userDir])` (sin shell); NO es un cambio de paquete |

Nota: FINDING-CODE-01 **no** es un CVE de OSV (no lo detecta el scanner de dependencias);
es una vulnerabilidad de código que exige **editar `index.js`**.
