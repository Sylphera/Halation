# Plan de reorganización del repositorio

Status: In progress — milestone 0 done on 2026-10-21; A1 and B under way on `slint/native`.

Estado: propuesta v2, 2026-10-21 (incorpora la propuesta integral de Java y las decisiones del hilo). Nada de esto está ejecutado. Se ejecuta en un solo hilo, junto con la reestructuración en
crates ya aprobada, después de que Java revise este plan.

Fuentes del inventario: `main` (Tauri 1.2.0, 466 ficheros, 75 `.md`), `slint/visual-home` (38 commits por delante) y
`claude/project-thread-sgjgrl` (47 por delante; contiene a `slint/visual-home` entera más 9 commits de spec de UI).
Los datos de ramas y PRs salen de `git` y de la API de GitHub; lo que no se ha comprobado fichero a fichero se marca
**(sin verificar)**.

## Decisiones de Java que fijan este plan (2026-10-21)

1. **Dos líneas.** Halation Tauri = `main`, intacta mientras sea lo publicado y referencia de la migración. Halation
   Slint = rama nueva ya reestructurada, sin `legacy/tauri/`, sin Playwright/WebView2/Tauri, sin scripts históricos ni
   instrucciones de Chromium o Qt Quick, sin herramientas personales ajenas (`.opencode/`). Se publica en este mismo
   repositorio (las 1.x se actualizan desde sus releases, misma clave minisign). El código viejo se consulta por Git,
   tags (`v1.2.0`, `tauri-final`) y un checkout local; no se duplica dentro del árbol nuevo.
2. **Nada se fusiona a `main` sin aprobación explícita**, también la migración de `main` a la línea nativa. Excepción
   escrita para esta línea frente a la regla general de «merge automático con CI en verde» (registrar en `DECISIONS.md`).
3. **Estructura evolutiva**: se crean solo las carpetas que tengan contenido real; la distinción conceptual
   (`docs/` cómo funciona, `planning/` qué se quiere cambiar y por qué, `research/` qué se midió, `archive/` qué dejó de
   valer) se mantiene.
4. **Un solo lugar para instrucciones de agentes**: `AGENTS.md` como fuente; `CLAUDE.md` adaptador mínimo; sin
   `.agents/`. Sin límite rígido de líneas.
5. **Orden A1 → B → A2** y los hitos C (distribución) y D (migración de datos), sin que A dependa del updater.
6. **Trazabilidad**: CI comprueba rutas y enlaces; el estado funcional sale de pruebas y revisiones, no de que exista
   una ruta.
7. **Condición de A1**: no elimina ninguna especificación que necesite el agente de B (ver §4).

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

## 2. Estructura objetivo (evolutiva)

Regla de creación: una carpeta o fichero existe el día 1 solo si hay contenido real que meter. El árbol marca lo que se
crea al empezar y lo que aparece cuando exista contenido. Las rutas dentro de `crates/` son orientativas: se adaptan al
código real tras la auditoría (hito 0); nada se parte por número de líneas.

