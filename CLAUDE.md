# Halation

Windows desktop app. Read this file only; other docs are read when a prompt names them.

## Stack

- Tauri 2. Interface: plain HTML/JS/CSS in `app/dist`, no framework or bundler.
- Backend: Rust in `app/src-tauri/src`, one module per area; `main.rs` only registers commands.
- FFmpeg, yt-dlp, upscayl-bin, rife-ncnn-vulkan, the Cutout model (ONNX Runtime Web), Pandoc, LibreOffice and PDFium are
  downloadable components.
- Tests: Playwright on headless Chromium with the backend mocked in Node (`app/tests/host.js`), plus `cargo test`.

## Build and test

- While iterating: the mocked backend and the tests of the area touched (`node app/tests/<file>.js`).
- Once at the end, only the tests of what the task changed (Java, 2026-09-29: the full suite takes over an hour in the
  container): the Node test files of the areas touched, plus cargo check, clippy `-D warnings` and cargo test when Rust
  changed. The full suite (`cd app && npm run verify`; `npm test` without cargo, `--force` runs everything) only when
  asked.
- Screenshots go to `$SHOTS`; every visual change is looked at, once at the end. Subagents `test-runner` and `visual-reviewer`
  (`.claude/agents/`) run the checks and review the screenshots.
- A change `host.js` cannot replicate (Rust, export) is also tested once against the real binary (`npm run test:real`).
- Previews for Java are tried on the portable exe with the current frontend injected; it is rebuilt only when a
  backend changes its implementation (Rust in `app/src-tauri` or any other backend code) (Java, 2026-10-14).
- Caches stay on (Rust `target/`, fixtures, `node_modules`); no clean build unless needed.
- `npm run i18n:missing`: Spanish keys missing. `npm run tauri build`: local build (CI builds releases).

## Conventions

- New interface text only in `app/dist/locales/en.json` (`t()` / `data-i18n`); `es.json` only when asked to
  "update Spanish". Missing Spanish keys fall back to English.
- Release only with a `[build]` commit, the last of a task (one build per task). It runs
  `node app/scripts/bump-beta.js --set <v>` and adds the version's section to `CHANGELOG.md` (English).
- Implementation threads run at High effort, one phase after another; no agent teams, no fast mode.
- One code file per tool, split into sections `/* ===== name ===== */`; `docs/ARCHITECTURE.md` has the code map
  (file + function). Prompts name the files to touch; read those, no wide searches unless needed. Keep the
  surrounding style.
- Colours only through `app/dist/tokens.css`; animations only through `app/dist/motion.js` and the motion tokens
  (`docs/MOTION.md`: one critically damped spring, four tokens, interruptible with the speed carried over, transform
  and opacity (blur only for depth), skeletons instead of loaders, a short fade with reduced motion).

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

## Folders

- `app/dist/`: `index.html` + `shell.js` (main window) + `atmosphere.js` + `drape.js` + `blue-noise.js` (window background) + `welcome-background.js` (Welcome) + `services.js` (`window.__hal`: Library data, Crop,
  Cutout, Frame Grab's extractor); per tool `<tool>.html`, `<tool>.css`, `<tool>.js` (`visualizer`, `grade`,
  `framegrab`, `downloader`, `upscale`, `interp`, `removebg`, `convert`); shared `grader.js`, `common.js`, `avplay.js`, `updates.js` (updater; `docs/UPDATES.md`), `tokens.css`, `ui.css`, `motion.js`, `encoder.js`, `modules.js`, `locales/`.
- `app/src-tauri/src/`: Rust commands. `app/scripts/`: version bump, icons, i18n.
- `app/tests/`: Playwright suite, `host.js`, `verify.js`.
- `docs/`: `ARCHITECTURE.md` (code map, export), `MOTION.md` (motion rules, tokens, waits), `DECISIONS.md`, `ROADMAP.md` (parked ideas).
- `.claude/`: agents and skills (`playwright-cli`, `context7`, `frontend-design`).
