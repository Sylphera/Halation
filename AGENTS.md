# Working on Halation

The one source of instructions for every agent (Claude Code, Codex or any other) and the rules human contributors
follow too. `CLAUDE.md` only points here. Where this file and an older document disagree, this file wins; where the
user's current instructions disagree with it, the user wins.

## First contact: automatic repository onboarding

On entering this native checkout for a coding task, **without needing the user to request it**, read this `AGENTS.md` and run `python tools/dev.py onboard` once. Then select the relevant `python tools/dev.py map <feature>` and use `symbols <feature> --find <name>` for targeted source. These read-only commands are optional only if Python is unavailable (report that and inspect the same documented paths manually). Do **not** run full Cargo, `cargo run`, releases, installers, screenshot batches, or migrations as onboarding. The architecture is in [docs/architecture/overview.md](docs/architecture/overview.md), current design in [docs/design/design.md](docs/design/design.md), real code paths in [docs/development/PROJECT_GUIDE.md](docs/development/PROJECT_GUIDE.md), evidence in [docs/features/README.md](docs/features/README.md), and release/data gates in [docs/architecture/distribution.md](docs/architecture/distribution.md).

This instruction is the **only** global policy. `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` are pointers for their respective clients, not alternative rules. An assistant may need the user's connected workspace/checkout to run commands; never imply that a chat without filesystem access automatically ran anything. CI checks this wiring but cannot force an external AI client to obey instructions.

## What this branch is

- **Halation Slint** (native integration branch `slint/native`; isolated work may use `slint/dev-workflow` or another native branch): the unreleased rebuild in **Rust + Slint 1.18.1 + Skia**, a Cargo
  workspace under `crates/`. Confirm the actual checkout with `git status --short --branch` before editing.
- **Halation Tauri** (`main`, tags `v1.2.0` and later `tauri-final`): the published app (Tauri 2, plain HTML/JS/CSS,
  Rust backend in `app/src-tauri`). It is the reference for behaviour and the source of reusable backend code. Its
  code is read from Git (`git show main:app/...`, a checkout of `main`), never copied into this tree wholesale.
- Nothing merges into `main` without Java's explicit approval, including the cut-over from Tauri to this line
  (Java, 2026-10-21). This replaces, for this line, the older rule that agents squash-merge to `main` once CI is green.

## Where things are

Start with [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for a short human/agent workflow and the `python tools/dev.py map <feature>` code/spec/test locator. Use `python tools/dev.py symbols <feature> --find <name>` for a bounded source location, and `python tools/dev.py handoff --base <ref>` to transfer factual progress into a new session without replaying the whole history. [docs/README.md](docs/README.md) indexes active documentation. The map:

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
- No **release/distributable builds** or releases of this line until Java orders one. `cargo check`, targeted `cargo test` and `cargo fmt --check` are developer validations, not release builds. `cargo build --release`, packaging and distribution require explicit approval. Merges carry no `[build]`.
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

## Checks - meaningful gates, not a compile-per-edit loop

`python tools/dev.py check` derives a minimal dry-run verification plan from actual changed files (including staged/unstaged/untracked paths). Use `--base <branch>` to include committed changes relative to a shared base, `--mode targeted` for a meaningful integrated unit, and `--run` only when you intend to execute checks. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). This helper is not a replacement for a missing integration or visual check.


**During implementation:** first finish a coherent vertical change (required Rust APIs, Slint/controller wiring and focused tests) before invoking Cargo. Do not run `cargo fmt` or a full test suite after each patch or after merely rereading a file. Use `cargo fmt --check` and a narrow `cargo check -p <changed-crate>` / targeted `cargo test -p <changed-crate> <test-filter>` when the change is sufficiently assembled to compile. For UI-only changes, prefer the fast existing layout/static tests at the same milestone. Compile/test sooner only to resolve a genuine API uncertainty that blocks further work.

**Before declaring an integrated task ready:** run the *relevant* checks and the connected-area regressions. If the task impacts most of the workspace, the wider gate is:

```powershell
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo tree -e features -p halation-app   # verify winit + Skia
python tools/check-docs.py              # links and Status: lines
```

`cargo build --release` / packaging is a separate release gate: run it only when explicitly approved. Never silently omit a justified check; if unavailable or deliberately deferred, report it as pending. Do not install tools or run irrelevant scans.

If the same underlying compiler, test, or patch failure persists after **two focused corrections**, stop applying micro-patches. Inspect the full affected interface/callers once, state the root cause, and revise the approach before continuing. Track progress as working behavior and passing tests, not number of edits or commands.

## How to work

1. Understand before touching: the spec, the code, its tests and recent decisions. Do not edit by intuition.
2. Say briefly what changes and what must stay the same, and how Rust and Slint split the work.
3. Implement in **coherent, integrated slices** (core + controller + Slint + focused tests as needed), not dozens of tiny patches that each trigger a compile. Check at the milestone, not at every edit. Before coding, inspect the original Tauri behavior, existing native interfaces and acceptance tests relevant to the slice; do not invent an underspecified architecture first.
4. Do not trust existing tests alone: check uncovered behaviour directly or add a test.
5. Compiling or passing tests does not mean done. Look for regressions in connected areas (Jobs, Library, Settings,
   sessions, processes, export, navigation).
6. Never hide a failure: no disabled tests, relaxed asserts or specs bent to broken behaviour.
7. Before closing, re-read the spec point by point, then report what changed, what was checked (commands and results)
   and what is still unverified.
8. An interrupted task resumes from the exact point reached; do not redo finished work or assume the last commit
   closed it.
9. Prefer precise symbols/searches and targeted file ranges to repeated whole-file reads. After an edit, revisit only the changed region or its callers unless a broader audit is justified. Do not reread an unchanged large file merely to recover context.
10. Keep separate worktrees independent. Before changing shared integration files (`app.rs`, `app.slint`, `Cargo.toml`, models, locales), identify existing WIP and the integration owner; never overwrite another worker's uncommitted work. Deliver a cohesive checkpoint rather than postponing all integration until the end.
11. For visual verification, generate captures only at UI milestones, then use a **short, dedicated review context** where possible. Keep only the current relevant comparisons in that context. Repeatedly reading the same PNGs into a long-running implementation conversation is costly and can destabilize prompt-cache reuse. Native-window visual approval remains Java's decision.
12. After repeated tool failures or when a conversation has become very long, write a short handoff with paths, changes, verified tests, exact remaining requirements and known blockers; resume in a fresh session when appropriate. Do not continue until the context limit simply because it is available.

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
