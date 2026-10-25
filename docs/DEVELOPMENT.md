# Develop Halation Native

This guide is for human contributors and coding agents. It applies to the **Rust + Slint** worktree, not the published Tauri app on `main` and not retired Qt experiments. Product decisions and source restrictions live in [`AGENTS.md`](../AGENTS.md); behavior is defined by the active feature specs, not this guide.

## Get oriented in under a minute

Requirements: Windows 10/11, Git, Python 3.11 or newer (standard library only for developer tooling; CI pins 3.12) and the Rust/MSVC toolchain pinned by [`rust-toolchain.toml`](../rust-toolchain.toml).

From the repository root:

```powershell
python tools/dev.py onboard
python tools/dev.py doctor
python tools/dev.py map
python tools/dev.py map settings
python tools/dev.py symbols settings --find search
python tools/dev.py changes
python tools/dev.py check
```

These commands do not need dependencies installed beyond Git and Python to inspect the checkout. `onboard` provides a short Git-backed and source-backed introduction. Coding agents whose clients read `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or GitHub Copilot's instructions are directed to run it *without the user asking*. Other tools must be configured to read the root policy; the repository cannot enforce arbitrary external clients. `doctor` reports missing Rust tooling but never installs it. `map` gives the *smallest useful reading list* for a feature: active specs, relevant code and existing tests. Planned features show **no implementation** rather than fabricated files. `symbols <feature> --find <name>` prints **bounded file:line symbol references** for existing Rust and Slint code, without dumping large files (default 35 entries; use `--limit` to adjust). `changes` lists staged, unstaged and untracked paths. `check` proposes a test plan without running it.

For a branch with committed work, compare from its integration base:

```powershell
python tools/dev.py changes --base slint/frame-ui
python tools/dev.py check --base slint/frame-ui --mode targeted
python tools/dev.py handoff --base slint/frame-ui
```

`--base` uses Git's merge base for committed changes and also includes local changes. `handoff` produces a concise **factual** checkpoint for another person/agent: branch, changed files, likely areas and checks still to run. It intentionally does not claim any tests passed or any feature is finished. No operation checks out another branch, fetches remote code, stages, commits, or changes your working tree.

## Work on a feature, not a hundred micro-patches

A successful unit of work should deliver **one coherent behavior end to end**: feature logic in `halation-core` if appropriate, controller in `halation-app`, Slint presentation, and targeted regression tests. The stages are:

1. **Understand**: `python tools/dev.py map <feature>`. Read the *relevant* spec, current interfaces and tests. When migrating a feature, inspect the original Tauri behavior (`git show main:...`) before designing the native backend. Tauri **backend** Rust may be adapted within the clean-room boundary; copying its UI is forbidden.
2. **Define acceptance**: write a handful of observable cases, including errors, persistence, edge states and integration with navigation/jobs when applicable. Do not use LOC added, files edited or passing mocks as the sole measure of done.
3. **Implement one connected slice**: group related edits; if a patch fails twice for the same underlying reason, examine the actual interface and redesign rather than patching blindly. Avoid rereading a large unchanged file: use search and narrow line ranges. Never overwrite another worker's uncommitted work.
4. **Verify at a milestone**: first plan with `python tools/dev.py check --mode targeted`, then *explicitly* add `--run` when the unit is coherent and has a chance of compiling. Preserve tests; do not run Cargo after every six-line edit. For docs/tooling-only work, `--mode fast --run` executes only relevant Python checks.
5. **Complete**: check the relevant spec against actual behavior. A headless screenshot, even passing, is **not** the maintainer's visual approval. UI work remains pending real native-window review before integration.

## Validation levels: choose deliberately

| Level | Example command | What it does |
| --- | --- | --- |
| Inspect only | `python tools/dev.py check` | Prints targeted-to-diff quick checks; **runs nothing** |
| Fast | `python tools/dev.py check --mode fast --run` | Changed workflow tooling tests, docs links, Rust formatting only if source changed |
| Targeted | `python tools/dev.py check --mode targeted --run` | Fast checks plus necessary Cargo check and crate-/suite-scoped tests for changed code |
| Full | `python tools/dev.py check --mode full --run` | Workspace Clippy and **one** workspace test pass after integration (no duplicate targeted suites), plus Python/docs/architecture/format checks; no release build |

The CLI makes no claims about all possible regressions. If your change affects a connected area not detected by filenames, **add its tests explicitly**. Full CI remains the final automated gate. Do not assume that passing a plan means the app is visually correct. All Rust checks can be expensive; `--run` is an explicit choice, and can stop on the first failure.

`cargo build --release`, packaging and releases are **not** developer smoke checks; they require the maintainer's explicit permission. `cargo run` is permitted only when a task authorizes actual app launch and screenshots; this guide's default inspection never launches a window.

## Repository architecture at a glance

| Need | Start here | Avoid |
| --- | --- | --- |
| Business and file/network operations | `crates/halation-core/src/` | Slint page code for heavy work |
| UI state, callbacks and routing | `crates/halation-app/src/app.rs`, `navigation.rs` | Duplicated state owned only by hidden pages |
| Presentation and bindings | `crates/halation-app/ui/app.slint`, `ui/pages/` | Porting old HTML or QML verbatim |
| Job/process queue | `crates/halation-core/src/jobs.rs`, `queue.rs`, `process.rs` | A separate busy loop in every page |
| Feature specification | `docs/features/<feature>.md` and [`docs/README.md`](README.md) | Old `archive/` rules or a stale progress commit |
| Confirmed decisions | `planning/decisions.md` | Unapproved draft proposals |
| Integration tests | `crates/halation-app/tests/`, `src/<module>/tests.rs` for nearby module unit tests | Only compiling, without behavior checks |

You can navigate by exact feature using `dev.py map`. The map itself has tests that fail if a referenced code/spec path disappears. It is deliberately a **starting point**, not another source of truth for product behavior. Large production modules keep their `#[cfg(test)] mod tests;` unit tests in a nearby `src/<module>/tests.rs`, retaining the same Rust module namespace and access to private methods. This keeps test scaffolding out of the first production-file read while preserving test coverage.

