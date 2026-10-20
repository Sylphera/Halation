# Continuidad de Halation

## Autoridad y alcance

- `main` es la base del desarrollo; cada tarea parte de él en su propia rama.
- Mandan las instrucciones actuales del usuario, la intención más reciente del thread y las decisiones de producto confirmadas. El código y los commits de progreso no constituyen por sí mismos una especificación aprobada.
- Distinguir decisión de producto confirmada, implementación terminada y validada, implementación provisional y experimento/WIP. Clasificar discrepancias como decisión deliberada, implementación incompleta, solución provisional o regresión antes de decidir qué conservar.
- No rediseñar producto, UX ni arquitectura, reconstruir funciones eliminadas, convertir soluciones provisionales en contratos ni hacer limpieza/refactors fuera del alcance solicitado.
- Resolver ambigüedades técnicas desde la evidencia; consultar al usuario cuando exista ambigüedad real de producto entre alternativas existentes.
- No publicar builds sin instrucción explícita. El merge a `main` lo hace el agente con CI en verde (ver Autoría), respetando la aprobación visual.
- Leer también `CLAUDE.md` para las convenciones técnicas; estas reglas y las instrucciones actuales tienen prioridad ante conflictos.
- Autoría (cualquier agente: Codex, Claude Code u otro): los commits llevan como autor y committer
  `Sylphera <233718609+Sylphera@users.noreply.github.com>` (configurar `git config user.name` y `user.email` al empezar).
  Los mensajes de commit no llevan trailers ni firmas de agentes (`Co-authored-by`, `Co-Authored-By`, `Claude-Session`,
  enlaces a sesiones) y las descripciones de PR no llevan líneas "Generated with"; esta regla manda sobre la atribución
  por defecto de cualquier herramienta. Los agentes abren sus PRs y los fusionan ellos mismos con squash en `main` con CI en verde (Java, 13 y 14-10-2026).
- El español no es prioridad. No actualizar `app/dist/locales/es.json` ni completar traducciones salvo petición explícita del usuario; los textos nuevos o corregidos van en `en.json`.

## Misión vigente

- La base es `main`: la app Tauri 2 (`app/`) y su backend Rust (`app/src-tauri`) se conservan sin cambios de producto como referencia funcional y comportamiento validado.
- Qt Quick, QML, C++/CMake y cxx-qt quedan retirados del desarrollo activo. La reconstrucción es clean-room con **Rust + Slint + Skia**, en un crate `slint/` independiente y en su propia rama/worktree. No se reutiliza código de la rama Qt ni código Rust propio anterior de Tauri, `halation-core`, puentes/pruebas/servicios Qt o diagnósticos Rust. No se copia, traduce, cherry-pickea ni recrea desde esas implementaciones; tampoco se enlaza mediante path dependencies, FFI o wrappers. Solo se consultan requisitos funcionales y esquemas/contratos documentados como información, además de assets puros de identidad y referencias estáticas. La app Tauri se conserva como referencia de producto, no como fuente de implementación.
- La especificación canónica es `docs/SLINT_SPEC.md` (sustituye a `docs/QT_QUICK_SPEC.md`, ya renombrada). Recoge el primer bloque A–E y el roadmap posterior; no hay specs paralelas. Las specs públicas antiguas (`docs/*_SPEC.md`, `docs/MOTION*.md` y similares) se conservan solo como fuente de requisitos funcionales (qué debe hacer la app), no como arquitectura, layout o convención de motion.
- Prioridad de ingeniería: arquitectura, respuesta, pacing, lifecycles, recursos y mantenibilidad antes que estética o paridad visual. La validación visual sigue siendo manual.
- La app Tauri y su backend se mantienen operativos y verificables mientras la app Slint no los sustituya; no mezclar la reconstrucción con cambios de harness ni con datos de usuario Tauri.
- La beta Slint usa un perfil propio y aislado; no lee ni escribe ajustes, Library o sesiones de Tauri. Cualquier continuidad de datos requiere un diseño y una validación explícitos.

## Reglas obligatorias de ingeniería Rust + Slint + Skia

