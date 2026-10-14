# Halation en Qt Quick — Especificación (propuesta, revisión 2)

Pasar la interfaz entera de Tauri 2 + WebView2 (HTML/JS/CSS en `app/dist`) a Qt Quick (QML), manteniendo el backend
Rust, los datos del usuario y el canal de actualizaciones. Idea de Java: 2026-10-13. Propuesta sin código: ninguna
fase se lanza hasta que Java apruebe esta spec. **[C]** comprobado en el repo (`main` 89839f3) · **[I]** inferido o
estimado, a medir en la fase 0.

Cambios de la revisión 2 (aclaraciones de Java, 2026-10-13): motivo de la migración (§0.1), criterio general (§0.2),
fase 0 limitada a una preview de Home con métricas comparadas (§11.1), sin edición portable y NSIS como único instalador
(§9), estimaciones como tamaño relativo y no calendario (§13), Visualizer empieza por QPainter sin tratarse como fase
cara (§7).

Nota (2026-10-14): escrita en Halation-source antes de abrir el código; los hashes **[C]** son de aquel repo. Desde
entonces el repo es público (GPL-3.0-or-later) y solo publica el setup NSIS, como ya pide §9.

---

## 0. Principios

1. **El backend se queda.** El Rust actual (`app/src-tauri/src`) es la parte más reutilizable; se separa de Tauri y
   se conecta a QML. No se reescribe en otro lenguaje.
