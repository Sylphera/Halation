# Project guide: follow one real user action through native code

Status: source-backed developer walk-through on `slint/dev-workflow`, 2026-10-25. This is **not** a substitute for feature behavior specifications. For tooling and testing see [DEVELOPMENT.md](../DEVELOPMENT.md), and the architectural boundary is in [overview.md](../architecture/overview.md).

## 1. User opens Converter and starts a job

1. A user selects Converter in the Slint rail. The callbacks are declared in [`ui/app.slint`](../../crates/halation-app/ui/app.slint) and wired in [`src/app.rs`](../../crates/halation-app/src/app.rs); available navigation pages are defined in [`navigation.rs`](../../crates/halation-app/src/navigation.rs).
2. [`converter.rs`](../../crates/halation-app/src/converter.rs) registers typed `on_converter_action`, `on_converter_target` and file-selection callbacks. Its Rust `State` retains file lists, selected plan, progress, preview and destination across Slint page re-creation.
3. [`halation-core/convert.rs`](../../crates/halation-core/src/convert.rs) owns format probing and conversion planning; [`components.rs`](../../crates/halation-core/src/components.rs) resolves external media components. File names and output destinations use [`destinations.rs`](../../crates/halation-core/src/destinations.rs) and the shared save policy.
4. Jobs run through the [`JobEngine`](../../crates/halation-core/src/engine.rs), using the [`queue`](../../crates/halation-core/src/queue.rs) and [`process`](../../crates/halation-core/src/process.rs) contracts. This is real work, not a success placeholder. Cancellation and partial files need verification.
5. The controller publishes finished/error state to the Slint model; a stale worker result must not resurrect an old page. Existing evidence includes [`converter.rs unit tests`](../../crates/halation-app/src/converter/tests.rs), [`services.rs`](../../crates/halation-app/tests/services.rs), [`core converter tests`](../../crates/halation-core/tests/converter.rs) and [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs).

Read the specific [Converter spec](../features/converter.md) before changing formats or destinations. The current app does **not** implement every Tauri document/PDF path or `Send to?` integration.

## 2. User uses Frame Capture

1. The active page is [`ui/pages/framegrab.slint`](../../crates/halation-app/ui/pages/framegrab.slint); [`framegrab.rs`](../../crates/halation-app/src/framegrab.rs) handles `on_frame_action`, inspector selection, scrub, crop, destination, queue and finished-job callbacks.
2. [`halation-core/framegrab.rs`](../../crates/halation-core/src/framegrab.rs) owns native capture definitions and authorization; [`frame_decoder.rs`](../../crates/halation-core/src/frame_decoder.rs) handles decode/cache behavior. Ownership of playback and process/job execution stays in the existing core modules.
3. Rust keeps the session, cancellation and generation counters; UI models are updated only with a still-relevant generation. Native capture and preview have separate resolution requirements.
4. Verify meaningful output/cancellation using [`framegrab unit tests`](../../crates/halation-core/src/framegrab/tests.rs), [`app framegrab tests`](../../crates/halation-app/src/framegrab/tests.rs) and UI bounds via [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs). A unit-test pass **does not** imply the Frame Capture visuals have been approved in the native window.

The acceptance specification is [frame-capture.md](../features/frame-capture.md); the independent worktrees may be further ahead than this branch, so do not silently copy their uncommitted versions.

## 3. User changes Settings and navigates

1. [`ui/pages/settings.slint`](../../crates/halation-app/ui/pages/settings.slint) holds presentation; [`app.rs`](../../crates/halation-app/src/app.rs) registers page selection and the `on_search_settings` callback.
2. [`navigation.rs`](../../crates/halation-app/src/navigation.rs) currently stores a single current `Page` and ignores selecting the current page. **There is no back-history stack** yet; a `Back to?` feature must add an explicit history contract and tests, not guess the previous page.
3. [`halation-core/settings.rs`](../../crates/halation-core/src/settings.rs) owns validated, atomic persistence. [`profile.rs`](../../crates/halation-app/src/profile.rs) determines the isolated beta root. A failed write cannot silently publish an uncommitted UI value.
4. Regressions live in [`services.rs`](../../crates/halation-app/tests/services.rs) (settings, search, persistence, navigation) and [`ui_layout.rs`](../../crates/halation-app/tests/ui_layout.rs) (category layout and bounds).

The proposed Settings sidebar/search/Back to redesign is an **acceptance task**, not completed by this repository cleanup. Behavior and visual decisions require confirmation on the real native app.

## Safely add a new native tool

First use `python tools/dev.py map <feature>` to locate its real spec and tests. If no source is mapped, it is genuinely not implemented on **this branch**. Inspect the Tauri user behavior from Git (without copying its DOM/CSS), define native typed Rust data and controller boundaries, then implement a vertical slice (real input ? process ? output and error/cancel tests ? Slint controls). Register it with the real catalog/navigation only when it actually works; never expose dead controls or mark a card ?available? because files were created. Use `python tools/dev.py check --mode targeted` to select a *dry-run* test plan, run checks only at a meaningful milestone, then verify the native window with human approval.

The **single command for new contributors** is `python tools/dev.py onboard` (read-only summary of current branch, binding rules and where to start), followed by `map`/`symbols`. Agent entry files point there automatically where supported; CI checks they remain wired.