## Agents: efficient without cutting corners

The same workflow applies to agents. Prefer a fresh context for a *new* feature and concise handoff with current Git branch, changed files, tests passed and exact remaining work. The model should **not** repeatedly read a 3,000-line file just because it modified 8 lines; follow symbols and test failures to relevant areas.

For visual work, use only the screenshots needed to compare meaningful states. Do not append dozens of multi-megabyte PNGs to a long code implementation chat: review separately and return concrete findings (state, pixel region and source file). Keep visual approval human-led.

There is no artificial fixed patch, token, or Cargo call limit that justifies skipping necessary validation. Detect **repeated failures without useful progress** and change the approach. When a change is complete, verify what was delivered, not how busy the agent appeared.

## Common problems

- **`python tools/dev.py map <feature>` lists no source files**: that feature is not implemented in the current native checkout. Read its spec, study the Tauri reference, design a small native vertical slice and add map paths once they exist.
- **Frame Capture integration tests cannot find FFmpeg**: install a local pair of `ffmpeg.exe` and `ffprobe.exe` or set `HALATION_FFMPEG` to their shared directory. They intentionally fail rather than skip media coverage. Windows CI provisions a pinned FFmpeg version in `.github/workflows/ci.yml`; no user profile or runtime download is needed there.
- **Git reports many unrelated modified paths**: you may be on the wrong worktree or a shared checkout. Run `git status --short --branch` and select an isolated branch before editing. Never `git reset --hard` to make tests green.
- **PowerShell blocks `.ps1`**: `dev.py` works from `python` without changing the execution policy. If a specific owned `.ps1` is needed, follow its documented command; do not change machine-wide security settings.
- **A Cargo check keeps failing on the same interface**: inspect the constructor/API and all affected callers, resolve the mismatch coherently, then rerun once. Do not format/compile repeatedly while the interface is still changing.
- **Tests succeed but UI looks wrong**: test the real Slint window. Headless software captures cannot verify every Skia font/rendering difference.
- **Cargo unit tests report missing SVG or PNG assets**: `build.rs` stages development resources under `target/<profile>/assets`; unit test executables run from `target/<profile>/deps`. The native asset resolver handles both locations, without affecting installed app paths. If this warning returns, check that resources were staged and that the test is using `assets::locate()` instead of composing a path from `current_exe()` manually.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for PR and review expectations and [`tools/README.md`](../tools/README.md) for optional measurement tools.