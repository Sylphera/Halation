# Plan de reorganización del repositorio

Estado: propuesta, 2026-10-21. Nada de esto está ejecutado. Se ejecuta en un solo hilo, junto con la reestructuración en
crates ya aprobada, después de que Java revise este plan.

Fuentes del inventario: `main` (Tauri 1.2.0, 466 ficheros, 75 `.md`), `slint/visual-home` (38 commits por delante) y
`claude/project-thread-sgjgrl` (47 por delante; contiene a `slint/visual-home` entera más 9 commits de spec de UI).
Los datos de ramas y PRs salen de `git` y de la API de GitHub; lo que no se ha comprobado fichero a fichero se marca
**(sin verificar)**.

## Revisión 2026-10-21 (Java): dos líneas de repo

Esta sección prevalece sobre el resto donde haya conflicto.

- **Halation Tauri** = `main`, tal cual y con todo lo anterior. No se reorganiza; publica las 1.x. Se consulta en un
  checkout local para importar backend.
- **Halation Slint** = rama nueva, reestructurada y limpia desde el primer commit, lista para publicarse cuando termine
  la migración. Sin `legacy/tauri/`, sin Playwright ni Node en la ruta de compilación, sin `.opencode/`. Se publica en
  **este mismo repositorio** (las 1.x se actualizan desde sus releases con la misma clave minisign) y al corte pasa a
  ser `main`; el Tauri actual queda en `tauri-final` y `archive/tauri`. El corte lo aprueba Java.
- Efectos en el plan: §2.2 queda sustituida por lo anterior; en §4 desaparecen la fase 2 (mover `app/`) y el borrado de
  `legacy/tauri/` de la fase 6; los mapeos de §2.4 que apuntan a `legacy/tauri/` pasan a «no se copia». Coste total
  ≈ 4,5 – 5,5.

## 1. Inventario

### 1.1 Qué hay hoy

| Zona | Contenido | Estado |
| --- | --- | --- |
| `app/dist/` | 25 k líneas de HTML/JS/CSS de la app Tauri (11 herramientas, shell, Drape, Library) | Referencia histórica una vez exista la app nativa |
| `app/src-tauri/` | 9,8 k líneas de Rust (`convert.rs` 2,1 k, `stems.rs` 1,8 k) | Cantera de backend a importar; el resto es específico de Tauri/WebView |
| `app/tests/` | 123 ficheros: suite Playwright + `host.js` (backend simulado) + fixtures | Solo válida para la app Tauri |
| `app/scripts/` | 28 scripts mezclados (versión, iconos, benchmarks de rendimiento, README, exportación de modelos) | Sin clasificar; ver §2.4 |
| `slint/` (solo en la rama nativa) | Crate único `halation-slint`: `src/` (+`backend/`), `ui/`, `assets/`, `tests/`, `scripts/` | Línea activa, aún sin fusionar a `main` |
| `docs/` | 28 `.md` sueltos en la raíz de `docs/`, más `performance/`, `performance-2026-10-04/`, `brand/`, `examples/` (12 MB), `screenshots/` (8,6 MB), `signing/` | Sin índice ni estado por documento |
| Raíz | `AGENTS.md`, `CLAUDE.md`, `AI_DEVELOPMENT.md`, `CONTRIBUTING.md`, `README.md`, 5 ficheros legales/privacidad, `THIRD_PARTY.md` (35 KB), `CHANGELOG.md` | Tres textos distintos sobre «cómo trabajan los agentes» |
| `.claude/` | 2 agentes (`test-runner`, `visual-reviewer`), 3 skills (`playwright-cli`, `context7`, `frontend-design`) | Los tres skills y los dos agentes son del flujo Tauri/Playwright |
| `.opencode/` + `docs/OPENCODE_*.md` (solo rama nativa) | Config y parches de TUI de otra herramienta de agentes (9 ficheros + 4 docs, 321 líneas) | No describe Halation; ver §1.3 |
| `.github/` | `build.yml` (Tauri: `app/src-tauri`, `app/dist`, `tauri.conf.json`), `downloads-badge.yml`, plantillas | `build.yml` se reescribe con el workspace |

Cuántos documentos hay que leer hoy para entrar: `CLAUDE.md` dice «lee solo este fichero», `AGENTS.md` dice «lee también
CLAUDE.md» y `docs/` tiene 28 ficheros sin orden de lectura.

