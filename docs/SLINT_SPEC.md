# Halation native rebuild — Rust + Slint + Skia canonical specification

Status: implementation specification for the independent native application. This is the sole canonical native
specification. It supersedes the abandoned Qt Quick/C++ line and the previous `docs/QT_QUICK_SPEC.md` (renamed here);
it does not authorize replacing or changing the currently maintained Tauri application. A native build is a technical
preview until separately approved in the real window.

## Authority and boundaries

- Rebuild the application clean-room with **new Rust + Slint + Skia code**. Do not copy, translate, cherry-pick, recreate
  from, link to or wrap prior Halation Rust implementations: this prohibition covers the Tauri backend, `halation-core`,
  Qt bridges/services/tests and Rust diagnostics, as well as any UI implementation. Do not use their source or tests as
  templates. Tauri remains a product-behavior reference only, never an implementation source.
- Requirements, documented schemas and service contracts may be consulted only as information about expected behavior;
  they do not authorize moving code. Public crates may be used subject to their licenses. Pure identity assets and static
  reference images are allowed; neither is source code or a replacement for native UI.
- `app/` and its Rust/Tauri backend remain untouched and operational. The native application does not call, link,
  embed or claim compatibility with them. No Rust runtime sharing, cxx-qt, media engine, scheduler or tool execution
  is in scope for the beta.
- The application is a standalone Cargo crate in `slint/`, on its own branch/worktree. It owns its profile, settings
  schema, Library index and tests. It must not read or write Tauri settings, Library data, sessions, presets or caches.
- No local path dependency, FFI, wrapper, shared Rust module or other dependency edge may reach prior Halation Rust
  implementation. New Rust services, models and tests are authored from zero.
- The initial shell has Home, Library, Jobs and Settings. Welcome, the ten media tools, engines, data migration,
  packaging, updater and release are future work, not claims of completion in the beta.
- Visible beta text is English. Visual identity follows the approved reference image and product marks, not a new
  redesign and not a fullscreen raster copy.

## Stack and exact pins

| Part | Pin and contract |
|---|---|
| Rust | Edition 2024, `rust-version = 1.92`; validated with host Rust 1.99.0 MSVC. |
| UI framework | `slint = "=1.18.1"`, `default-features = false`, features `compat-1-18`, `std`, `backend-winit`, `renderer-skia`, `accessibility`. |
| Build integration | `slint-build = "=1.18.1"`, `default-features = false`, feature `compat-1-18`; `.slint` compiled by `build.rs`. |
| Backend selection | `BackendSelector::new().backend_name("winit".into()).renderer_name("skia".into()).select()?`; an unmet requirement is an error, not a silent fallback. |
| Graphics | Skia through Slint's Skia renderer. Direct3D is **not** a product gate: do not add `require_d3d()` or a GPU-specific requirement. If Skia uses an internal CPU path, describe it honestly and do not claim verified GPU rendering. |
| Lockfile | `Cargo.lock` committed. Feature graph and tree must show winit + Skia and no Qt, FemtoVG or runtime software renderer. |
| Native picker | `rfd` (MIT), pinned by the lockfile; opened only by a human gesture. |
| Serialization | `serde` + `serde_json`, bounded schemas; no async runtime or Tokio in the beta. |

The Slint framework is triple-licensed (`GPL-3.0-only`, royalty-free, or commercial). Halation uses the GPLv3-compatible
open-source path under its existing GPL-3.0-or-later license. Skia is BSD-3-Clause, `skia-safe` is MIT, winit is
Apache-2.0, `rfd` is MIT and serde is MIT/Apache-2.0. Notices are recorded before any release; the beta makes no
claim about closed distribution.

In the verified Windows-target feature graph, Slint 1.18.1's Skia package also activates its internal `softbuffer`
and `wgpu-30` integration features. These are dependencies/features within `i-slint-renderer-skia`, not selection of
Slint's separate `renderer-software`, FemtoVG or Qt renderer. The application selects winit + Skia explicitly; the
actual presented Skia path remains unverified until the authorized native-window review.

## Delivery plan and current state

The authorized unit delivers the A–E clean-room shell foundation through technical validation. A milestone may be
committed before later gates pass, but only E marks this unit technically validated. A–E are the first delivery block,
not a replacement for Halation's longer product roadmap. Phase completion never implies visual/product approval,
performance qualification or release.