```text
Halation/
├─ README.md  CONTRIBUTING.md  AGENTS.md  CLAUDE.md (@AGENTS.md)  CHANGELOG.md
├─ LICENSE  NOTICE.md  THIRD_PARTY.md  PRIVACY.md  SECURITY.md  TRADEMARKS.md
├─ Cargo.toml  Cargo.lock  rust-toolchain.toml                       workspace (hito B)
├─ crates/
│  ├─ halation-core/        lógica de negocio sin Slint (hito B): jobs/cola/engine, procesos, library, storage…
│  ├─ halation-app/         ciclo de vida, UI Slint, navegación, controladores (hito B)
│  └─ halation-updater/     hito C, no antes
├─ assets/                  día 1: Drape, fuentes, iconos, marca (hoy en `slint/assets`)
├─ tools/                   día 1: medición (`*.ps1`), `record-drape.js`, bump de versión; `models/` al portar herramientas
├─ docs/                    cómo funciona Halation (vigente)
│  ├─ README.md             índice
│  ├─ architecture/         overview.md al empezar A2; se añaden backend/threading/persistence cuando haya texto real
│  ├─ features/             README.md (índice de trazabilidad) + una spec por función con `Estado:`
│  ├─ design/               design.md único (sistema visual, color, movimiento, layout); se divide cuando crezca
│  ├─ development/          PROJECT_GUIDE.md y development.md (entorno, pruebas, flujo, convenciones)
│  └─ reference/            solo cuando haya un contrato estable (p. ej. formatos de datos de usuario)
├─ planning/                qué se quiere cambiar y por qué
│  ├─ STATUS.md             ≤ 1 página, con fecha y enlaces; si pasa 2 semanas sin actualizarse se borra
│  ├─ ROADMAP.md            ideas aparcadas con su línea de encaje
│  ├─ decisions.md          decisiones aprobadas con fecha, motivo y alcance; una sustituida deja de figurar como vigente
│  └─ active/               solo planes con documento propio (hoy: rediseño visual aprobado a medias)
├─ research/                qué se investigó o midió
│  └─ performance/          informes de render/CPU/GPU/RAM, Drape, frame budgets; con README-índice
├─ archive/                 histórico no autoritativo; no es una copia del proyecto
│  ├─ tauri/                documentos de la arquitectura retirada que sirven al portar
│  ├─ qt-quick/             spec retirada
│  └─ superseded/           documentos sustituidos
├─ installer/               hito C
├─ licenses/                hito C, cuando haya textos que viajen en el instalador
├─ locales/  presets/       cuando existan: hoy la app nativa no tiene i18n ni presets conectados
├─ .claude/                 solo agentes y skills que Claude Code descubre en esa ruta
└─ .github/                 `ci.yml` del workspace, `release.yml` (hito C), `downloads-badge.yml`, plantillas
```

Qué no existe y por qué: `.agents/` (Claude Code no lo lee; sus reglas van a `docs/development/` y `AGENTS.md`),
`planning/proposals/` (hoy no hay ninguna propuesta sin aprobar; los PRs e Issues cumplen ese papel),
`docs/features/<función>/` en carpetas (una spec por fichero basta), `legacy/`, `app/`, `slint/` (el crate pasa a
`crates/`), `archive/migrations/` (hasta que haya una migración terminada).

### 2.1 Qué pasa con Tauri

- `main` no se toca por esta reorganización (correcciones de Tauri aparte).
- La rama Slint nace de la punta de la línea nativa (`claude/project-thread-sgjgrl`, que contiene `slint/visual-home`),
  se prepara en rama aislada y no sustituye a `main` hasta la aprobación de Java con pruebas de compatibilidad.
- Antes de ese corte se crea el tag `tauri-final` sobre el último commit de `main` y la rama `archive/tauri`.
- El updater de las 1.x apunta a `latest.json` de Sylphera/Halation y a la clave minisign actual: el corte no puede
  cambiar esa clave ni el formato de `latest.json` sin migración explícita (`docs/UPDATES.md`).

### 2.2 Clasificación de documentos y destino

Estados: **V** vigente · **P** parcial · **H** histórico · **R** redundante · **S** sin verificar. «Retener» = no se
toca en A1 porque lo necesita B o el hilo de rediseño.