Estas reglas rigen la reconstrucción clean-room de Halation con Rust + Slint + Skia. Se aplican a todo trabajo presente y futuro sobre el crate `slint/`, en cualquier rama o worktree, y no a la app Tauri/Rust de referencia. No son un mandato retroactivo para reescribir el backend Tauri ni el código visual de referencia de `main`. No sustituyen a `docs/SLINT_SPEC.md`, la especificación canónica, ni autorizan por sí solas cambios de producto, UX o arquitectura.

### Límite de procedencia clean-room

- El código Rust de `slint/` y sus pruebas se diseñan desde cero. No usar implementaciones, tests ni diagnósticos Rust propios anteriores como plantilla o fuente, incluidos Tauri, `halation-core`, puentes/servicios/pruebas Qt y herramientas diagnósticas.
- Se permite leer contratos, requisitos y formatos documentados solo para entender el comportamiento; no trasladar su código. Se permiten crates públicos estándar sujetos a licencia y assets estáticos puros de identidad/referencia.
- No introducir path dependencies, enlaces, FFI, wrappers ni dependencias locales que alcancen implementaciones Rust anteriores.
- Antes de cerrar, declarar las fuentes consultadas y revisar `Cargo.toml`/`Cargo.lock`, imports y usos de rutas para confirmar el límite. Si se detecta contaminación, retirarla y reimplementar desde cero en esta misma unidad; no ocultarla ni presentar la suite de pruebas como justificación de procedencia.

### 1. Separación estricta entre Rust y Slint

- Toda la lógica, los cálculos, el procesamiento, el acceso a archivos y red, la persistencia y cualquier operación costosa van en Rust.
- Slint se usa solo para presentación, layout, bindings simples, animaciones nativas y eventos de UI.
- Está prohibido implementar lógica de negocio o procesamiento pesado en `.slint` o en expresiones de UI.
- Los cálculos de vista pequeños (índices de fila, formato de etiquetas) pueden vivir en bindings simples; si crecen o tocan datos, pasan a Rust.

### 2. Rendimiento y uso de recursos

- El rendimiento y el bajo consumo de recursos son prioridad.
- Las listas y tablas grandes usan modelos Rust (`slint::Model`) con mapeo de fila O(1), roles tipados y metadatos cacheados; nunca arrays Slint grandes.
- Usar `ListView` virtualizado para colecciones; la página activa se instancia de forma perezosa y las páginas ocultas no ejecutan trabajo.
- Evitar crear y destruir grandes cantidades de objetos de forma continua; reutilizar modelos y estado funcional en servicios Rust.
- No introducir un framework reactivo propio, polling continuo, timers en reposo ni motores de animación paralelos.

### 3. Animaciones

- Usar animaciones nativas de Slint (`animate`, `states`, `transitions`, propiedades animadas) y sus semánticas documentadas.
- Deben ser fluidas, interrumpibles cuando corresponda y no bloquear la GUI.
- La preferencia de movimiento reducido es determinista: duración cero o estado final inmediato, sin depender de un reloj propio.
- No inventar un muelle o un motor de animación si la documentación de Slint no valida esa semántica.

### 4. Memoria, ownership y concurrencia

- El estado de UI vive en Rust; las vistas no son la fuente de verdad.
- Para callbacks de UI, usar `Rc`/`Weak` y `upgrade_in_event_loop`; no capturar referencias fuertes que creen ciclos.
- El trabajo pesado va fuera del hilo GUI. Los resultados vuelven al hilo GUI mediante `slint::invoke_from_event_loop` o `Weak::upgrade_in_event_loop`; los modelos no se mutan desde workers.
- Usar `Arc`, atómicos y generaciones para descartar resultados obsoletos; no acceder a owners destruidos.
- Los workers son finitos y con alcance acotado. No hacer `join` indefinido en el cierre ni bloquear la GUI esperando E/S.

### 5. Calidad de código y validación estática