| Phase | Work and exit criteria | Current state |
|---|---|---|
| A — clean foundation | Start from the authorized `main` baseline; preserve the Tauri reference and shared harness; archive the specifically retired `qt/rebuild-shell-20261019` worktree and its Git history; create the standalone `slint/` crate; rework the single canonical spec; record exact pins and licences. | Implemented for this rebuild. The final Qt worktree snapshot and two-ref bundle are in private archive `20261020T113722-qt-final`; an earlier archive `20261019T201500-qt-retirement` also retains historical snapshots. Other historical Qt refs/worktrees remain outside this unit's deletion scope. Qt is not active in the Slint branch. No claim is made that every historical Qt root/ref was purged. Clean-room boundary excludes all prior Halation Rust implementation and tests; no old Rust source/test was consulted or used. |
| B — native shell | Standalone Cargo app; one native resizable window; central navigation; Home/Library/Jobs/Settings; lazy active page with destroy-on-leave; useful empty/error states; typed Rust-to-Slint contract; responsive logical layout, keyboard operation, focus and accessible names. | Compiles and links in release: model-driven rail, static Home composition, 11-entry catalog, isolated Library/Settings/Jobs, lazy active page and keyboard/accessibility properties. Twenty-four headless service/model tests pass. No native window was launched or visually reviewed. |
| C — native motion | Deliberate native Slint animation only; immediate navigation; same-target changes do no extra navigation; reduced-motion preference; no idle timer, animation clock, particles or forced render policy. Evaluate a small representative shell motion/response slice. | Implemented: native rail/control property animation, Settings-driven duration (160 ms / 0 ms reduced motion), no background animation or idle timer. Native presentation timing is not qualified. |
| D — useful services | Rust-owned isolated atomic Settings schema/reset with visible write errors; bounded asynchronous Library load/metadata/save, references/filter/missing/no-delete with committed-candidate publication only after success and corrupt-data fail-closed; typed Jobs model with explicit no-engine capability and no simulated execution; never touch Tauri data; synthetic test fixtures only. | Implemented at beta scope: reset preserves a backup and restores safely on failure; Library stages add/remove privately, publishes only after save and leaves the committed view/disk snapshot on error; reference-only data and Jobs submission rejected as disconnected. Engines, rich indexing and migration remain future work. |
| E — technical validation | Release build; Slint compiler diagnostics; `cargo fmt --check`; strict `cargo clippy --all-targets -- -D warnings`; `cargo test`; lockfile/feature-tree audit; focused state tests; dependency/source-boundary check; repeat affected checks after fixes. | Passed on Windows MSVC: fmt check, strict Clippy, 24 service/model tests, release build, metadata/tree/source-boundary audit. Explicit winit + Skia selection is in code; actual presented renderer, hardware pacing and manual visual acceptance remain pending. |

## Architecture and lifecycle

### Source provenance and boundary self-review

- Implementation provenance for this beta: newly authored Rust and Slint code in `slint/`; public crates pinned through
  Cargo; documented functional requirements/contracts and schemas as behavior-only information; the existing Halation
  mark and static Home reference image as identity/composition references.
- No prior Tauri, `halation-core`, Qt bridge/service/test or Rust diagnostic implementation was consulted or used as a
  code/test template. The Tauri checkout was treated only as a product-behavior reference; no Tauri Rust source was read
  to implement this crate. Existing Rust tests were not used as templates.
- Before technical close, inspect direct/transitive dependencies, imports and filesystem/path references to verify no
  local dependency edge or call reaches old Rust. Record the actual audit and any source consulted in `slint/README.md`;
  if contamination is found, remove it and implement the affected unit anew before validation.

### Crate layout

```text
slint/
  Cargo.toml / Cargo.lock / build.rs
  src/        main.rs, controller, settings, library, jobs, catalog, navigation, motion, theme, profile
  ui/         app.slint, theme.slint, pages/, components/, icons.slint
  assets/     product mark and asset notes
  tests/      headless Rust service/model tests (no UI screenshots)
  scripts/    opt-in beta launcher and manifest
```

- One native Slint `Window`; a small declarative shell and typed Rust services/models.
- Navigation has one explicit owner in Rust. The active page is instantiated conditionally; leaving a page destroys
  its view. Functional state stays in Rust services, so re-entry does not accumulate objects or lose data.