| Origen | Estado | Destino y condición |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `AI_DEVELOPMENT.md` | R/P | `AGENTS.md` (fuente única) + `CLAUDE.md` (`@AGENTS.md`); `AI_DEVELOPMENT.md` pasa a un apartado de `CONTRIBUTING.md`. Contradicciones de §1.2 resueltas en A1 |
| `docs/SLINT_SPEC.md` | P | `docs/features/…` y `docs/architecture/overview.md` repartidos en A2; en A1 se corrige y **se retiene** (workspace, instalador, updater, `%APPDATA%\Halation`, Qt fuera) |
| `docs/SLINT_BACKEND_IMPORT.md` | V | **Retener** hasta el fin de B; su tabla de estado pasa a `docs/architecture/` en A2 |
| `docs/SLINT_VISUAL_SYSTEM.md`, `COLOR_REWORK_SPEC.md`, `MOTION.md` | V/P | **Retener**; A2 los funde en `docs/design/design.md` (la parte Tauri de `MOTION.md` y `COLOR_REWORK_SPEC.md` va a `archive/tauri/`) |
| `docs/UI_REDESIGN_SPEC.md` | V (aprobado a medias) | `planning/active/ui-redesign.md` (**retener**); al implementarse se funde en `design.md` |
| `docs/DECISIONS.md` | V/P | `planning/decisions.md`; lo exclusivo de Tauri (motion web, export WebCodecs…) a `archive/tauri/` |
| `docs/ROADMAP.md` | P | `planning/ROADMAP.md`; corregir Qt Quick e `INTRO_SPEC` inexistente |
| `docs/JOBS_SPEC`, `LIBRARY_SPEC`, `SETTINGS_SPEC`, `SAVE_LOCATION_SPEC`, `PROCESS_MENU_SPEC`, `FRAMERATE_SPEC` | V/P | `docs/features/` con `Estado:` (**retener**: B trabaja contra ellos) |
| `docs/CONVERTER_SPEC`, `COVER_TEST_SPEC`, `GRADE_LOOKS_SPEC`, `VOCAL_REMOVER_SPEC`, `REMOVE_BG_SPEC`, `BACKGROUNDS_SPEC` | V (herramientas no portadas; Drape implementada) | `docs/features/` con `Estado: Prevista`/`Implementada` (**retener**) |
| `docs/ARCHITECTURE.md` (Tauri) | H | `archive/tauri/` (referencia al portar) |
| `docs/DOCK_SPEC.md`, `WINDOW_SPEC.md`, `PREVIEW.md`, `UPDATES.md`, `SIGNING.md`, `signing/` | H/P | `archive/tauri/`; el updater nuevo se especifica en el hito C; `SIGNING.md` y el parche SignPath van a `planning/ROADMAP.md` (firma aparcada) más `archive/` |
| `docs/OPEN_SOURCE.md` | P | Lo vigente (licencia, política) a `CONTRIBUTING.md`/`docs/development/`; el resto `archive/superseded/` |
| `docs/QT_QUICK_SPEC.md` | H | `archive/qt-quick/` |
| `docs/MOTION_TEXT_SPEC.md` | H | `archive/superseded/`, enlazada desde `ROADMAP.md` |
| `docs/performance/**`, `performance-2026-10-04/` | H con valor | `research/performance/` con README-índice: contexto (arquitectura Tauri/WebView), versión y condiciones de cada informe, y si aplica a Slint; sin tratarlos como características actuales |
| `UPSCALE_VIDEO_CHECKPOINT`, `ui-corrections-2026-10-05`, `UI_DEFAULTS_BRANDING_111` | H | `archive/superseded/`; borrar solo con aprobación de Java |
| `docs/OPENCODE_*` (4), `.opencode/` | R (ajeno al producto) | No entran en la rama Slint; quedan en el historial de la rama actual |
| `docs/brand/**`, `screenshots/`, `examples/` | S | `assets/brand/` o `docs/media/` según uso (A1 comprueba qué enlaza el README); `examples/` (12 MB) no entra salvo lo que use el README |
| `app/dist/changelog.md` | R | No existe: `CHANGELOG.md` es la fuente |

Cada fichero que se mueve conserva su historial (`git mv`). Cada documento archivado abre con una línea «Histórico, no
autoritativo; vigente hasta <fecha>/<versión>».

### 2.3 Código y herramientas

La auditoría local (hito 0) y el análisis de los crates deciden el mapa exacto. Punto de partida, con los 20 módulos de
`slint/src` conocidos hoy:

| Origen | Destino |
| --- | --- |
| `slint/src/backend/*` (process, queue, engine, sections, names, destinations, presets, artist_profile, atomic_file) | `crates/halation-core/` |
| `slint/src/{app,navigation,theme,motion,folders,jobs,backdrop,assets,screenshot}.rs`, `slint/ui/**`, `slint/build.rs` | `crates/halation-app/` |
| `slint/src/{profile,settings,library,catalog}.rs` | Se parten solo si mezclan modelo/persistencia (core) con modelos de Slint (app); si un módulo es cohesivo se mueve entero |
| `slint/tests/{engine,folders,process,sections,services}.rs` | `crates/halation-core/tests/` |
| `slint/tests/ui_layout.rs` | `crates/halation-app/tests/` |
| `slint/assets/**` | `assets/` |
| `slint/scripts/*`, `record-drape.js` | `tools/` |
| `app/scripts/{bump-beta,exe-icon,release-smoke,installer-parity}.js` | Se reescriben en `tools/` en B/C solo si la rama Slint los necesita; el original sigue en `main` |
| `app/scripts/*.py` (htdemucs, sam2.1) | `tools/models/` cuando se porten esas herramientas |
| `app/**` (frontend, `src-tauri`, tests, resto de scripts) | No se copian; viven en `main`, `v1.2.0` y `tauri-final` |

