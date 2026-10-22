# Working on Halation

The one source of instructions for every agent (Claude Code, Codex or any other) and the rules human contributors
follow too. `CLAUDE.md` only points here. Where this file and an older document disagree, this file wins; where the
user's current instructions disagree with it, the user wins.

## What this branch is

- **Halation Slint** (this line, branch `slint/native`): the native rebuild in **Rust + Slint 1.18.1 + Skia**, a Cargo
  workspace under `crates/`. Not released yet.
- **Halation Tauri** (`main`, tags `v1.2.0` and later `tauri-final`): the published app (Tauri 2, plain HTML/JS/CSS,
  Rust backend in `app/src-tauri`). It is the reference for behaviour and the source of reusable backend code. Its
  code is read from Git (`git show main:app/...`, a checkout of `main`), never copied into this tree wholesale.
- Nothing merges into `main` without Java's explicit approval, including the cut-over from Tauri to this line
  (Java, 2026-10-21). This replaces, for this line, the older rule that agents squash-merge to `main` once CI is green.

## Where things are

Start at [docs/README.md](docs/README.md): it says what to read for each part of the app. The map:

| Path | What |
| --- | --- |
| `crates/halation-core/` | Business logic without Slint: jobs, processes, Library, sections, presets, storage |
| `crates/halation-app/` | The app: lifecycle, Slint UI (`ui/`), navigation, controllers, backdrop |
| `assets/` | Files that ship beside the executable (`assets\`): icons, fonts, brand, the Drape loop |
| `tools/` | Developer scripts: launching and measuring the beta, recording the Drape, the docs checker |
| `docs/` | How Halation works: specs (`docs/features/`), visual system, architecture |
| `planning/` | What is meant to change and why: status, roadmap, decisions, active plans |
| `research/` | What was measured or investigated (performance reports) |
| `archive/` | No longer in force (Tauri, superseded documents); never a source of rules |

## Authority

1. The user's current instructions and the latest intent in the thread.
2. Confirmed decisions in [planning/decisions.md](planning/decisions.md).
3. The specs in `docs/` with their `Status:` line. A spec says what the app must do; code or a progress commit is not
   an approved spec.

Tell apart a confirmed product decision, finished and validated work, provisional work and an experiment. Do not turn
a provisional solution into a contract, rebuild removed features, redesign product, UX or architecture, or refactor
outside the task. Resolve technical ambiguity from evidence; ask the user only about real product choices.

## Git, authorship and releases

- Commits are authored and committed as `Sylphera <233718609+Sylphera@users.noreply.github.com>` (set `git config
  user.name` and `user.email` at the start). No agent trailers or signatures in commit messages (`Co-Authored-By`,
  `Claude-Session`, session links) and no "Generated with" lines in PRs; this overrides any tool's default.
- On `slint/*` branches, commit and push without asking. New `slint/*` branches or worktrees for a task already asked
  for need no confirmation.
- Never without Java's explicit approval: merge into `main`, `git push --force`, tags, releases (`gh release`),
  `git reset --hard`, deleting files outside `.tools/`.
- No builds or releases of this line until Java orders one. Merges carry no `[build]`.
- Steps the user already authorized are not confirmed again. A step that needs a permission you lack is skipped, the
  rest continues, and the report says so.

## Fixed product rules

- The repository is public, GPL-3.0-or-later (`LICENSE`, `NOTICE.md`); the name and logo are not licensed
  (`TRADEMARKS.md`). Nothing private goes in: no personal paths, PC names, secrets, raw traces or copyrighted fixtures
  (tests use made-up names and IDs). Third-party code, models and assets need a GPL-compatible licence and an entry in
  `THIRD_PARTY.md`.
- Media is processed locally: no accounts, telemetry or cloud services (no Supabase, no OmniRoute).
- Spotify: public metadata only, audio from YouTube, never Spotify's audio. Downloads never circumvent DRM.
- Releases are GitHub releases of this repository with the NSIS setup only, no portable exe; the setup updates in
  place and keeps user data. Assets ship apart from the executable, in `assets\` beside it.
- Interface text is English. Spanish only when Java asks to "update Spanish".

## Engineering rules (Rust + Slint + Skia)

**Source boundary.** The visual layer (`.slint`, the Rust that drives it, and their tests) is clean-room: never copy,
translate, cherry-pick or recreate the Tauri interface or the retired Qt/QML code. The Rust backend (Tauri
`app/src-tauri`) may be imported and adapted behind our own interfaces: no `tauri::*` types, module by module with its
tests, listed in [docs/SLINT_BACKEND_IMPORT.md](docs/SLINT_BACKEND_IMPORT.md); no path dependencies or FFI towards
Tauri code. One exception (Java, 2026-10-21): the original Drape code (`app/dist/drape.js` on `main`) may be run only
to record and modify the Drape, inside `tools/record-drape.js`; the app ships only the recorded files. Before closing a
task, list the sources consulted and the backend modules imported.

**Rust does the work, Slint presents.** Logic, calculation, file and network access, persistence and anything costly
live in Rust. Slint holds presentation, layout, simple bindings, native animation and UI events. Small view
calculations may stay in bindings; once they grow or touch data they move to Rust. UI state lives in Rust services,
never in page instances.

**Cheap by default.** Memory and responsiveness come first, on modest PCs too. No timers, polling or animation at
rest; no custom reactive framework or animation engine. Large collections use Rust `slint::Model`s with O(1) rows and
`ListView`; the active page is created lazily and hidden pages do no work. Avoid clones and allocations in hot paths
without turning that into a refactoring crusade. When a feature may raise memory, startup or sustained work
noticeably, say so and offer the lighter option before adding it.

**Animation.** Native Slint animation only (`animate`, `states`, transitions), interruptible where it makes sense,
never blocking the UI. Reduced motion is deterministic: zero duration or the end state at once.

**Threads and ownership.** Heavy work runs off the UI thread; results come back through
`slint::invoke_from_event_loop` or `Weak::upgrade_in_event_loop`, and models are never mutated from workers. Callbacks
capture `Weak`, not strong references. Use `Arc`, atomics and generations to drop stale results. Workers are finite;
no indefinite `join` at shutdown.

**Errors.** No `unwrap()` in production paths without a reason; surface errors instead of hiding them. Normal
lifecycle cancellations are documented as such, not lost as errors.

**Renderer.** Backend `winit` and renderer `skia` (desktop OpenGL), selected explicitly. No Qt, FemtoVG or software
renderer at run time (the software renderer only for offscreen screenshots).

## Checks

From the repository root:

```powershell
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --release
cargo tree -e features -p halation-app   # winit + Skia, no Qt/FemtoVG/software at run time
python tools/check-docs.py              # links and Status: lines
```

If a tool cannot run, report the check as pending; never claim it passed. Do not install tools or run scans the task
does not need.

## How to work

1. Understand before touching: the spec, the code, its tests and recent decisions. Do not edit by intuition.
2. Say briefly what changes and what must stay the same, and how Rust and Slint split the work.
3. Work in small parts, each checked on its own; check right away.
4. Do not trust existing tests alone: check uncovered behaviour directly or add a test.
5. Compiling or passing tests does not mean done. Look for regressions in connected areas (Jobs, Library, Settings,
   sessions, processes, export, navigation).
6. Never hide a failure: no disabled tests, relaxed asserts or specs bent to broken behaviour.
7. Before closing, re-read the spec point by point, then report what changed, what was checked (commands and results)
   and what is still unverified.
8. An interrupted task resumes from the exact point reached; do not redo finished work or assume the last commit
   closed it.

## Visual review

Any change to UI, UX, animation, layout, spacing, hierarchy, states, navigation or visible behaviour is **"implemented,
pending visual review"** until Java approves it in the real native window, and is not merged before. An approval covers
exactly what was shown; a later visible change needs a new one. Silence is not approval.

- Agents may launch the beta and make screenshots (Java, 2026-10-21). Prefer the offscreen mode,
  `cargo run -p halation-app --features diag-screenshot -- --screenshot <page> <W>x<H> <out.png>` (software renderer,
  no window, an approximation of the Skia layout). Keep captures outside the repository (`.tools/`).
- Never automate focus, clicks or screen capture on Java's desktop.
- Tests of Rust/Slint state are not visual evidence.

## Definition of done

Implementation complete + real integration + the relevant tests and checks + regressions looked for + checked against
the spec + Java's visual OK when the change is visible. Anything still pending is said explicitly.