- Rust owns all logic and I/O. Slint owns presentation, layout, simple bindings, native animation and input events.
  Large collections use a custom `slint::Model` with typed row data, precomputed visible indices, cached missing
  metadata and O(1) row access. `ListView` virtualizes rendering. Hidden pages have no timers or work.
- UI models are mutated only on the GUI thread. File I/O, index parsing and metadata checks run on finite worker
  threads. Results return with `slint::invoke_from_event_loop` or `Weak::upgrade_in_event_loop`; stale generations are
  discarded. Workers do not dereference destroyed UI owners, and shutdown never blocks on an indefinite join.
- No custom reactive framework, perpetual render loop, frame polling or engine hidden behind the shell.
- Memory/startup and low-resource behavior take precedence over incidental convenience: avoid unnecessary cloning and
  hot-path allocations, but retain ownership-boundary/snapshot copies when they make lifecycle and rollback safer. Do
  not perform broad clone refactors without evidence. Before a feature with significant memory/startup cost, state the
  Rust-vs-Slint split and offer a lighter alternative; do not escalate micro-decisions.
- Clippy (`cargo clippy --all-targets -- -D warnings`) is the mandatory Rust static-quality replacement for the retired
  Clazy gate. Prefer idiomatic iterators/ownership, avoid production `unwrap()` overuse, and handle errors explicitly.
  Document only intentional lifecycle cancellations; do not silently swallow operational errors.

### Ownership and failure model

- UI callbacks capture `Weak` handles, not strong component references. Services coordinate through `Rc`/`RefCell` on
  the UI thread.
- Worker payloads are plain owned data (`Send`). A worker that finishes after the window closed simply drops its
  result; the internal event-loop callback is not invoked for a dead component.
- Persistence is atomic: write a uniquely named temporary file in the target directory, flush it, then replace the
  destination. A failed write leaves the last committed snapshot and reports the error.
- Corrupt or oversized persisted data fails closed: it is not silently overwritten by ordinary edits. Reset moves the
  live file to a unique same-directory backup, then installs defaults with an atomic create-if-absent operation. On
  failure it restores its own backup only when the live path remains absent; a new/foreign path is never overwritten.

## Functional baseline

### Settings

- Own schema (`schema_version`, `reduced_motion`, `library_limit`) and profile location, separate from Tauri's
  `Settings/app.json`. No implicit import, migration or shared path.
- Default profile: `%LOCALAPPDATA%\Halation\slint-beta`, overridable with `--profile-root <dir>` or
  `HALATION_SLINT_PROFILE` for review and tests. Tests use synthetic temporary roots and never read the real profile.
- Reads are capped (64 KiB). Values are validated and bounded (`library_limit` 100–5000). Missing file means defaults.
  Corrupt, oversized or invalid data reports an error and locks ordinary writes until an explicit reset.
- Saves are atomic and small. A failed write reports the error and preserves both the in-memory previous value and the
  control state; the UI only applies a new value after a successful save. Reset moves the current file to a
  same-directory backup, then atomically creates defaults only if the live path is still absent. If writing fails, it
  restores that backup only into an absent path; a concurrently created path is left untouched and the backup remains.
  The in-memory value stays unchanged, the error remains visible and ordinary writes stay locked until reset succeeds.
- The Settings page shows the profile path, build identity and the actual stored values. It does not claim to manage
  Tauri settings or downloadable components.

### Library

- Typed collection of file references, never copies. Add-reference, remove-reference and text query/filter are
  functional. Removing an entry never deletes the original file. Missing paths are detected and shown.
- The bounded index is stored atomically in the app's own profile. Loading, size/format validation and filesystem
  metadata checks run off the GUI thread. Saving serializes a committed snapshot off the GUI thread; while a write is
  pending the UI reports busy and retains the committed snapshot.
- While a write is pending, the visible model, counts, recent summary and filter results remain on the committed
  snapshot. A successful write publishes the candidate in one GUI-thread step; a failed write leaves that view and
  disk snapshot unchanged and reports the error. A stale worker result is ignored by generation; concurrent changes
  are rejected rather than queued. Destroying the window discards pending results without dereferencing the model or
  blocking shutdown.
- Corrupt or oversized indexes fail closed and cannot be overwritten by add/remove until an explicit recovery action.
- Row count and row data use a precomputed visible-index map and cached metadata; they perform no filesystem calls.
  Query remaps are bounded by the index limit. The UI uses a virtualized `ListView`.