## 3. Cómo se entiende el repo

- `README.md`: función pública actual + mapa del repo (árbol a un nivel) + enlaces a compilar, contribuir, arquitectura,
  interfaz y estado.
- `docs/README.md`: tabla «si vas a tocar X, lee Y».
- `docs/development/PROJECT_GUIDE.md`: recorridos reales de la app (p. ej. «el usuario inicia un trabajo → vista Slint →
  controlador → cola de jobs → motor → resultado → UI»), salidos del código y no de un esquema, con errores,
  cancelación y recursos.
- README de carpeta solo en `crates/*` (qué entra y qué no, dependencias permitidas), `tools/` y `research/performance/`.
- Módulos importantes de `halation-core`: comentario `//!` de 3–5 líneas (responsabilidad, comportamiento expuesto,
  dependencias, invariantes). Sin comentarios que repitan el código.
- **Índice de trazabilidad** (`docs/features/README.md`): función · pantalla · módulo · spec · pruebas · estado ·
  evidencia. CI comprueba que rutas y enlaces existen y que cada spec tiene `Estado:`. **El estado no se infiere de la
  existencia de una ruta**: «Implementado y verificado» exige una evidencia enlazada (test concreto, medición o OK
  visual de Java con fecha). Una función con ruta y sin evidencia figura como «Implementada, sin verificar».
- `AGENTS.md`: reglas globales imprescindibles con enlaces a `docs/development/`; reglas operativas de la propuesta
  (leer lo relevante, no refactorizar fuera de alcance, no convertir lo provisional en contrato, no ocultar errores,
  declarar lo no verificado, ningún merge/release/destructivo sin autorización).

## 4. Hitos y fases

Cada fase: commits pequeños y reversibles, tag de retorno antes de empezar (`pre-<hito>`), CI en verde, y sin tocar
ramas o worktrees con agentes activos. Operaciones destructivas y el merge a `main`, solo con aprobación de Java.

### Hito 0 — Auditoría local (previo a todo)

Requiere una sesión Remote Control en KernelPanic (esta sesión solo ve GitHub). Salida: informe con árbol real, worktrees,
ramas locales y remotas, commits sin subir, stashes, archivos sin seguimiento, qué hilos siguen activos y sobre qué
ficheros. Solo lectura. **Criterio**: el informe distingue lo comprobado en local de lo visto en GitHub; si un
agente trabaja en ficheros que el plan mueve, el hito siguiente se retrasa.

### Hito A1 — Instrucciones y documentación

1. Rama aislada desde la punta de la línea nativa. 2. `AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`, resolviendo las
contradicciones de §1.2. 3. Clasificar cada `.md` (tabla §2.2) y crear `archive/`, `research/`, `planning/` solo con
lo que tenga contenido. 4. Mover specs a `docs/features/` con `Estado:`. 5. Comprobador de enlaces Markdown (script en
`tools/`, sin Node en la ruta de compilación).

**Condición**: no se elimina ni se archiva ninguna spec marcada «retener» o con `Estado: Prevista/En curso`; los
borrados de §2.2 requieren aprobación expresa. **Criterios**: cero enlaces rotos; cada documento con estado; un agente
nuevo llega a sus instrucciones sin contradicciones leyendo `AGENTS.md`; `cargo build` y los tests del crate actual no
cambian de resultado.

### Hito B — Arquitectura Rust

Lo ejecuta el hilo de la reestructuración en crates ya aprobado (un solo hilo mueve estos ficheros). Fases: B1 workspace con
un crate que compila lo mismo; B2 extraer `halation-core` módulo a módulo con tests tras cada uno; B3 organizar
`halation-app` por dominios solo donde haya cohesión probada; B4 `assets/`, `tools/` y rutas; B5 CI del workspace.
**Criterios**: `cargo fmt --check`, `clippy --all-targets -D warnings`, `cargo test`, build release; `cargo tree -e features`
mantiene winit + Skia sin Qt/FemtoVG/software en el runtime; `halation-core` no depende de Slint (comprobado por grafo de
dependencias); sin ciclos; assets resueltos junto al exe y en `cargo run`; el comportamiento de las pantallas existentes
se comprueba contra las capturas offscreen y la revisión visual de Java antes de cerrar. Compilar no prueba equivalencia
funcional: cada módulo movido conserva sus tests y se añade la comprobación directa de lo no cubierto.

