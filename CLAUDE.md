# Halation

Windows desktop app. Read this file only; other docs are read when a prompt names them.

## Stack

- Tauri 2 (reference app, unchanged): interface plain HTML/JS/CSS in `app/dist`, no framework or bundler; backend Rust
  in `app/src-tauri/src`, one module per area; `main.rs` only registers commands.
- Native rebuild: **Rust + Slint 1.18.1 + Skia** in the standalone `slint/` crate. All logic, I/O, persistence and
  heavy work in Rust; `.slint` files only for presentation, layout, simple bindings, native animation and events.
  Backend `winit`, renderer `skia`, selected explicitly. No Qt, QML, C++/CMake or cxx-qt.
- Source boundary (Java, 2026-10-21): the visual layer (`.slint` and the Rust glue that drives it, plus its tests) is
  clean-room: do not copy, translate, cherry-pick or recreate prior UI (Tauri interface, Qt/QML, Qt bridges/tests). The
  Rust backend (services, jobs, Library, settings; Tauri `app/src-tauri`, `halation-core`) is kept and may be imported and
  adapted behind own interfaces, with no `tauri::*` types, a short plan in `docs/` and its tests. No path dependencies or
  FFI towards `app/src-tauri` or Qt code; public crates plus pure identity/reference assets are allowed.
- FFmpeg, yt-dlp, upscayl-bin, rife-ncnn-vulkan, the Cutout model (ONNX Runtime Web), Pandoc, LibreOffice and PDFium are
  downloadable components of the Tauri app. The Slint beta has no engines connected.
- Tests: Playwright on headless Chromium with the backend mocked in Node (`app/tests/host.js`), plus `cargo test` for
  Tauri. The Slint crate uses headless Rust service/model tests; UI visual review is a native-window manual gate.

## Build and test

- Tauri while iterating: the mocked backend and the tests of the area touched (`node app/tests/<file>.js`).
- Tauri at the end: only the tests of what the task changed; the Node test files of the areas touched, plus cargo
  check, clippy `-D warnings` and cargo test when Rust changed. The full suite (`cd app && npm run verify`; `npm test`
  without cargo, `--force` runs everything) only when asked.