- The native picker is the only file-access gesture in the beta. No scans of real user data, thumbnails, copying,
  moving, transcoding or destructive file operations. Tests create synthetic files in a sandbox.

The old Tauri v2 Library JSON format, path and migration are explicitly not adopted. `docs/LIBRARY_SPEC.md` remains a
functional reference only.

### Jobs

- Typed model and honest empty/disconnected presentation. No engine is connected, so no job can be submitted, queued
  or shown as operational progress.
- Submission returns an explicit `NoEngine`/disconnected error. No scheduler, process spawn, fake progress, fake queue
  or hidden worker is implemented. Synthetic rows exist only in tests.
- A future service boundary must define capabilities, cancellation and lifecycle before any runner is implemented.

`docs/JOBS_SPEC.md` remains a functional reference; its proposed scheduler/resource policy is not adopted here.

### Home and navigation

- Home is a static native composition guided only by the approved reference image: left rail, product mark, wordmark,
  subtitle, a model-driven 11-entry tool row, a real drop/choose reference zone and a recent-files summary based on
  the actual Library state.
- Background atmosphere is a small set of static rectangles/gradients. There is no shader, blur, offscreen layer,
  particle system, timer or animated background. Simple static gradients provide the mood.
- The catalog is Rust data. Ten media tools are marked unavailable with a clear reason; Library is available and opens
  the real page. Activating an unavailable tool shows an honest notice and never starts an engine, process or progress.
- The drop zone accepts local file drops and the choose button opens the native picker. Either path adds a reference
  through the real Library service and reports errors inline. Dropping never copies or processes the file.
- Navigation to all four pages works with pointer and keyboard. Same-target navigation is a no-op. Re-entry and rapid
  switching preserve service data while views are recreated.

### Shell theme, contrast and accessibility

- The shell applies an explicit dark token set from Rust to the Slint `Theme` global and does not depend on the
  Windows control theme for its surfaces, labels, buttons, focus ring, disabled state or error state.
- Contrast is checked in Rust for the token pairs actually applied: primary text, secondary text, accent and error
  text on their backgrounds.
- Custom controls expose accessible roles, labels and default actions; focus is visible and reachable by Tab; Enter
  and Space activate buttons; text input keeps native editing, selection and IME behavior.
- The native window frame is retained. The beta does not fake window controls or claim pixel parity with the
  reference image.

### Motion

- Native Slint `animate` on a small representative slice (rail active state and control hover/press) is the allowed
  motion. Navigation itself is immediate; page views are created/destroyed without a custom transition engine.
- The duration comes from Settings through a Rust-computed value: 160 ms normally, 0 ms with reduced motion. Reduced
  motion is deterministic and does not depend on a custom clock.
- No spring semantics are invented beyond documented Slint behavior. No background animation runs in the beta. The
  beta makes no FPS or hardware-pacing claim from headless tests.

## Performance, validation and gates

Design goals are responsive interaction, stable pacing at 60 Hz on a representative economical laptop and support for
higher refresh where the platform allows it, with no idle perpetual work or unbounded lifecycle growth. These are
goals, not claims derived from headless tests or this development PC. Actual Skia renderer selection, presents and
hardware pacing remain to be observed in an authorized native run. Do not force Direct3D, cap frames, reduce fidelity
or shorten motion to mask cost. Report renderer/runtime information only when observed.

Focal checks for the beta:

```powershell
cd slint
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
cargo tree -e features
```

- Tests cover Settings schema/missing/corrupt/oversized/atomic write/write-failure rollback/reset; Library
  add/remove/reference/no-delete/filter mapping/missing/corrupt/oversized/async save rollback/stale generation/reopen;
  Jobs empty/capability/rejected submission/no process; catalog availability and honest notices; navigation same-target
  and page ownership; theme contrast; motion duration with reduced motion; profile isolation.
- Tests may not inspect or write the real profile or start external tools. There is no production dependency on
  Slint's internal testing crate and no claim that headless state tests exercise UI rendering.
- The Slint compiler build and release link validate the `.slint` syntax, generated Rust types and Skia backend
  linkage. Visual quality, presented frame pacing, GPU/CPU path and interaction feel are separate manual gates.