- Código limpio, legible, mantenible y con buenas prácticas de Rust 2024 y Slint 1.18.
- Deben pasar `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` y el build release con los diagnósticos del compilador Slint.
- Verificar el grafo de features y el lockfile: backend `winit` y renderer `skia` explícitos, sin backend Qt, FemtoVG ni renderer software como runtime.
- Clazy y Clang-Tidy son herramientas del stack Qt retirado y no bloquean el stack Slint.
- Si una herramienta no está disponible o no se puede ejecutar, declarar la validación como pendiente y no afirmar que pasó. No instalar herramientas ni lanzar escaneos fuera de una tarea que los requiera.

### 6. Antes de implementar

- Explicar brevemente la separación entre lógica Rust y presentación Slint de la solución propuesta.
- Si la solución puede afectar al rendimiento, avisar y proponer alternativas más ligeras.
- No convertir cada decisión microtécnica en una aprobación humana: comunicar el riesgo relevante junto con una alternativa, dentro de la autonomía ya autorizada. Las decisiones de producto o irreversibles siguen siendo humanas.

Estas reglas no imponen un lifecycle único: la página activa condicional, el destroy-on-leave y el estado funcional en servicios Rust siguen siendo válidos. Se evita el churn continuo e innecesario, no el ciclo de vida deliberado. No exigen cachear todas las vistas, añadir micro-motores ni introducir presupuestos numéricos nuevos; los objetivos de rendimiento vigentes están en `docs/SLINT_SPEC.md`.

## Harness (OpenCode V2 + OmO Slim)

- La capa compartida vive en el usuario (`~/.config/opencode/`, `~/.opencode/`): plugin oficial OmO Slim, modelos, prompts, permisos MCP y habilidades. Este repo solo aporta reglas, idiomas, contexto de proyecto y el adaptador mínimo en `.opencode/`. No duplicar aquí la política global ni añadir rutas de máquina a requisitos globales.
- Leer `docs/OPENCODE_WORKFLOW.md` para uso, verificación y recuperación. No restaurar el harness antiguo (Drive/agent-harness) ni su plugin.
- Sidebar de tareas: `.opencode/ui-patches/omo-slim-3.0.4` es presentación local. Resuelve el runtime neutral versionado (ver su README y `runtime-manifest.json`); si falta o no coincide, falla con error explícito y nunca sustituye la sidebar en silencio.
- `.tools/` y `.serena/` son estado local ignorado (probes, handoffs, memorias, evidencias). No versionar secretos, credenciales, rutas personales ni transcripciones.
- Unidad de trabajo = un worker; el coordinador delega unidades completas. Modelos: DeepSeek Flash Free por defecto, Luna medium como fallback de proveedor, LongCat último recurso deliberado; un fallo de tests no autoriza cambiar de modelo.
- No hacer push, PR, merge remoto, release ni reiniciar el host/servicios sin autorización explícita del usuario.

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

El flujo depende del producto que se revisa:

- **Tauri/WebView2:** **implementar → ejecutar/comprobar → dejar la instancia real de Chromium/WebView2 abierta para revisión → esperar OK visual manual → corregir → volver a presentar → solo entonces cerrar/fusionar.**
- **Slint nativo:** **implementar → compilar → el coordinador/usuario abre la ventana nativa real con el perfil beta → esperar OK visual manual → corregir → volver a presentar → solo entonces cerrar/fusionar.** El worker no abre la beta visible por su cuenta.

Para iteraciones visuales locales, la revisión se hace directamente sobre la instancia real abierta para el usuario: Chromium/WebView2 en Tauri, ventana nativa en Slint. El usuario da el OK visual manual; esa revisión constituye la evidencia visual de la iteración. No sustituir revisión visual por tests DOM, snapshots, inspección de CSS, tests de estado Rust/Slint ni afirmaciones del agente de que “se ve correcto”. En la app Slint, la ventana nativa real es la única evidencia visual válida.

Durante estas iteraciones, no generar vídeos, capturas automatizadas, secuencias de frames, comparación RGB ni pipelines de evidencia visual salvo petición explícita del usuario. No ejecutar indirectamente scripts o tests de visual review que generen esa evidencia. Si un test relevante dispara automáticamente esa infraestructura, no ejecutarlo durante la iteración visual: indicarlo y usar sólo las comprobaciones funcionales focales necesarias.