2. **Los datos del usuario no se tocan.** `Documents\Halation`, `Settings\app.json`, el índice de la Library, presets,
   looks, sesiones, `Tools\` y cachés conservan formato y ruta. La versión Qt lee lo que dejó la Tauri.
3. **Paridad antes de publicar.** La app Qt se construye al lado de la actual y solo sustituye a la release cuando
   cumple §13. Mientras tanto la línea Tauri sigue siendo la que se publica.
4. **Un solo lenguaje de lógica pesada.** Rust para todo lo que calcula; QML solo para vista y estado de vista; C++
   solo donde Qt no se alcanza desde Rust (elementos GPU propios).
5. **Las reglas de diseño no cambian.** Tokens de color, el muelle críticamente amortiguado, skeletons y el
   comportamiento de cada herramienta se trasladan; no es un rediseño.

### 0.1 Motivo

La interfaz actual funciona bien y, tras la optimización de la 1.1.1, no hay una necesidad urgente de cambiarla por
rendimiento básico. El objetivo es reducir la complejidad estructural. Hoy un problema puede atravesar DOM y CSS,
layout y painting de Chromium, el compositor de WebView2, Canvas/WebGL/WebGPU, workers, iframes, Web Audio, IPC,
eventos de Tauri, Rust y procesos externos, cada capa con su ciclo de vida. Un fallo no rompe nada visible: añade
trabajo, mantiene vivo un recurso, provoca otra composición, un polling o una copia de memoria, y el coste aparece al
sumarse. En la optimización de Halation pasó varias veces: muchas causas pequeñas e independientes, ninguna grande.

Qt Quick no elimina esos problemas (bindings mal planteados, texturas sin liberar, animaciones de más, errores de
ciclo de vida), pero los acerca a su causa: un elemento que se actualiza continuamente es ese elemento; una textura
viva tiene un propietario; un shader se mide directamente; una vista oculta que trabaja tiene una ruta concreta. La
interfaz se concentra en un único scene graph conectado directamente al backend. La ventaja buscada no es "Qt consume
menos que WebView2", sino que Halation deje de depender de varias arquitecturas superpuestas para una única interfaz,
de modo que una degradación sea más fácil de localizar, reproducir y corregir.

### 0.2 Criterio general

- Cada pieza se implementa primero de la forma más directa que permita Qt; después: implementar → observar → medir →
  corregir. No se añaden capas para problemas que todavía no se han observado.
- La versión Qt no hereda los rodeos que WebView2 obligó a hacer en la versión Tauri (presupuesto de render,
  descarga de iframes, transporte por trozos, límites de memoria de WebView2…): cada uno vuelve solo si una medida
  lo pide.
- La migración solo merece la pena si Halation termina siendo más fácil de razonar, no si cambia un conjunto complejo
  de tecnologías por otro.

---

## 1. Qué hay hoy (inventario)

### 1.1 Tamaño [C]

| Parte | Archivos | Líneas |
|---|---|---|
| Interfaz propia (`app/dist/*.js` sin vendored ni el bundle de `atmosphere.js`) | ~55 | ~20 500 |
| CSS / HTML | 18 / 13 | ~2 600 / ~1 500 |
| Textos (`locales/en.json`) | 1 | ~2 380 claves |
| Backend Rust (`app/src-tauri/src`) | 29 módulos, 131 comandos | ~9 500 |
| Tests (Playwright + `host.js` + cargo) | ~120 | ~12 600 |
| Vendored (GSAP, Flip, Mediabunny, onnxruntime-web, React del fondo) | — | no se migra |

### 1.2 Pantallas y piezas compartidas [C]

- **Ventana principal** (`index.html`, `shell.js`, `shell.css`): dock/rail, Home (barra de herramientas, zona de
  soltar, recientes), Library (página v2), Settings (una página con pestañas de sección), bienvenida (primer
  arranque, perfiles "Are these yours?"), cierre con trabajos activos.
- **Isla de procesos** (`processes.js`) y **trabajos** (`jobs.js`: carriles gpu/cpu/net/light, prioridades, coste
  medido).
- **Actualizador** (`updates.js` + `update.rs`), **sesiones** (`sessions.js` + `sessions.rs`).
- **Diálogos compartidos** (`services.js`): Crop, Cutout, selector de Library (`libpanel.js`), "Send to…",
  comparador (`compare.js`), fontpicker.
- **Fondo** (`atmosphere.js` + `auralis-renderer.js`): Auralis en WebGL1 (React + shader) en Home y escena del worker
  en las herramientas, con presupuesto de render (`render-budget.js`).
- **Movimiento** (`motion.js`): GSAP + Flip, un muelle, cuatro tokens (`docs/MOTION.md`).

### 1.3 Herramientas (un iframe cada una) [C]

| Herramienta | Archivo | Cómo pinta / procesa hoy | Motor |
|---|---|---|---|
| Audio Visualizer | `visualizer.js` (2 221) | Canvas 2D; export por capas en canvas CPU → IPC → FFmpeg; vídeo único con WebCodecs + Mediabunny | FFmpeg, WebCodecs |
| Grade | `grade.js` (1 439), `grader.js`, `grade-color.js` | WebGL2: pila de pasadas, LUT 3D, texto; miniaturas con PBO | GPU del WebView |
| Frame Capture | `framegrab.js` (1 260) | Canvas 2D; WebCodecs sobre paquetes de Mediabunny, FFmpeg de respaldo | WebCodecs, FFmpeg |
| Downloader | `downloader.js` (599), `spotify.js` | DOM | yt-dlp, FFmpeg |
| Converter | `convert.js` (661) + `convert.rs` (2 103) | DOM; vista previa con `<video>` / Web Audio | FFmpeg, image, PDFium, LibreOffice, Pandoc |
| Vocal Remover | `stems.js` (737) + `stems.rs` (1 764) | DOM + Web Audio (mezclador) | ONNX Runtime nativo + DirectML (Rust) |
| Background Remover | `removebg.js` (798) + Cutout en `services.js` | Canvas 2D | SAM 2.1 en ONNX Runtime **Web** (WebGPU / wasm) |
| Image Upscale | `upscale.js` (838) | DOM | upscayl-bin |
| AI Interpolate | `interp.js` (600) + `interp.rs` | DOM + `<video>` | rife-ncnn-vulkan, FFmpeg |
| Cover Test | `covertest.js` (956) + `covertest.css` (685) | Réplicas HTML/CSS de YouTube/Spotify/SoundCloud; export DOM → SVG → PNG | — |

### 1.4 Packaging y distribución [C]

- NSIS de Tauri con plantilla propia (`windows/installer.nsi`, `hooks.nsh`), instalación por usuario, inglés y
  español, `/P /UPDATE` y `/R` para el actualizador.
- Ejecutable portable: el mismo `halation.exe` de un solo archivo (WebView2 del sistema). Setup + portable de la
  v1.1.0: ~15 MB los cuatro assets.
- Paquete de identidad MSIX disperso (`windows/identity`): solo agrupa los procesos de WebView2 en el Administrador de
  tareas.
- Actualizador: `tauri-plugin-updater`, `latest.json` firmado con minisign en la release pública, clave en los
  secretos de Actions.
- CI (`.github/workflows/build.yml`): build en Windows, setup + portable + `.sig` + `latest.json`.

### 1.5 Acoplamiento del Rust con Tauri [C]

Todos los módulos usan tipos de Tauri (`AppHandle`, `Window`, `emit`, `State`,
`#[tauri::command]`): 7–36 referencias por archivo. La lógica está debajo de esa capa; el acoplamiento está en
firmas, eventos de progreso y rutas de la app. `window.rs`, `update.rs`, `main.rs` y parte de `system.rs` son
específicos de Tauri/WebView2.

---

## 2. Qué se reutiliza y qué se reescribe

| Pieza | Destino | Notas |
|---|---|---|
| Lógica Rust (convert, stems, library, workspace, tools, download, procs, encode, framegrab, storage, profile, presets, state, sessions, migrate, paths, outfiles, files, assets, web) | **Reutilizar** | Se saca a un crate `halation-core` sin Tauri; los comandos pasan a métodos de objetos Qt. |
| `window.rs`, `main.rs`, `update.rs`, WebView2 en `system.rs` | **Reescribir** | Ciclo de vida, cierre, memoria y actualizador sin Tauri. |
| Single instance, notificaciones, barra de tareas | **Reescribir pequeño** | Mutex con nombre + tubería; `tauri-winrt-notification` sirve sin Tauri [I]; `ITaskbarList3` ya está en `windows-sys`. |
| Diálogos de archivo (`rfd`) | **Reutilizar** o QML `FileDialog` | `rfd` necesita el HWND de la ventana Qt. |
| Lógica pura JS: `grade-color.js` (LUT byte a byte), scoring de `spotify.js`, lectores de `profile.js`, tabla de `encoder.js`, planificador de `jobs.js` | **Portar a Rust** | Con vectores de prueba de los tests actuales (`grader-lut-baseline.json`). El JS de QML (V4) podría ejecutarlos, pero más lento y sin `cargo test`. |
| Vistas (DOM + CSS) de todas las pantallas | **Reescribir en QML** | ~4 000 líneas de HTML/CSS y la parte de vista de ~20 000 de JS. |
| Grade (WebGL2) | **Reescribir** | Shaders GLSL → GLSL 440 compilados con `qsb` (RHI: D3D11 en Windows); pila multipasada en un `QQuickRhiItem` (C++). |
| Fondo Auralis / escena de herramientas | **Reescribir** | `ShaderEffect` con el mismo shader; el presupuesto de render se simplifica (sin WebView2 ni workers). |
| Visualizer (Canvas 2D) | **Reescribir** | `QPainter` sobre `QImage` (mismo modelo CPU que hoy: decisión "Layers render on CPU canvases"); preview por `QQuickPaintedItem`. |
| Export de vídeo único (WebCodecs + Mediabunny) | **Sustituir** | Por la ruta FFmpeg de `encode.rs` (ya en ROADMAP: "Single-video export through FFmpeg too"). |
| Frame Capture (WebCodecs) | **Sustituir** | Decodificación en Rust con FFmpeg (ya existe el extractor) o `QMediaPlayer`/`QVideoSink` para la vista; frame exacto siempre por FFmpeg. |
| Cutout / Background Remover (onnxruntime-web, WebGPU) | **Sustituir** | Por ONNX Runtime nativo con DirectML desde Rust (`ort`, igual que `stems.rs`); mismos modelos SAM 2.1. |
| Audio (Web Audio en Visualizer, Converter, Vocal Remover, `avplay.js`) | **Reescribir** | `QtMultimedia` (`QAudioSink`/`QMediaPlayer`) o reproducción en Rust (`cpal`); el mezclador de stems necesita ganancias por pista en tiempo real → Rust. |
| Cover Test | **Reescribir** | Réplicas de plataformas en QML; export con `grabToImage`. Es la herramienta con más vista y menos lógica. |
| Movimiento (`motion.js`) | **Reescribir** | `SpringAnimation`/`Behavior` y transiciones de `ListView`/`Repeater`; los tokens de `MOTION.md` pasan a un singleton QML. |
| `tokens.css` | **Reescribir** | Singleton QML `Tokens` generado desde el mismo origen para que no diverjan durante la transición. |
| i18n (`en.json`, `es.json`, `t()`) | **Reutilizar** | Mismos JSON y misma regla de CLAUDE.md; `t()` expuesto a QML. No se adopta Qt Linguist. |
| Tests Playwright + `host.js` | **Reescribir** | Ver §10. |
| Portable | **Eliminar** | Un único instalador (§9). |
| NSIS | **Adaptar** | Único instalador (§9.1). |
| Firma del actualizador, `latest.json`, CI | **Adaptar** | Ver §9. |

---

## 3. Unir QML con el backend: opciones

| Criterio | A. cxx-qt sobre el Rust actual | B. C++ | C. Python / PySide6 |
|---|---|---|---|
| Reutiliza los ~9 500 líneas de Rust y `ort`/DirectML | Sí, casi entero | Solo vía FFI manual (crate `cxx`) o reescritura | Solo vía PyO3 (tercer lenguaje) |
| Lenguajes en el repo | Rust + QML + algo de C++ | C++ + QML (+ Rust si se mantiene) | Python + QML (+ Rust) |
| Acceso a APIs de Qt | `QObject`, propiedades, señales, modelos; QRhi y elementos GPU propios requieren C++ | Total | Casi total (PySide6) |
| Madurez | KDAB, MIT/Apache, aún 0.x: la API cambia entre versiones [I] | Máxima | Alta |
| Build en Windows | cargo + Qt + MSVC; integración por `cxx-qt-build` | CMake + Qt | Nuitka/PyInstaller |
| Tamaño añadido sobre Qt | ~0 | ~0 | +40–80 MB de runtime Python [I] |
| Arranque y memoria | Nativo | Nativo | Intérprete + PySide: más lento [I] |
| Falsos positivos de antivirus | Como hoy | Como hoy | Frecuentes con ejecutables empaquetados de Python [I] |
| Tests | `cargo test` + Qt Quick Test | Qt Test + Qt Quick Test | pytest + Qt Quick Test |
| Conocimiento disponible para los threads | Menor (pocos ejemplos públicos) | El mayor | Alto |

**Recomendación: A, cxx-qt sobre el Rust actual**, con una capa C++ pequeña y acotada (`app/qt/cpp/`) solo para los
elementos GPU (`QQuickRhiItem` de Grade) y lo que cxx-qt no envuelva. Motivo: el backend es lo único que ya está
probado en producción (Converter, Vocal Remover, Library, workspace) y A lo conserva entero; B obliga a reescribirlo
o a mantener un FFI hecho a mano; C añade un runtime y un lenguaje sin quitar ninguno.
Coste de A: cxx-qt es 0.x, así que se fija la versión exacta y se aísla en un crate puente (`halation-qt`) para que
un cambio de su API toque un solo sitio.

---

## 4. Distribución

### 4.1 Repositorio

```
app/
  core/            crate halation-core: la lógica de src-tauri/src sin tipos de Tauri (fase 1)
  src-tauri/       la app actual, ahora una capa fina sobre halation-core (sigue publicándose)
  qt/
    Cargo.toml     crate halation-qt: binario, puentes cxx-qt (un módulo por área, como hoy)
    cpp/           C++ mínimo: elementos RHI (Grade), utilidades sin envoltorio en cxx-qt
    qml/
      Main.qml     ventana, dock, vistas
      tokens/      Tokens.qml, Motion.qml (singletons)
      shell/       Home, Library, Settings, Welcome, Island, Activity
      shared/      Crop, Cutout, LibraryPanel, SendTo, Compare, FontPicker, controles (slider con valor tecleable, scrubber, segmented)
      tools/       Visualizer, Grade, FrameGrab, Downloader, Convert, Stems, RemoveBg, Upscale, Interp, CoverTest
    shaders/       .frag/.vert GLSL 440 → .qsb en build
    tests/         Qt Quick Test + capturas
  dist/locales/    en.json, es.json (compartidos por las dos apps durante la transición)
```

Las dos apps comparten `halation-core`, `locales/` y los datos en disco; no comparten interfaz.

### 4.2 Ventana

Misma estructura que hoy: barra de título nativa, dock a la izquierda, una vista a la vez (Home, herramienta,
Library, Settings), isla de procesos arriba. Cada herramienta es un componente cargado con `Loader` (equivale al
iframe: se carga al abrirla o al pasar el ratón por su icono, se descarga tras `UNLOAD_MS` si está ociosa). El
aislamiento entre herramientas pasa de iframes a componentes con su propio objeto de estado.

---

## 5. Modelo de datos

- **Disco:** sin cambios. `app.json` (claves y migración de `migrateSettings`), `Settings\Library\index.json`,
  presets, looks, sesiones, `Tools\`, `Exports\`, cachés. La fase 1 añade tests que leen los archivos que escribe
  la app Tauri y los vuelven a escribir idénticos.
- **Estado compartido** (hoy `window.__hal`, `window.__shell`): objetos Rust expuestos a QML como singletons
  (`Settings`, `Library`, `Jobs`, `Tools`, `Updates`, `Session`), con propiedades notificables y señales de
  progreso en lugar de eventos `emit`.
- **Listas grandes** (Library, cola de trabajos, Converter, Downloader): `QAbstractListModel` implementado en Rust;
  QML solo dibuja.
- **Estado de cada herramienta** (hoy `V`, `G`, `R`, `C`, `Q`): un `QtObject`/objeto Rust por herramienta; el
  `payload` de sesión conserva su formato JSON para que una sesión guardada por la app Tauri se recupere.
- **API entre herramientas** (`__halApp`, `accepts`/`gives`, "Send to…", round trip de Frame Capture): un registro
  de módulos en Rust con los mismos `id`, `deps`, `accepts`, `gives` de `modules.js`.

---

## 6. Parámetros (valores por defecto)

| Parámetro | Valor | Nota |
|---|---|---|
| Qt | 6.8 LTS o la 6.x estable más reciente al empezar la fase 0, versión exacta fijada | Solo módulos LGPL (§8) |
| cxx-qt | última 0.x al empezar, versión exacta (`=`) | Actualizar solo en un commit propio |
| Backend gráfico | RHI D3D11 en Windows; `software` de respaldo si falla | `QSG_RHI_BACKEND` solo para pruebas |
| ONNX Runtime nativo | el de `stems.rs` (API 24, DirectML, carga dinámica) | Cutout pasa a usarlo |
| Ventana | 1480 × 940, mínimo 960 × 640, fondo `#0f0e0f` | Igual que `tauri.conf.json` |
| Fondo Auralis | campo de 320 px de lado largo a 15 Hz | Lo aprobado el 2026-10-12 |
| Movimiento | `--spring` 320 ms, `--place` 300 ms, `--fade` 140 ms, `--stagger` 28 ms | `docs/MOTION.md` |
| Descarga de herramientas ociosas | `REST_MS` 30 s, `UNLOAD_MS` 5 min | Como `shell.js` |
| Distribución | NSIS por usuario, único formato, sin portable (§9.1) | Java, 2026-10-13 |

---

## 7. Motores y GPU

- **Grade.** Cada pasada actual de WebGL2 se traduce a un shader GLSL 440; la pila se ejecuta en un
  `QQuickRhiItem` con texturas intermedias y la LUT 3D como textura. Export a resolución completa: render fuera de
  pantalla con QRhi y lectura de vuelta. Aceptación por comparación de píxeles contra la versión WebGL (§13).
- **Visualizer.** Su comportamiento está definido desde las primeras versiones: mismo modelo de capas, parámetros,
  presets, composición y pipeline de export; el trabajo es trasladar un resultado conocido. Se empieza por lo más
  simple: `QPainter` (rutas, degradados, texto con las fuentes del sistema, modos de composición equivalentes a los
  de Canvas 2D), con el mismo render para preview y export; el export sigue escribiendo RGBA crudo a FFmpeg por
  `encode.rs`, ahora sin IPC. Solo si la preview animada mide un coste significativo se mueve esa parte al scene
  graph/RHI.
- **Frame Capture.** Vista con `QVideoSink` (decodificación por hardware de Qt Multimedia, backend FFmpeg de Qt) o
  frames de FFmpeg desde Rust; el frame exacto y el análisis siguen en el extractor FFmpeg.
- **Cutout / Background Remover.** SAM 2.1 (los mismos tres archivos) en `ort` con DirectML, CPU de respaldo. Se
  pierde la dependencia de WebGPU y de la wasm; la caché de máscaras no cambia.
- **Vocal Remover, Converter, Upscale, AI Interpolate, Downloader.** Ya ejecutan en Rust o en procesos externos;
  solo cambia la vista.
- **Fondo.** Auralis y la escena de herramientas como `ShaderEffect`; suspensión al minimizar, perder el foco u
  ocultarse con las señales de la ventana Qt.

---

## 8. Licencia de Qt

- Qt open source se distribuye bajo **LGPLv3** (la mayoría de módulos) o **GPLv3** (algunos). Halation solo usa
  módulos LGPL: Core, Gui, Qml, Quick, Quick Controls, Quick Shapes, Multimedia, Svg y los que la fase 0 confirme
  uno por uno en la documentación de Qt. Excluidos los GPL/comerciales (p. ej. Qt Charts, Qt Quick 3D, Qt Virtual
  Keyboard). [I: la licencia exacta de Qt Quick Effects / `MultiEffect` y de Qt Shader Tools se verifica en la fase 0;
  `qsb` es una herramienta de build y su licencia no alcanza a los shaders compilados.]
- **Qué permite:** app gratuita y de código abierto (GPL-3.0-or-later, compatible con LGPLv3), distribución libre
  del instalador, sin pagar licencia.
- **Qué obliga:**
  1. Enlazar Qt **dinámicamente** (DLLs de Qt junto al exe). El enlace estático es legalmente posible pero obliga a
     entregar los objetos de Halation para reenlazar: se descarta.
  2. Permitir que el usuario sustituya las DLLs de Qt por otras compatibles (no impedirlo con firmas o checks).
  3. Incluir el texto de la LGPLv3 y la GPLv3, el aviso de uso de Qt en Settings → About y en `THIRD_PARTY.md`, y
     el código fuente de la versión de Qt usada o una oferta escrita de entregarlo (un enlace a las fuentes
     exactas en la release pública basta en la práctica; se deja una copia del tarball en una release propia para
     no depender de terceros).
  4. Si se modifica Qt, publicar esas modificaciones. Plan: no modificarlo.
  5. Que los términos de Halation no prohíban la ingeniería inversa necesaria para depurar las modificaciones de
     Qt. `LICENSE` ("All rights reserved") necesita una línea de excepción para las bibliotecas LGPL.
- **Efecto sobre el freeware:** ninguno en precio ni en código cerrado. Las DLLs de Qt se instalan junto al exe en
  la carpeta de instalación, donde el usuario puede sustituirlas; sin portable no hay que resolver un `.exe` único.
- cxx-qt: MIT/Apache-2.0, sin obligaciones añadidas.

---

## 9. Packaging, actualizador y CI

### 9.1 Un único instalador

- La versión Qt no tiene edición portable: ni `.exe`, ni `.zip`, ni autoextraíble, ni carpeta con DLLs (Java,
  2026-10-13). Un único formato simplifica releases, actualizador, documentación, CI, tests de instalación,
  migraciones, asociaciones de archivos y el mantenimiento de Qt y sus DLLs.
- Instalación por usuario, sin UAC, como hoy. `windeployqt` recoge DLLs, plugins de plataforma y módulos QML; el
  instalador los incluye todos. Sin WebView2. El paquete MSIX de identidad deja de hacer falta (un solo proceso) y
  se retira.
- Lo que hoy hace `windows/hooks.nsh` sigue en el instalador: asociaciones "Abrir con" (`Halation.Image`,
  `Halation.Audio`, `OpenWithProgids`), accesos directos, `LICENSE.txt` y `THIRD_PARTY.md` junto al exe.
- Tamaño [I]: Qt Quick mínimo en Windows ≈ 35–60 MB sin comprimir → instalador ≈ 15–25 MB (hoy el setup ~7 MB). Se
  mide en la fase 0.

**Formato: NSIS (Java, 2026-10-13).** Se adapta `installer.nsi` quitando las partes de Tauri y WebView2. MSI se
descartó: sus ventajas (despliegue por administradores, reparación, rollback) sirven a IT, y obligaba a una versión
puente 1.x para pasar de NSIS a MSI.

### 9.2 Paso desde la instalación Tauri

- La versión Qt mantiene la clave de `Uninstall`, la carpeta `%LOCALAPPDATA%\Halation` y los argumentos
  `/P /UPDATE /R`; el actualizador de la 1.x la instala encima como cualquier versión. Sin versión puente.
- Se prueba antes de la primera release Qt (§14): instalación 1.x con datos reales → actualización → la versión Qt
  abre con ajustes, Library, presets, looks, sesiones y componentes, con una sola entrada en "Aplicaciones". Los
  datos de `Documents\Halation` no se tocan.

### 9.3 Actualizador

- Implementación propia en Rust (sin `tauri-plugin-updater`): leer `latest.json`, verificar la firma minisign con
  la misma clave pública (crate `minisign-verify`), descargar el instalador a `%TEMP%\Halation-update`, cerrar Halation y
  ejecutarlo con `/P /UPDATE` (más `/R` para reabrir si se eligió reiniciar). Mismo formato de `latest.json`.
- Comportamiento de `docs/UPDATES.md` sin cambios (preguntas, Activity, "Save session & restart", "Install on
  close"), salvo la fila del portable ("Download" que abre la release), que desaparece.

### 9.4 CI

- `build.yml`: instalación de Qt en el runner de Windows (versión fijada, caché), `cargo build` del crate
  `halation-qt`, `windeployqt`, `makensis`, firma minisign del instalador, `latest.json`. La
  release lleva solo el instalador, su `.sig` y `latest.json`.
- Durante la transición la app Qt se construye como artefacto de Actions ("Halation Qt Preview"), sin release ni
  `[build]`; la regla de un `[build]` por tarea sigue aplicando a la línea Tauri.

---

## 10. Tests

- **Se pierde:** Playwright sobre Chromium con `host.js` (todo el suite de interfaz).
- **Sustituto:**
  - `cargo test` de `halation-core` (crece con la lógica portada de JS).
  - Qt Quick Test (`TestCase` en QML) con el backend real o un backend falso en Rust (equivalente a `host.js`),
    en Linux con `QT_QPA_PLATFORM=offscreen` en el contenedor.
  - Capturas con `grabToImage` a `$SHOTS` para `visual-reviewer`; comparación con las capturas de la app Tauri en
    las pantallas donde la paridad es visual (`baseline.js` como referencia).
  - Exports: los mismos criterios de `alpha.js` y `layers.js` (frames decodificados idénticos o dentro de la
    tolerancia actual) contra FFmpeg.
  - Lo que solo existe en Windows (D3D11, DirectML, instalador, actualizador) se prueba en CI de Windows o en el PC de
    Java.
- `verify.js` se adapta para lanzar cargo + Qt Quick Test con la misma caché por hash.

---

## 11. Fases

Las fases existen para no mezclar demasiados cambios a la vez, no para medir tiempo: el orden lo deciden las
dependencias y el cierre de cada una, sus criterios de aceptación. Ninguna publica release hasta la 9.

| # | Fase | Resultado | Depende de |
|---|---|---|---|
| 0 | Preview de Home (§11.1) | Home y el shell mínimo en Qt, métricas comparadas con la 1.x Tauri, instalador completo, licencias de módulos confirmadas | — |
| 1 | `halation-core` | Rust sin Tauri; la app Tauri sigue igual sobre él (sus tests en verde) | 0 |
| 2 | Esqueleto Qt | Ventana, dock, vistas, tokens, movimiento, i18n, Settings, Home sin fondo, isla y trabajos | 1 |
| 3 | Servicios compartidos | Library (página y selector), Crop, Send to, sesiones, cierre, single instance, notificaciones | 2 |
| 4 | Herramientas de vista simple | Downloader, Converter, Upscale, AI Interpolate | 3 |
| 5 | Audio | Vocal Remover (mezclador), reproducción común | 3 |
| 6 | GPU y modelos | Grade (RHI), Cutout nativo, Background Remover, fondo Auralis | 3 |
| 7 | Render CPU y vídeo | Visualizer (QPainter + export FFmpeg), Frame Capture | 3, 5 |
| 8 | Cover Test | Réplicas de plataformas y export | 3 |
| 9 | Release | Actualizador propio, instalador final, paso desde la 1.x (§9.2) probado, licencias, primera versión Qt publicada | 4–8 |

Las fases 4–8 son independientes entre sí; se ejecutan una tras otra (un thread activo a la vez).

### 11.1 Fase 0: preview de Home

- **Qué es:** una reproducción fiel de Home con el shell mínimo para mostrarlo: dock, Auralis, fondo, cards y
  elementos visibles, hover, movimiento y transiciones principales, resize, y estados focused / unfocused /
  minimized. Debe sentirse como una pequeña versión real de Halation, no como un ejemplo de Qt.
- **Qué no es:** ninguna herramienta (ni Grade, ni Visualizer, ni Processes) ni paridad funcional.
- **Por qué Home basta:** combina composición, fondo GPU, muchos elementos, tipografía, movimiento, sombras,
  transparencias, navegación básica, comportamiento de ventana y coste en reposo.
- **Lleva lo mínimo de backend** para validar la cadena: un puente cxx-qt (ajustes de `app.json` y textos de
  `en.json`) y el build de `halation-qt` en el contenedor y en CI de Windows.
- **Medidas contra la 1.x Tauri** en el mismo PC: arranque, RAM, VRAM, CPU, GPU, reposo, Auralis activo, resize,
  focused, unfocused, minimized y estabilidad del frame pacing. No hay una cifra objetivo fijada de antemano; la
  fase existe para obtener datos reales.
- **Empaquetado:** la preview completa se empaqueta con NSIS con todas sus dependencias y se instala y desinstala
  limpia en Windows.
- **Criterio de salida:** Qt Quick da una base claramente más sencilla de controlar y, preferiblemente, una mejora
  apreciable de coste de ejecución. Con los datos, Java decide si se sigue con la fase 1.

---

## 12. Riesgos

| Riesgo | Efecto | Mitigación |
|---|---|---|
| cxx-qt 0.x cambia su API o no cubre algo | Retrabajo en el puente | Versión fijada, crate puente aislado, C++ para lo no cubierto; la fase 0 lo valida |
| Paridad visual de Grade (shaders WebGL → RHI) | Looks que no coinciden | LUT generada en Rust con los vectores actuales; comparación de píxeles por look |
| Visualizer: Canvas 2D → QPainter | Diferencias de texto, blur y composición | Comparación de frames contra la app Tauri; RHI solo si una medida lo pide (§7) |
| Movimiento: GSAP → animaciones QML | El "muelle con velocidad que se conserva" no sale igual | `SpringAnimation` o un muelle propio en un singleton; `motion.js` como referencia de curvas |
| Pérdida del suite de interfaz durante la transición | Regresiones sin detectar | La app Tauri sigue siendo la publicada; cada fase trae sus Qt Quick Test |
| Tamaño del instalador ×2–3 | Descargas más pesadas | Solo módulos necesarios, `windeployqt` con exclusiones |
| Paso desde la 1.x | Datos perdidos o actualización fallida | Misma clave, carpeta y argumentos NSIS; prueba con datos reales (§9.2) |
| Sin portable | Quien lo usaba tiene que instalar | Decisión tomada; se anuncia en las notas de la release Qt |
| Dos apps en paralelo | Cada cambio en la 1.x se duplica | Congelar funciones nuevas en la 1.x desde la fase 2, solo correcciones |
| Build de Qt en el contenedor | Cada sesión descarga Qt (cientos de MB) [I] | Script de setup del entorno con caché; medido en la fase 0 |
| Conocimiento limitado de cxx-qt en los threads | Más iteraciones por fase | Ejemplos de la fase 0 como plantilla en `docs/` |

---

## 13. Estimación de tamaño y coste en uso [I]

Las cifras indican tamaño relativo, no calendario. Halation se hace con agentes: una pieza de cientos o miles de
líneas cabe en una sola sesión cuando el comportamiento de referencia existe, la arquitectura está especificada y hay
tests y capturas con las que comparar e iterar. Por eso el plan se ordena por dependencias y criterios de aceptación,
no por horas.

- **Código nuevo:** ~15 000–20 000 líneas de QML, ~3 000–5 000 de Rust (puentes, lógica portada de JS, audio,
  actualizador, Cutout nativo), ~500–1 500 de C++, ~5 000–8 000 de tests nuevos. Del Rust actual se mueve, no se
  reescribe, ~85 %.
- **Threads:** del orden de 20–30 threads de implementación en High más su verificación; puede ser bastante menos
  donde la referencia Tauri y sus capturas guían directamente el port. Ninguna fase se marca de antemano como
  especialmente cara; el coste real de cada una se ve al implementarla.
- **Coste en uso:** el conjunto ocupa una parte grande de los límites de uso mientras dure, porque cada fase lee y
  escribe miles de líneas, compila Qt y Rust y revisa capturas. Cada contenedor nuevo suma la descarga e instalación
  de Qt si no se cachea.
- **CI:** cada build de Windows con Qt dura más que la actual y en un repo público no gasta minutos de Actions
  de pago, pero alarga cada release.
- **Lo más barato para decidir:** la fase 0 sola (1–2 threads) da las medidas reales antes de comprometer el resto.

---

## 14. Criterios de aceptación (release Qt)

1. Las diez herramientas, Home, Library, Settings, bienvenida, isla de procesos, Activity y actualizador hacen lo
   mismo que en la última 1.x Tauri (lista de flujos de los tests actuales como checklist).
2. Una instalación 1.x actualizada a la versión Qt conserva ajustes, Library, presets, looks, sesiones y
   componentes descargados, sin preguntas nuevas.
3. Grade: cada look incluido difiere de la versión WebGL en ≤ 1/255 de media por canal; exports del Visualizer
   dentro de las tolerancias de `alpha.js` y `layers.js`.
4. Movimiento según `docs/MOTION.md`: un muelle, interrumpible conservando velocidad, solo transform/opacity
   (blur para profundidad), fade corto con movimiento reducido.
5. Memoria en reposo en Home y arranque en frío iguales o menores que la 1.x (medidos en el PC de Java).
6. La pre-release lleva solo el instalador (más `.sig` y `latest.json`); una instalación 1.x pasa a la versión Qt
   por el actualizador con una sola entrada en "Aplicaciones" (§9.2); licencias LGPL cumplidas (§8).
7. `cargo test`, clippy `-D warnings` y Qt Quick Test en verde.

---

## 15. Fuera de alcance

- Rediseño visual o de flujos: se traslada lo que hay.
- Funciones nuevas durante la migración (Composición, Library por secciones nuevas, Intro): esperan a la release Qt
  o se hacen antes en la 1.x.
- macOS / Linux como plataformas publicadas (Qt lo haría posible; no se empaqueta ni se prueba).
- Qt WebEngine como puente (volvería a meter Chromium, que es lo que se quita).
- Licencia comercial de Qt y módulos GPL.
- Reescribir en otro lenguaje el backend Rust.

---

## 16. Decisiones pendientes (Java)

1. Aprobar la opción A (cxx-qt) frente a B (C++) o C (PySide6).
2. ~~Formato del instalador.~~ Decidido (Java, 2026-10-13): NSIS como único instalador, sin portable.
3. Congelar funciones nuevas en la 1.x desde la fase 2.
4. Empezar solo por la fase 0 (preview de Home, §11.1) y decidir el resto con sus medidas.