- Human visual approval of the real native window is mandatory and separate from technical validation. The worker does
  not open the visible beta or generate screenshots/video/frames.

## Licensing and notices

- Halation remains GPL-3.0-or-later. Slint is used under its GPLv3-compatible open-source option; the repository does
  not relicense Halation or make claims about distributing a closed build.
- Skia is BSD-3-Clause; `skia-safe` is MIT; winit is Apache-2.0/MIT; `rfd` is MIT; serde/serde_json are MIT/Apache-2.0.
  The transitive Rust dependency notices and exact versions are recorded from `Cargo.lock` before any release.
- Product identity assets remain outside the GPL under `TRADEMARKS.md`; the beta uses the existing Halation mark only
  as a product asset.

## Product roadmap after A–E

These are ordered areas for later scoped implementation; none is implemented by the beta.

1. **Service contracts:** small typed boundaries and capability/error/cancellation behavior before connecting real
   operations. Jobs/Activity, process ownership, resource policy and progress become real only with a real service.
2. **Shared product services:** complete Library collections/search/watch/index workflows, sessions, settings/profile
   breadth, common file/dialog flows, process/job lifecycle, notifications and close behavior. Existing public specs
   and Tauri tests are functional contract sources only; the native data schema/profile stays separate until an
   explicit migration is designed and tested.
3. **Tools and media capabilities:** implement Audio Visualizer, Grade, Frame Capture, Downloader, Converter, Vocal
   Remover, Background Remover, Image Upscale, AI Interpolate and Cover Test, plus their real processing, playback and
   export paths, in dependency order. Each has focused functional tests and measured resource/lifecycle behavior. No
   preview, mock job or control may imply an engine exists when it does not.
4. **Data continuity:** explicitly design and validate import/migration for settings, Library references, sessions,
   presets, workspaces and downloaded components before any production cutover. Until approved, do not read, modify or
   migrate Tauri user data.
5. **Distribution and release:** separately evaluate Windows packaging, Skia/third-party notices, installation,
   update/rollback and CI, then validate the real upgrade path and visual approval before deciding whether the native
   app can replace any released product.

Performance, responsiveness, reduced-motion behavior and resource lifecycle remain acceptance concerns from the first
representative UI slice and recur at every roadmap addition.

## Out of scope for the beta

- Replacing or changing the Tauri application, its UI, backend, data formats or release channel.
- Connecting any media engine, model, scheduler or external tool, or simulating one.
- Importing/migrating Tauri settings, Library, sessions, presets or downloaded components.
- Packaging, installer, updater, code signing, CI release or public distribution.
- macOS/Linux packaging, mobile or web targets.
- Pixel parity with the reference image or with the Tauri/Qt interfaces.
- Automated screenshots, video, frame sequences or performance evidence.

## Technical references (verified 2026-10-20)

- Slint crate 1.18.1: https://crates.io/api/v1/crates/slint/1.18.1
- Slint Rust API and `BackendSelector`: https://docs.slint.dev/latest/docs/rust/slint/struct.BackendSelector
- Slint `Model` trait: https://docs.slint.dev/latest/docs/rust/slint/trait.Model.html
- Slint `Weak::upgrade_in_event_loop` and `invoke_from_event_loop`:
  https://docs.slint.dev/latest/docs/rust/slint/struct.Weak.html
- Slint animations and states: https://docs.slint.dev/latest/docs/slint/reference/language/animations
- Slint images and SVG: https://docs.slint.dev/latest/docs/slint/reference/property-types/images
- Slint drag and drop: https://docs.slint.dev/latest/docs/slint/guide/development/drag-and-drop
- Slint accessibility: https://docs.slint.dev/latest/docs/slint/guide/development/best-practices
- Slint licence: https://raw.githubusercontent.com/slint-ui/slint/v1.18.1/LICENSE.md
- Skia: https://skia.org/ ; `skia-safe`: https://crates.io/crates/skia-safe
- winit: https://crates.io/crates/winit ; rfd: https://crates.io/crates/rfd

## Current boundary and approval gates

This A–E deliverable is a clean-room functional foundation for the product roadmap, not a replacement app. The beta is
technically validated only when the recorded checks pass. Actual visual approval, presented-frame/hardware performance
and the real Windows Skia runtime remain pending manual gates. The final roadmap areas require their own
implementation, tests and product decisions; no broader authority is inferred from this shell work.