Los vídeos y las capturas automatizadas quedan reservados para una validación final solicitada explícitamente o una petición directa del usuario. Las reglas de generación, codificación, reproducción y paridad descritas más abajo se aplican únicamente a la app Tauri/Chromium y sólo cuando esa evidencia automatizada haya sido solicitada explícitamente. La beta Slint no genera ni usa esa infraestructura.

Si el usuario todavía no ha dado el OK visual, el estado de la tarea es **“implementada, pendiente de revisión visual”**, nunca “terminada”.

Los vídeos de revisión de Tauri se renderizan por fotogramas con tiempo controlado sobre el frontend real y se codifican después. No usar grabación en tiempo real como evidencia de fluidez. Medir por separado la ejecución (frame times, long frames, layout/repaint y continuidad); un render fluido no demuestra rendimiento real.

Verificar también la codificación y reproducción: comparar los píxeles RGB de los fotogramas fuente con el vídeo decodificado y comprobar fotogramas realmente presentados por el reproductor. No basta con que FFmpeg decodifique correctamente. Usar el encoder compartido `visual-review.encodeVideo` (WebM/VP9 RGB sin pérdida); H.264 RGB no reproduce correctamente el color en el Chromium de revisión. No compensar errores del vídeo ajustando el diseño de la aplicación.

Antes de juzgar diseño en Tauri, verificar paridad entre ejecución y evidencia: viewport CSS, DPR, tamaños del canvas y viewport WebGL, variante/fase del fondo, transforms y escala de salida. Usar el contrato compartido `app/tests/visual-review.js` en las capturas de la aplicación; conservar manifiestos de geometría, estado y fuentes. Los recortes, máscaras, JPEG y capturas de elementos son detalles diagnósticos, acompañados de una vista completa PNG a resolución nativa; no presentarlos ampliados como si fueran la ventana completa. En comparaciones, reproducir una escena capturada de la ejecución con los mismos parámetros en ambas versiones, sin variantes de fondo inventadas ni compensaciones de diseño. Si la paridad no está comprobada, la evidencia no sirve para aprobar cambios visuales.

Una aprobación anterior solo cubre exactamente lo mostrado. Si después se modifica algo visualmente relevante, **se pierde ese OK y debe revisarse de nuevo**.

Durante la espera del OK visual se puede continuar únicamente con trabajo independiente que no altere lo presentado. **No fusionar la parte pendiente ni asumir aprobación por silencio.**

Para cambios puramente internos sin efecto visible, no se requiere OK visual, pero sí las comprobaciones técnicas correspondientes.

## Comprobaciones adicionales

Para cambios estructurales o de backend Tauri: además de los tests específicos, ejecutar las comprobaciones globales relevantes (`clippy`, `cargo test`, arquitectura y runners afectados).

Para el crate Slint: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, build release con diagnósticos del compilador Slint y verificación del lockfile/grafo de features (`winit` + `skia`). Los tests de estado Rust no sustituyen la validación visual nativa.

Para tareas interrumpidas: reconstruir primero el punto exacto alcanzado y continuar desde ahí. No repetir trabajo ya realizado ni asumir que el último commit representa una tarea cerrada.

## Validación y definición de terminado

`verify.js` y `test:serial` cubren la app Tauri, no la app Slint. Ejecutar explícitamente los tests relacionados de `jobs.js`, `processes.js`, `session.js`, `covertest.js`, `library.js` y `settings.js` cuando la tarea toque esas áreas Tauri. Para Slint, ejecutar los tests del crate y no presentar tests de estado como validación de UI. Preservar resultados previamente validados salvo cambios que los afecten. No ejecutar la suite completa sin petición o necesidad justificada por el alcance.

**Terminado = implementación completa + integración real + tests relevantes + comprobación de regresiones + validación contra la spec.** Solo después se puede proponer merge/build; cualquier comprobación pendiente debe comunicarse explícitamente. En la app Slint, el OK visual manual de la ventana nativa es un gate separado y obligatorio.