### 1.2 Contradicciones y documentos desfasados (comprobados)

1. `CLAUDE.md`: «Read this file only». `AGENTS.md`: «Leer también `CLAUDE.md`; estas reglas tienen prioridad». Dos
   fuentes de autoridad que se duplican (autoría, merge, flujo) y se contradicen en detalle.
2. Evidencia visual: `AGENTS.md` prohíbe capturas y vídeos automatizados durante la iteración; `CLAUDE.md` exige capturas
   de todo cambio visual y un subagente `visual-reviewer`. En la rama nativa la revisión es en ventana nativa y offscreen.
   Hay tres versiones del mismo gate.
3. `AGENTS.md` pide revisión «en la instancia real de Chromium»; la app nativa ya no usa Chromium.
4. `CLAUDE.md`: «solo instalador, sin portable»; `docs/PREVIEW.md` y las previews se prueban «en el portable».
5. Qt Quick: `docs/ROADMAP.md` lo da como «pendiente de aprobación», `docs/OPEN_SOURCE.md` habla de la «migración a Qt
   Quick», `docs/QT_QUICK_SPEC.md` (32 KB) sigue en `main`, pero `docs/SLINT_SPEC.md` dice que Qt está retirado y la rama
   nativa borra esa spec. Las instrucciones del proyecto también mencionan «hasta que llegue Qt Quick».
6. `docs/ROADMAP.md` cita `docs/INTRO_SPEC.md`, que no existe (la herramienta Intro se eliminó).
7. `docs/MOTION_TEXT_SPEC.md` (20 KB) describe una herramienta que se eliminó.
8. `docs/SLINT_SPEC.md` (rama sgjgrl) declara fuera de alcance instalador y updater y fija el perfil en
   `%LOCALAPPDATA%\Halation\slint-beta` y un crate único `slint/`. Lo aprobado es: workspace, `%APPDATA%\Halation`,
   instalador y updater como exe aparte. La spec debe actualizarse, no convivir con eso.
9. `app/dist/changelog.md` está versionado y es una copia de `CHANGELOG.md` que CI vuelve a generar.
10. `docs/performance/auralis-2/` y `frame-budget-111/` usan el nombre antiguo «Auralis» (renombrado a Drape).
11. `AI_DEVELOPMENT.md` dice que se usan Codex y Claude Code; `AGENTS.md` (rama nativa) y `docs/OPENCODE_*` describen
    OpenCode; `CLAUDE.md` nombra Claude Code y Codex. Tres relatos.
12. `CONTRIBUTING.md` y la plantilla de PR mandan a `app/dist`, `app/src-tauri` y `node app/tests/…`: dejan de valer al
    cortar.
13. Los comentarios del código Tauri apuntan a `docs/*_SPEC.md` por ruta (≈45 referencias en `app/dist`). Mover specs rompe
    esas referencias; irrelevante si ese código se archiva, relevante si se mueve antes de tiempo.

### 1.3 Código muerto, duplicado y restos

- **Tauri/web**: todo `app/` (frontend plain-JS, backend, 123 tests, 28 scripts, `tauri*.conf.json`, `capabilities/`,
  `icons/`), `app/dist/dev/` (fixtures de Preview), `@tauri-apps/cli`, `@playwright/cli`, `ctx7`, `onnxruntime-web`,
  `lucide-static` en `package.json`.
- **Duplicado**: `app/dist/changelog.md`; `slint/assets/halation-mark.png` frente a `docs/brand/halation-mark-source.png`
  y `docs/brand/source/halation.logo.png` (tres copias de la marca); `docs/screenshots/*.jpg` frente a
  `docs/examples/*.jpg` (mismas 8 herramientas); `.claude/skills/frontend-design/LICENSE.txt`.
- **Medios pesados en el árbol**: `docs/examples/` 12 MB (2 vídeos + 9 JPG + `grade-look.json`), `docs/screenshots/` 8,6 MB.
  Los usan el README, los scripts `readme-*.js` y tests de Tauri.
- **Trazas**: `docs/performance*/` (≈170 KB de `.md` de informes) más dos carpetas con nombres distintos
  (`performance` y `performance-2026-10-04`); los `.json/.log` ya están en `.gitignore`.
- **Informes de un solo uso**: `UPSCALE_VIDEO_CHECKPOINT.md`, `ui-corrections-2026-10-05.md`,
  `UI_DEFAULTS_BRANDING_111.md`, `performance-2026-10-04/REPORT.md`.