### Hito A2 — Documentación de la arquitectura definitiva

`docs/architecture/overview.md` (y backend/threading/persistence solo con texto real), `docs/design/design.md`,
`PROJECT_GUIDE.md`, índice de trazabilidad con evidencias, `//!` en módulos, actualización de `AGENTS.md`.
**Criterios**: prueba humana de la propuesta (encontrar una función, su UI, su backend y sus pruebas en pocos pasos) y
prueba de agente (instrucciones sin contradicciones, autoridad clara); CI de rutas, enlaces y `Estado:` en verde.

### Hito C — Distribución

NSIS e `installer/` (layout `assets\`, `locales\`, `presets\`, `licenses\` junto al exe), datos en `%APPDATA%\Halation`,
`halation-updater` (verificación de firma, instalador `/UPDATE`, reversión), compatibilidad con `latest.json` de las 1.x.
**Criterios**: instalación y actualización real en KernelPanic; el updater no publica nada por sí mismo; releases solo con
orden expresa.

### Hito D — Migración de datos Tauri → nativa (requisito del corte)

Hoy Tauri guarda en `Documents\Halation` (`Settings\app.json`, `Sessions\`, presets) y en `%LOCALAPPDATA%\Halation` (workspace);
la nativa usa un perfil propio y está previsto `%APPDATA%\Halation`. Empieza con un inventario de qué datos existen y qué
se migra. Cubre ajustes, Library (referencias y secciones), presets y sesiones; sin modificar ni borrar los datos
originales. **Criterios**: migración idempotente y reversible con datos reales de prueba (hechos con nombres inventados),
fallo cerrado si el origen está dañado, y prueba de actualización 1.2.0 → nativa antes de cualquier corte.

### Orden y dependencias

0 → A1 → B → A2 → C, y D en paralelo a C pero antes del corte. El rediseño visual (`UI_REDESIGN_SPEC` §11) va después de B.
A1 y A2 no dependen del updater.

## 5. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Mover ficheros con un agente activo sobre ellos | Hito 0 y rama aislada; ninguna fase empieza si hay solapamiento |
| Perder una spec que B necesita | Lista «retener» en §2.2; A1 no borra |
| Dos hilos moviendo los mismos ficheros (crates y rediseño) | Un solo hilo para B; el rediseño espera |
| Documentación que queda obsoleta durante B | A2 después de B |
| Índice de trazabilidad con estado falso | Estado solo con evidencia; CI solo comprueba rutas |
| Pérdida de datos de usuario al migrar | Hito D, solo lectura sobre el origen, sin corte hasta probar con datos reales |
| Referencias a `docs/` desde el código Tauri | No afecta: el código Tauri queda en `main` |

## 6. Coste de la ejecución (estimación relativa, no medida)

Un hilo normal de implementación en High vale 1.

| Hito | Coste | Condicionante |
| --- | --- | --- |
| 0 Auditoría local | 0,3 | Sesión Remote Control, solo lectura |
| A1 | 0,5 | Reescribir y clasificar ≈ 45 `.md`, sin compilar |
| B | 1,5 – 2 | Compilar y probar tras cada módulo extraído |
| A2 | 0,5 – 0,7 | Documentación de lo ya estable |
| C | 2 – 3 | NSIS, CI, updater con seguridad y prueba real |
| D | 1 – 1,5 | Depende del inventario de datos |

A1 + B + A2 ≈ 2,5 – 3,2 hacen el repo entendible y el workspace modular; C y D son proyectos propios.

## 7. Fuera de alcance

Diseño visual, UX o funciones; portar herramientas desde Tauri; reescribir código funcional; abstracciones sin problema
demostrado; cambiar el comportamiento del instalador, updater o formatos de datos fuera de los hitos C y D; publicar
versiones; fusionar la línea nativa con `main`.
