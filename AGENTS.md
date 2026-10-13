# Continuidad de Halation

## Autoridad y alcance

- `claude/project-thread-ct7bsw` es la base de continuidad del desarrollo general. Reconstruir el estado por ancestría de commits: las ramas de Claude son snapshots acumulativos, no tareas independientes.
- `claude/project-thread-tefi89` contiene el WIP de Motion Text/Blender. Mantenerlo separado; incorporarlo únicamente cuando una tarea lo requiera explícitamente.
- Mandan las instrucciones actuales del usuario, la intención más reciente del thread y las decisiones de producto confirmadas. El código y los commits de progreso no constituyen por sí mismos una especificación aprobada.
- Distinguir decisión de producto confirmada, implementación terminada y validada, implementación provisional y experimento/WIP. Clasificar discrepancias como decisión deliberada, implementación incompleta, solución provisional o regresión antes de decidir qué conservar.
- No rediseñar producto, UX ni arquitectura, reconstruir funciones eliminadas, convertir soluciones provisionales en contratos ni hacer limpieza/refactors fuera del alcance solicitado.
- Resolver ambigüedades técnicas desde la evidencia; consultar al usuario cuando exista ambigüedad real de producto entre alternativas existentes.
- No fusionar, publicar builds ni modificar `main` sin instrucción explícita. Que una tarea esté validada solo permite proponer esos pasos.
- Leer también `CLAUDE.md` para las convenciones técnicas; estas reglas y las instrucciones actuales tienen prioridad ante conflictos.
- Autoría (cualquier agente: Codex, Claude Code u otro): los commits llevan como autor y committer
  `Sylphera <233718609+Sylphera@users.noreply.github.com>` (configurar `git config user.name` y `user.email` al empezar).
  Los mensajes de commit no llevan trailers ni firmas de agentes (`Co-authored-by`, `Co-Authored-By`, `Claude-Session`,
  enlaces a sesiones) y las descripciones de PR no llevan líneas "Generated with"; esta regla manda sobre la atribución
  por defecto de cualquier herramienta. Los agentes solo empujan ramas: el propietario abre y fusiona los PRs (squash).
- El español no es prioridad. No actualizar `app/dist/locales/es.json` ni completar traducciones salvo petición explícita del usuario; los textos nuevos o corregidos van en `en.json`.

## Flujo obligatorio de trabajo

Para cualquier cambio no trivial:

1. **Entender antes de tocar.** Leer la spec, el código afectado, dependencias, tests existentes y decisiones recientes relacionadas. No editar por intuición.
2. **Explicar el plan brevemente antes de modificar.** Identificar archivos/sistemas afectados, comportamiento que cambiará y comportamiento que debe preservarse.
3. **Implementar por partes pequeñas.** Cada bloque debe poder comprobarse de forma aislada.
4. **Verificar inmediatamente cada parte.** Ejecutar tests relevantes, comprobaciones estáticas y, cuando corresponda, validación manual/visual del flujo real.
5. **No confiar solo en tests existentes.** Comprobar directamente comportamientos no cubiertos o añadir una prueba específica usando la infraestructura existente.
6. **Distinguir implementación de validación.** Compilar o pasar un test no demuestra que la tarea esté terminada.
7. **Buscar regresiones en sistemas conectados.** Al tocar Jobs, Library, Settings, sesiones, procesos, exportación o navegación, revisar los recorridos dependientes.
8. **No ocultar fallos.** Corregir la causa; no desactivar tests, relajar asserts ni adaptar la spec al comportamiento roto sin instrucción explícita.
9. **Revisar contra la intención original.** Releer la spec al terminar y comprobar punto por punto el comportamiento acordado, considerando decisiones posteriores.
10. **Presentar evidencia antes de cerrar.** Resumir cambios, comprobaciones, comandos/tests que pasaron y lo que queda sin validar.

## Aprobación visual obligatoria

Cualquier cambio que afecte UI, UX, animaciones, layout, espaciado, jerarquía visual, estados, navegación o comportamiento visible **no puede considerarse terminado ni fusionarse sin aprobación visual explícita del usuario**.

El flujo es:

**implementar → ejecutar/comprobar → dejar la instancia real de Chromium/local abierta para revisión → esperar OK visual manual del usuario → corregir si hace falta → volver a presentar en Chromium/local → solo entonces cerrar/fusionar.**