- Slint: `cd slint`, then `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
  `cargo build --release`. Confirm `Cargo.lock` and feature graph keep winit + Skia; no Qt/FemtoVG/software runtime.
- Slint visual review: the worker may launch the beta and generate screenshots (Java, 2026-10-21). Prefer the offscreen
  mode `cargo run --features diag-screenshot -- --screenshot <page> <W>x<H> <out.png>` (software renderer, no window, no
  clicks, so the desktop is untouched; it is an approximation of the Skia layout and says so); never automate the focus,
  clicks or screen capture of Java's desktop. Save captures outside the repo (a `.tools` folder). Tests and captures do
  not prove frame pacing or hardware rendering; Java's visual OK is still required to merge.
- Screenshots for the Tauri app go to `$SHOTS`; every visual change is looked at, once at the end. Subagents
  `test-runner` and `visual-reviewer` (`.claude/agents/`) run Tauri checks and review screenshots.
- A Tauri change `host.js` cannot replicate (Rust, export) is also tested once against the real binary
  (`npm run test:real`). Tauri previews are tried on the portable exe with the current frontend injected; rebuild only
  when backend code changes (Java, 2026-10-14).
- Caches stay on (Rust `target/`, Cargo registry, fixtures, `node_modules`); no clean build unless needed.
- `npm run i18n:missing`: Spanish keys missing. `npm run tauri build`: Tauri local build (CI builds releases).

## Conventions

- New Tauri interface text only in `app/dist/locales/en.json` (`t()` / `data-i18n`); `es.json` only when asked to
  "update Spanish". Missing Spanish keys fall back to English. Slint beta text is English in the `.slint`/Rust sources;
  there is no shared locale system in the beta.
- Release only with a `[build]` commit, the last of a task (one build per task). It runs
  `node app/scripts/bump-beta.js --set <v>` and adds the version's section to `CHANGELOG.md` (English). No Slint
  release is authorized by this rule.
- Implementation threads run at High effort, one phase after another; no agent teams, no fast mode.
- Tauri: one code file per tool, split into sections `/* ===== name ===== */`; `docs/ARCHITECTURE.md` has the code map
  (file + function). Prompts name the files to touch; read those, no wide searches unless needed. Keep the surrounding
  style.
- Tauri colours only through `app/dist/tokens.css`; animations only through `app/dist/motion.js` and the motion tokens
  (`docs/MOTION.md`: one critically damped spring, four tokens, interruptible with the speed carried over, transform
  and opacity (blur only for depth), skeletons instead of loaders, a short fade with reduced motion).
- Slint colours come from the Rust `theme` constants applied to the Slint `Theme` global; controls must stay legible
  under any Windows theme. Motion uses native Slint animation only, with deterministic reduced-motion behavior.
  Business state lives in Rust services, never in page instances.

## Fixed restrictions

- The repository is public and open source: GPL-3.0-or-later (`LICENSE`, `NOTICE.md`); the name and logo are not
  licensed (`TRADEMARKS.md`). Nothing private goes in it: no personal paths, PC names, secrets, raw traces or
  copyrighted fixtures (tests use made-up IDs and names). Releases are GitHub releases of this same repository with the
  NSIS setup only (no portable exe); the setup updates in place and keeps user data.
- Authorship (every agent: Claude Code, Codex or any other): commits are authored and committed as
  `Sylphera <233718609+Sylphera@users.noreply.github.com>` (`git config user.name` and `user.email` at the start of each
  session). Commit messages carry no agent trailers or signatures (`Co-Authored-By`, `Co-authored-by`, `Claude-Session`,
  links to agent sessions) and PR descriptions no "Generated with" lines; this rule overrides any default attribution.
  Agents open their pull requests and squash-merge them into `main` themselves once CI is green, without waiting for
  Java (Java, 2026-10-13 and 2026-10-14).
- Spotify: public metadata only, the audio comes from YouTube. Never Spotify's audio.
- No OmniRoute. No Supabase or cloud services.
- On `slint/*` work branches, commit and push without asking (Java, 2026-10-21). Never without Java's explicit approval:
  merge to `main`, `git push --force`, tags, releases (`gh release`), `git reset --hard`, deleting outside `.tools/`.
  Creating a new `slint/*` worktree or branch for a task that was asked for needs no confirmation.
- Do not re-confirm steps the user already authorized; if a step needs a permission you lack, skip it, continue with the
  rest and note it in the report.
- Backend, jobs and Library work continues on its own while no visual review is needed; the visual layer stays a demo
  with screenshots until Java reviews it.

## Folders

- `slint/`: standalone Rust + Slint beta crate: `src/` (services, models, controller), `ui/` (`.slint` shell, pages,
  components, theme), `assets/` (product mark), `tests/` (headless state tests), `scripts/` (beta launcher). Canonical
  spec: `docs/SLINT_SPEC.md`.
- `app/dist/`: `index.html` + `shell.js` (main window) + `atmosphere.js` + `drape.js` + `blue-noise.js` (window background) + `welcome-background.js` (Welcome) + `services.js` (`window.__hal`: Library data, Crop,
  Cutout, Frame Grab's extractor); per tool `<tool>.html`, `<tool>.css`, `<tool>.js` (`visualizer`, `grade`,
  `framegrab`, `downloader`, `upscale`, `interp`, `removebg`, `convert`); shared `grader.js`, `common.js`, `avplay.js`, `updates.js` (updater; `docs/UPDATES.md`), `tokens.css`, `ui.css`, `motion.js`, `encoder.js`, `modules.js`, `locales/`.
- `app/src-tauri/src/`: Rust commands. `app/scripts/`: version bump, icons, i18n.
- `app/tests/`: Playwright suite, `host.js`, `verify.js`.
- `docs/`: `SLINT_SPEC.md` (canonical native rebuild spec), `ARCHITECTURE.md` (Tauri code map, export), `MOTION.md`
  (Tauri motion rules, tokens, waits), `DECISIONS.md`, `ROADMAP.md` (parked ideas).
- `.claude/`: agents and skills (`playwright-cli`, `context7`, `frontend-design`).