- **Parche de CI sin aplicar**: `docs/signing/build-signpath.patch` (SignPath, aparcado, `docs/SIGNING.md`).
- **Residuo de otro agente (rama nativa)**: `.opencode/` con `ui-patches/omo-slim-3.0.4` (parche de TUI de una
  herramienta ajena, con su `runtime.js`) y 4 documentos `OPENCODE_*`. Es configuración de entorno personal en un repo
  público y ninguna parte de Halation depende de ella (sin verificar que nadie la use hoy: decide Java).

### 1.4 Ramas remotas (22)

Los 25 PRs del repositorio están cerrados. El historial de `main` muestra las fusiones por squash (#23, #24, #25), por
lo que `git branch --merged` no sirve: la comprobación por ramas es «¿el contenido ya está en `main`?».

| Rama | Qué es | Propuesta |
| --- | --- | --- |
| `main` | Tauri 1.2.0 publicado | Congelada salvo correcciones de Tauri hasta el corte |
| `claude/project-thread-sgjgrl` | Punta de la línea nativa: `slint/visual-home` + spec de rediseño | Fast-forward de `slint/visual-home` a ella y borrarla |
| `slint/visual-home` | Línea nativa (Rust + Slint) | Rama de integración de la reestructuración; nombre definitivo: `native` (renombrar al ejecutar, **decisión de Java**) |
| `badges` | Datos de CI: `downloads.json` del badge del README | Conservar; documentar en `docs/RELEASE.md` |
| `backgrounds-v2` | 0 commits por delante de `main` | Borrar |
| `legacy-site` | Misma punta que `claude/project-thread-7nc0ku` (README hero); no contiene ningún sitio web | Borrar (nombre engañoso) |
| `claude/project-thread-*` (13 más: `33aiep`, `487vpi`, `4tqka5`, `7nc0ku`, `fpzh2o`, `giblsm`, `j4xgdi`, `jbnzz4`, `k1pcet`, `l01k10`, `mn3duj`, `sz3y83`, `we66mc`) | Ramas de hilos con su PR cerrado | Borrar tras comprobar, una a una, que su contenido ya está en `main` o es descartable. `mn3duj` (firma SignPath) y `fpzh2o` (licencias) tienen contenido que no es trivial: mirar antes **(sin verificar)** |
| `claude/project-thread-p7rr2c` | Spec del rediseño de Welcome (borrador, 1 commit) | La pantalla Welcome de Tauri desaparece: archivar el spec solo si Java quiere reaprovecharlo |
| `grade-looks`, `grade-thumbs-stack`, `showcase-palette` | Ramas sueltas con PR cerrado | Borrar tras la misma comprobación |

Etiquetas existentes: `v1.1.0`, `v1.1.1`, `v1.2.0`, `stems-v1`, `stems-v4`, `cutout-sam21-v1` (las tres últimas son
releases de modelos). Se conservan. Se añade `tauri-final` sobre el último commit de Tauri en `main` antes del corte.

## 2. Estructura objetivo

### 2.1 Árbol

Respeta lo aprobado: workspace de Cargo con `halation-core` y `halation-app`, `assets\`, `locales\`, `presets\` y
`licenses\` junto al exe, updater como ejecutable aparte, solo instalador, datos en `%APPDATA%\Halation`.

```text
Halation/
├─ README.md                 entrada: qué es, descarga, mapa del repo (§3)
├─ CONTRIBUTING.md           cómo compilar, probar y proponer cambios
├─ AGENTS.md                 única fuente de reglas para agentes (≤ 60 líneas)
├─ CLAUDE.md                 una línea: importa AGENTS.md
├─ CHANGELOG.md  LICENSE  NOTICE.md  THIRD_PARTY.md  PRIVACY.md  SECURITY.md  TRADEMARKS.md
├─ Cargo.toml  Cargo.lock  rust-toolchain.toml     workspace
├─ crates/
│  ├─ halation-core/         backend sin Slint ni UI: process, queue, engine, sections, destinations, presets,
│  │                         artist_profile, settings, profile, library (índice), rutas y datos de usuario
│  ├─ halation-app/          UI Slint + controlador: ui/*.slint, src/ (app, navigation, theme, motion, folders,
│  │                         jobs, settings…), build.rs, tests/ (layout y estado)
│  └─ halation-updater/      ejecutable aparte: comprobar, descargar, verificar firma, lanzar el instalador
├─ assets/                   lo que se instala junto al exe: Drape (loop, still, tint), fuentes, iconos, marca
├─ locales/                  textos por idioma (en primero); vacío de claves hasta que exista el sistema de i18n
├─ presets/                  presets incluidos (looks de Grade, perfiles de exportación…)
├─ licenses/                 textos de licencias de terceros que viajan en el instalador (índice: THIRD_PARTY.md)
├─ installer/                script NSIS, recursos del instalador, comprobaciones de paridad instalador/exe
├─ tools/                    utilidades de desarrollo, nada de esto se distribuye
│  ├─ release/               bump de versión, comprobación del icono del exe, smoke de release
│  ├─ assets/                generadores de assets (blue-noise, record-drape, iconos, lucide)
│  ├─ models/                exportadores de modelos (htdemucs, sam2.1) y sus pruebas
│  └─ measure/               medición de memoria/renderers (ps1) y benchmarks que sigan vigentes
├─ branding/                 marca fuente (SVG, PNG), botones y héroe del README
├─ docs/
│  ├─ README.md              índice: qué documento leer según lo que se vaya a tocar
│  ├─ ARCHITECTURE.md        mapa de crates y módulos, flujo de datos, propiedad de hilos, capa de instalación
│  ├─ DESIGN.md              sistema visual, color, movimiento, layout (§2.3)
│  ├─ SPEC.md                spec canónica de la app nativa (ex `SLINT_SPEC.md`), con alcance y puertas
│  ├─ DEVELOPMENT.md         compilar, probar, previsualizar, puerta de revisión visual, flujo de ramas y merge
│  ├─ RELEASE.md             versionado, instalador, updater, firma del updater, firma Authenticode, badge
│  ├─ DECISIONS.md           decisiones de producto y técnicas con fecha
│  ├─ ROADMAP.md             ideas aparcadas, con su línea de encaje
│  ├─ specs/                 una spec por función, cada una con cabecera `Estado:` (Implementada / En curso / Prevista)
│  ├─ media/                 capturas del README (`.jpg`) regeneradas desde la app nativa
│  └─ archive/               solo lo que sirve de referencia al portar desde Tauri (§2.3), con README «histórico, no autoritativo»
├─ legacy/tauri/             SOLO hasta el corte: `app/` entero movido tal cual (ver §2.2). Se borra en la fase 6
└─ .github/                  `ci.yml` (workspace), `release.yml`, `downloads-badge.yml`, plantillas
```

`.claude/` queda con los agentes y skills que sigan siendo ciertos tras el corte (§2.5). `.opencode/` sale (§1.3).

### 2.2 Qué pasa con Tauri

Mientras la app nativa no sustituya a la publicada, `main` sigue publicando Tauri. Por eso:

- La reorganización se ejecuta en la **línea nativa**, no en `main`. `main` no se toca salvo correcciones de Tauri.
- En la línea nativa, `app/` pasa a `legacy/tauri/` en un único commit de movimiento. Sirve de referencia a los imports
  de backend (`docs/SLINT_BACKEND_IMPORT.md`) y a las specs de herramientas aún no portadas. No se compila en el CI nativo.
  Los comentarios que cita `docs/*_SPEC.md` no se corrigen: el código se borra después.
- Al corte (fase 6, aprobación de Java, regla del repo: nada a `main` sin su OK): el PR de la línea nativa a `main`
  elimina `legacy/tauri/`. El código Tauri queda en el tag `v1.2.0`, el tag `tauri-final` y una rama `archive/tauri`.
- El updater de los usuarios de 1.x apunta a `latest.json` de Sylphera/Halation y a la clave minisign actual. El corte no
  puede cambiar esa clave ni el formato de `latest.json` sin una migración explícita (`docs/UPDATES.md`).

### 2.3 Mapeo de documentos (origen → destino)

Principio: no se parten ficheros por partir; los que se fusionan es porque describen lo mismo. Todo lo borrado queda en
el historial y en los tags.

| Origen | Destino |
| --- | --- |
| `AGENTS.md` + `CLAUDE.md` + `AI_DEVELOPMENT.md` | `AGENTS.md` (reglas, ≤ 60 líneas) + `CLAUDE.md` (`@AGENTS.md`); `AI_DEVELOPMENT.md` pasa a un apartado de `CONTRIBUTING.md` |
| `docs/OPENCODE_*.md` (4), `.opencode/` | Borrar (historial) |
| `docs/SLINT_SPEC.md` | `docs/SPEC.md`, actualizada: workspace, instalador, updater, `%APPDATA%\Halation`, Qt fuera |
| `docs/SLINT_BACKEND_IMPORT.md` | Tabla de estado a `docs/ARCHITECTURE.md` (sección «Backend importado»); el resto se borra |
| `docs/SLINT_VISUAL_SYSTEM.md`, `docs/COLOR_REWORK_SPEC.md`, `docs/MOTION.md`, `docs/UI_REDESIGN_SPEC.md` | `docs/DESIGN.md`. La parte de `UI_REDESIGN_SPEC` aún sin implementar se queda en `specs/UI_REDESIGN.md` hasta que lo esté; entonces se funde en `DESIGN.md` |
| `docs/ARCHITECTURE.md` (Tauri) | `docs/archive/tauri/ARCHITECTURE.md`; nuevo `docs/ARCHITECTURE.md` nativo |
| `docs/DECISIONS.md` | Se queda; las secciones de motivos solo-Tauri (Motion web, Export WebCodecs…) pasan a `archive/tauri/DECISIONS.md` |
| `docs/ROADMAP.md` | Se queda; corregir las líneas de Qt Quick e `INTRO_SPEC`; añadir Motion Text como «base en archive» |
| `docs/UPDATES.md`, `docs/SIGNING.md`, `docs/signing/build-signpath.patch`, partes de `docs/OPEN_SOURCE.md` | `docs/RELEASE.md` (un documento, secciones: versionado, instalador, updater nuevo, firma). El parche pasa a `archive/signing/` |
| `docs/PREVIEW.md` | `archive/tauri/PREVIEW.md`; el equivalente nativo (launcher de la beta, capturas offscreen) en `DEVELOPMENT.md` |
| `docs/JOBS_SPEC`, `LIBRARY_SPEC`, `SETTINGS_SPEC`, `SAVE_LOCATION_SPEC`, `PROCESS_MENU_SPEC`, `FRAMERATE_SPEC` | `docs/specs/` (mismo nombre, con `Estado:`) |
| `docs/CONVERTER_SPEC`, `COVER_TEST_SPEC`, `GRADE_LOOKS_SPEC`, `VOCAL_REMOVER_SPEC`, `REMOVE_BG_SPEC`, `BACKGROUNDS_SPEC` | `docs/specs/` (herramientas aún no portadas: `Estado: Prevista`; Drape: `Implementada`) |
| `docs/DOCK_SPEC.md`, `docs/WINDOW_SPEC.md` | `archive/tauri/` (el dock lo sustituye la barra lateral; la ventana nativa se rige por `SPEC.md`) |
| `docs/QT_QUICK_SPEC.md` | Borrar (retirado) |
| `docs/MOTION_TEXT_SPEC.md` | `archive/` (base de una idea futura, enlazada desde `ROADMAP.md`) |
| `docs/performance/**`, `docs/performance-2026-10-04/**` | Borrar los informes (quedan en el historial); conservar en `docs/archive/performance.md` un resumen de ≤ 40 líneas con los presupuestos que siguen vigentes (frame budget, memoria) |
| `docs/UPSCALE_VIDEO_CHECKPOINT.md`, `ui-corrections-2026-10-05.md`, `UI_DEFAULTS_BRANDING_111.md` | Borrar |
| `docs/brand/**` | `branding/` (una sola copia de la marca; `slint/assets/halation-mark.png` deja de duplicarse) |
| `docs/screenshots/*.jpg`, `docs/examples/**` | Se regeneran desde la app nativa a `docs/media/`; hasta el corte, `legacy/tauri/docs-media/`. Se borran 12 MB de `examples/` |
| `app/dist/changelog.md` | Se borra: el instalador y la app nativa leen `CHANGELOG.md` (copiado por CI) |

Resultado: de **75 `.md` versionados** a unos **30**, de los que 9 son legales/entrada de raíz, 8 documentos centrales,
≈ 12 specs con estado y 1 índice de archivo. El nuevo lector entra por `README.md` → `docs/README.md`, con un orden de
lectura de 3 documentos (`SPEC`, `ARCHITECTURE`, `DEVELOPMENT`).

### 2.4 Mapeo de código y herramientas (origen → destino)

| Origen | Destino |
| --- | --- |
| `slint/src/*` (UI, navegación, tema, movimiento, controlador, `folders.rs`, `jobs.rs`, `settings.rs` vista) | `crates/halation-app/src/` |
| `slint/src/backend/*` (`process`, `queue`, `engine`, `sections`, `names`, `destinations`, `presets`, `artist_profile`, `atomic_file`) | `crates/halation-core/src/` |
| `slint/src/{profile,settings,library,catalog}.rs` | Se parten por lo que contienen: modelo y persistencia a `halation-core`; modelos de Slint y callbacks a `halation-app` |
| `slint/ui/**`, `slint/build.rs` | `crates/halation-app/ui/`, `crates/halation-app/build.rs` |
| `slint/tests/{engine,folders,process,sections,services}.rs` | `crates/halation-core/tests/` |
| `slint/tests/ui_layout.rs`, `slint/src/screenshot.rs` | `crates/halation-app/` (único con dependencia de `i-slint-backend-testing`) |
| `slint/assets/**` | `assets/` (el binario las busca junto al exe; en `cargo run` por variable o ruta relativa al workspace) |
| `slint/scripts/{launch-beta,measure-*}.ps1`, `record-drape.js` | `tools/measure/`, `tools/assets/` |
| `app/src-tauri/icons/` | `assets/icons/` (iconos del exe e instalador) lo que siga vigente; resto a `legacy/tauri/` |
| `app/dist/locales/en.json` | `locales/en.json` como punto de partida del i18n nativo (el esquema se decide en su spec) |
| Presets de Grade/Converter hoy dentro de `app/dist` | `presets/` cuando cada herramienta se porte; hoy solo se crea la carpeta con su README |
| `app/scripts/bump-beta.js`, `exe-icon.js`, `release-smoke.js`, `installer-parity.js` | `tools/release/` (adaptar al workspace) |
| `app/scripts/{blue-noise,icons,lucide,look-sheet}.js`, `fixtures/` | `tools/assets/` |
| `app/scripts/{htdemucs-export,htdemucs-dml,sam21-export}.py` | `tools/models/` |
| `app/scripts/{*-benchmark,performance-*,ui-benchmark,drape-grain-…,process-ui-benchmark}.cjs/.ps1`, `i18n-missing.js`, `halation-preview.cjs`, `readme-*.js` | `legacy/tauri/scripts/` (dependen del frontend web). Tras el corte se borran; las mediciones nativas son los `.ps1` de `tools/measure/` |
| `app/tests/**`, `app/package.json`, `app/package-lock.json`, `app/dist/**`, `app/src-tauri/**` | `legacy/tauri/` sin tocar |
| Raíz de `package.json` | No existe tras el corte: el proyecto no tiene Node en su ruta de compilación (los scripts de `tools/` que lo usan declaran su `package.json` local) |

### 2.5 `.claude/`

- `agents/test-runner.md`, `agents/visual-reviewer.md`: reescribir para `cargo fmt/clippy/test` y revisión de capturas
  offscreen; hoy ejecutan Playwright.
- `skills/playwright-cli`, `skills/context7`: borrar al corte (Playwright y `ctx7` son del flujo web). `context7` puede
  volver si Java lo quiere para consultar docs de crates **(decisión de Java)**.
- `skills/frontend-design`: borrar (diseño web; la fuente de diseño pasa a ser `docs/DESIGN.md`).

## 3. Entendible para una persona nueva y para agentes

Reglas: cada fichero responde a «qué hay aquí y para qué» en las primeras líneas; los README de carpeta solo donde la
carpeta no se explica sola.

- **`README.md`**: lo que ya es (qué es Halation, descarga, licencia) más una sección nueva «Mapa del repositorio»: el
  árbol de §2.1 reducido a un nivel con una línea por carpeta, y tres enlaces: «quiero compilar» (`DEVELOPMENT.md`),
  «quiero entender el diseño» (`ARCHITECTURE.md`), «quiero tocar la interfaz» (`DESIGN.md`).
- **`docs/README.md`**: tabla «Si vas a tocar X, lee Y» (Jobs → `specs/JOBS_SPEC.md`; Library → …; Slint UI → `DESIGN.md`;
  release → `RELEASE.md`). Es el único índice; cada spec lleva `Estado:` y fecha en la primera línea.
- **README corto por carpeta (5, 5–15 líneas cada uno)**: `crates/halation-core` (qué entra y qué no: sin tipos de
  Slint ni de UI), `crates/halation-app` (estructura `ui/` y `src/`, regla clean-room de la capa visual),
  `crates/halation-updater` (protocolo con la app), `tools/` (una línea por subcarpeta), `installer/`. No hay README en
  `assets/`, `locales/`, `presets/` ni `licenses/`, salvo el que ya exista por avisos de licencia.
- **`CONTRIBUTING.md`**: prerrequisitos (Rust 1.92+, MSVC), los 4 comandos de verificación del workspace, cómo se
  nombra una rama y un commit, gate de revisión visual, qué necesita un cambio de interfaz, reglas fijas (local, sin
  telemetría, solo metadatos públicos de Spotify, licencias en `THIRD_PARTY.md`), apartado «Desarrollo asistido por IA».
- **`AGENTS.md`**: una sola fuente (≤ 60 líneas) con: pila, comandos, convenciones, restricciones fijas, autoría, límites
  de merge/release, y enlaces a `docs/`. `CLAUDE.md` = `@AGENTS.md`. Las reglas que cambian cada semana (decisiones de
  Java) van a `docs/DECISIONS.md` con fecha, no a estos ficheros.
- **Mapa de código** en `docs/ARCHITECTURE.md`: por crate, módulo → responsabilidad → test que lo cubre, con enlace al
  spec. Sustituye al «code map» de 443 líneas de Tauri, que se archiva.
- **Documentación en el código**: cada `lib.rs`/`main.rs` y cada módulo de `halation-core` abre con un comentario `//!`
  de 3–5 líneas (qué hace, qué no, de quién depende). `cargo doc` pasa a ser el mapa fino.
- Comprobación automática en CI (fase 5): un test que falla si `docs/README.md` no enlaza un `.md` de `docs/` o si un
  spec no tiene `Estado:`. Evita que el desorden vuelva.

## 4. Orden de ejecución por fases

Un solo hilo, un commit (o pocos) por fase, el CI de la rama en verde antes de pasar a la siguiente. Salvo indicación, se
trabaja en la rama de integración nativa; **nada llega a `main` sin la aprobación de Java**.

| Fase | Qué | Riesgo | Cómo no rompe CI |
| --- | --- | --- | --- |
| 0 | Decisiones abiertas de Java (§5); fast-forward de `slint/visual-home` a `sgjgrl`; congelar nuevas ramas de hilo; crear tag `tauri-final` | Bajo | Sin cambios de código |
| 1 | Documentos: `AGENTS.md`/`CLAUDE.md`, `CONTRIBUTING.md`, índice `docs/README.md`, cabeceras `Estado:`, mover specs a `docs/specs/`, archivar, borrar según §2.3, corregir contradicciones de §1.2 | Bajo: solo `.md` y plantillas. Las referencias por ruta en comentarios Tauri se dejan | `build.yml` solo lee `docs/UPDATES.md` (cambiarlo a `RELEASE.md` en el mismo commit) |
| 2 | Mover `app/` → `legacy/tauri/` y los scripts/fixtures de §2.4 que no son Tauri a `tools/`. Actualizar rutas de `build.yml` y de `.gitignore` | Medio: rutas relativas en scripts y en `tauri.conf.json` (`frontendDist`, `../dist`), `tauri build` desde otra ruta | Un commit solo de movimiento (`git mv`, sin editar contenido), y el CI de Tauri en `legacy/tauri/` se ejecuta una vez para confirmar que sigue verde; después se deja de ejecutar |
| 3 | Workspace de Cargo: `crates/halation-core` y `crates/halation-app`, `Cargo.toml` raíz, `rust-toolchain.toml`, `assets/` `locales/` `presets/` `licenses/`; mover módulos según §2.4; localizador de `assets/` junto al exe y en `cargo run` | **Alto** (es la parte que toca código): dependencias circulares entre `app.rs`/controlador y el backend, `build.rs` y rutas de `@image-url`, fuentes y vídeo cargados en tiempo de ejecución | Primero crear el workspace con un solo crate que compila lo mismo; luego extraer `halation-core` módulo a módulo con `cargo test` en verde tras cada uno; el grafo de features (winit + Skia, sin Qt) se comprueba con `cargo tree -e features`. `ci.yml` nuevo corre `fmt`, `clippy -D warnings`, `test`, `build --release` |
| 4 | Instalador: NSIS en `installer/`, estructura junto al exe, datos de usuario en `%APPDATA%\Halation`, desinstalación que conserva datos | Medio-alto: solo se valida de verdad en Windows (KernelPanic); `/UPDATE` mantiene datos | `release.yml` se prueba con un tag de prueba en un fork o con `workflow_dispatch` sin publicar |
| 5 | `halation-updater`: protocolo (la app lanza el updater y sale; el updater espera, descarga a `%TEMP%`, verifica la firma minisign, ejecuta el instalador con `/UPDATE`, reabre la app), compatibilidad con `latest.json` de las 1.x, política de «guardar sesión y reiniciar» | **Alto**: seguridad (verificación de firma, rutas temporales, reintentos), reversión si falla, y la clave minisign es única | Tests de integración del protocolo contra un servidor local y un instalador falso; la prueba real de actualización de 1.2.0 → nativa se hace en KernelPanic antes de publicar |
| 6 | Corte: PR de la línea nativa a `main`, borrado de `legacy/tauri/`, borrado de ramas obsoletas (§1.4), `package.json` de Node fuera, `.claude/` ajustado, regenerar `docs/media/`, test de salud de documentos | Medio: es la operación que cambia lo que publica `main`; irreversible en la práctica | Requiere aprobación explícita de Java; `tauri-final` y `archive/tauri` garantizan la vuelta atrás |

Las fases 1 y 2 son independientes de la 3: pueden hacerse aunque la reestructuración de crates se retrase. La
reestructuración visual (`docs/UI_REDESIGN_SPEC.md` §11) va **después** de la fase 3, porque toca los ficheros que esta
mueve.

## 5. Decisiones que necesitan a Java

1. **Dónde se ejecuta** (recomendado: línea nativa, `main` congelada). Alternativa: tocar `main` primero para la fase 1;
   genera conflictos con `CLAUDE.md`, `AGENTS.md`, `DECISIONS.md`, `ROADMAP.md`, `THIRD_PARTY.md` que la rama nativa ya
   modificó.
2. **Nombre de la rama de integración** nativa (`native` propuesto).
3. **`.opencode/` y `docs/OPENCODE_*`**: borrar (recomendado) o conservar fuera del repo público.
4. **Borrar los informes de rendimiento y de checkpoints** (recomendado, quedan en el historial) o archivarlos íntegros.
5. **`context7`** como skill: conservar o no.
6. Si `halation-updater` es parte de este mismo hilo o un hilo propio después de la fase 4 (recomendado: mismo hilo,
   pero como fase 5, con pausa para la prueba real en KernelPanic).

## 6. Coste de la ejecución (estimación, no medida)

No hay una medida real de cuánto consume un hilo de estos; la escala siguiente es relativa a un hilo de implementación
normal en High, que vale 1.

| Fase | Coste relativo | Qué lo condiciona |
| --- | --- | --- |
| 0 | 0,1 | Solo git y decisiones |
| 1 (documentos) | 0,5 | Reescribir ≈ 6 documentos y mover ≈ 40; sin compilar |
| 2 (mover `app/`) | 0,3 | Mecánico, más una ejecución del CI de Tauri |
| 3 (workspace y crates) | 1,5 – 2 | Es lo más caro: compilar y probar tras cada módulo extraído |
| 4 (instalador) | 1 | NSIS + workflow + verificación en Windows |
| 5 (updater) | 1,5 – 2 | Programa nuevo con seguridad y reversión; prueba real |
| 6 (corte) | 0,5 | Borrados, PR, limpieza de ramas |

Total ≈ 5,5 – 6,5 unidades. Las fases 0–2 (≈ 1) bastan para que el repo sea entendible; las fases 3–5 son la
reestructuración técnica y el updater (≈ 4 – 5). Las **cosas que Java añada durante esta reestructuración** se miden
contra esta tabla: un módulo nuevo en `halation-core` o un cambio de layout del instalador suma 0,3 – 1 según tamaño;
cualquier cambio en el protocolo del updater suma a la fase 5.

## 7. Fuera de alcance

Cambiar producto, UX o la spec de rediseño visual; portar herramientas de Tauri a Slint; el esquema de i18n nativo;
firma Authenticode (sigue aparcada, `docs/SIGNING.md`); migración de datos de usuario Tauri → nativa (punto 4 de la
hoja de ruta de `SPEC.md`: se diseña aparte antes del corte, **y es requisito del corte**).