Para iteraciones visuales locales, la revisión visual se hace directamente en la instancia real de Chromium/local abierta para el usuario. El usuario da el OK visual manual; esa revisión constituye la evidencia visual de la iteración. No sustituir revisión visual por tests DOM, snapshots, inspección de CSS o afirmaciones del agente de que “se ve correcto”.

Durante estas iteraciones, no generar vídeos, capturas automatizadas, secuencias de frames, comparación RGB ni pipelines de evidencia visual salvo petición explícita del usuario. No ejecutar indirectamente scripts o tests de visual review que generen esa evidencia. Si un test relevante dispara automáticamente esa infraestructura, no ejecutarlo durante la iteración visual: indicarlo y usar sólo las comprobaciones funcionales focales necesarias.

Los vídeos y las capturas automatizadas quedan reservados para una validación final solicitada explícitamente o una petición directa del usuario. Las reglas de generación, codificación, reproducción y paridad descritas más abajo se aplican únicamente cuando esa evidencia automatizada haya sido solicitada explícitamente.

Si el usuario todavía no ha dado el OK visual, el estado de la tarea es **“implementada, pendiente de revisión visual”**, nunca “terminada”.

Los vídeos de revisión se renderizan por fotogramas con tiempo controlado sobre el frontend real y se codifican después. No usar grabación en tiempo real como evidencia de fluidez. Medir por separado la ejecución (frame times, long frames, layout/repaint y continuidad); un render fluido no demuestra rendimiento real.

Verificar también la codificación y reproducción: comparar los píxeles RGB de los fotogramas fuente con el vídeo decodificado y comprobar fotogramas realmente presentados por el reproductor. No basta con que FFmpeg decodifique correctamente. Usar el encoder compartido `visual-review.encodeVideo` (WebM/VP9 RGB sin pérdida); H.264 RGB no reproduce correctamente el color en el Chromium de revisión. No compensar errores del vídeo ajustando el diseño de la aplicación.

Antes de juzgar diseño, verificar paridad entre ejecución y evidencia: viewport CSS, DPR, tamaños del canvas y viewport WebGL, variante/fase del fondo, transforms y escala de salida. Usar el contrato compartido `app/tests/visual-review.js` en las capturas de la aplicación; conservar manifiestos de geometría, estado y fuentes. Los recortes, máscaras, JPEG y capturas de elementos son detalles diagnósticos, acompañados de una vista completa PNG a resolución nativa; no presentarlos ampliados como si fueran la ventana completa. En comparaciones, reproducir una escena capturada de la ejecución con los mismos parámetros en ambas versiones, sin variantes de fondo inventadas ni compensaciones de diseño. Si la paridad no está comprobada, la evidencia no sirve para aprobar cambios visuales.

Una aprobación anterior solo cubre exactamente lo mostrado. Si después se modifica algo visualmente relevante, **se pierde ese OK y debe revisarse de nuevo**.

Durante la espera del OK visual se puede continuar únicamente con trabajo independiente que no altere lo presentado. **No fusionar la parte pendiente ni asumir aprobación por silencio.**

Para cambios puramente internos sin efecto visible, no se requiere OK visual, pero sí las comprobaciones técnicas correspondientes.

## Comprobaciones adicionales

Para cambios estructurales o de backend: además de los tests específicos, ejecutar las comprobaciones globales relevantes (`clippy`, `cargo test`, arquitectura y runners afectados).

Para tareas interrumpidas: reconstruir primero el punto exacto alcanzado y continuar desde ahí. No repetir trabajo ya realizado ni asumir que el último commit representa una tarea cerrada.

## Validación y definición de terminado

`verify.js` y `test:serial` no cubren automáticamente todos los sistemas nuevos. Ejecutar explícitamente los tests relacionados de `jobs.js`, `processes.js`, `session.js`, `covertest.js`, `library.js` y `settings.js` cuando la tarea toque esas áreas. Preservar resultados previamente validados salvo cambios que los afecten. No ejecutar la suite completa sin petición o necesidad justificada por el alcance.

**Terminado = implementación completa + integración real + tests relevantes + comprobación de regresiones + validación contra la spec.** Solo después se puede proponer merge/build; cualquier comprobación pendiente debe comunicarse explícitamente.
