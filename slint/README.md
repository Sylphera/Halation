# Halation native beta

Standalone clean-room Rust + Slint + Skia application. This is a technical beta, not a replacement or release of the
Tauri application. See [`../docs/SLINT_SPEC.md`](../docs/SLINT_SPEC.md) for the canonical scope and gates.

## Build and test

From this directory, with Rust 1.92+ and the Windows MSVC toolchain:

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release
cargo tree -e features
```

The crate pins Slint 1.18.1 and selects winit + Skia explicitly. Headless tests cover new Rust service/model behavior;
they do not validate native rendering, visual quality, hardware path or pacing. Do not run the visible application as a
worker. The coordinator/user performs the separate manual review in the real native window.

## Isolated profile

Default profile: `%LOCALAPPDATA%\Halation\slint-beta`. Override with `--profile-root <dir>` or
`HALATION_SLINT_PROFILE`. The crate does not read/write Tauri settings, Library, sessions or caches. Tests use synthetic
temporary directories, never the real profile.

The opt-in [`scripts/launch-beta.ps1`](scripts/launch-beta.ps1) writes a release manifest by default and launches only
when explicitly passed `-Launch`. Its metadata-only dry-run verifies the resolved profile with `--print-profile`
through `HALATION_SLINT_PROFILE` (including paths with spaces), writes no profile data and computes the executable hash
with .NET SHA-256. The launcher does not build the application.

## Clean-room source provenance and audit

- All Rust services, models, controller code and tests in this crate were authored for this clean-room implementation;
  no prior Halation Rust implementation or old Rust tests were consulted, copied, translated, cherry-picked or used as a
  template. The prior Tauri app is preserved as product-behavior reference only; its Rust source was not used to
  implement this crate.
- Requirements and documented contracts in the repository were used only to determine expected behavior. The Home
  reference image was used for composition guidance only. The existing Halation mark PNG is a pure identity asset.
- Sources consulted: `AGENTS.md`, `CLAUDE.md`, `docs/SLINT_SPEC.md`, and the previous functional-only
  `docs/QT_QUICK_SPEC.md`; the approved static Home reference image; and `docs/brand/halation-mark-source.png`.
  Slint API usage was checked against official Slint 1.18.1 documentation; dependency feature behavior was checked
  against public registry manifests. No prior Tauri, `halation-core`, Qt bridge/service/test or Rust diagnostic source
  file was consulted.
- Direct runtime dependencies are public registry crates pinned in `Cargo.toml`/`Cargo.lock` (`slint`, `rfd`, `serde`,
  `serde_json`); the build-only dependency is `slint-build`. There are no local path dependencies, FFI bridges, wrappers
  or references to Tauri/Qt Rust crates.
- Source-boundary audit (Windows `x86_64-pc-windows-msvc`, 2026-10-20): `cargo metadata --format-version 1` reports
  all direct crates from the crates.io registry and no non-root non-registry package; `Cargo.toml` has no dependency
  `path`, `git`, or local override. `cargo tree --target x86_64-pc-windows-msvc -e features` contains
  `i-slint-backend-winit` and `i-slint-renderer-skia`, but no active `i-slint-renderer-software`, FemtoVG or Qt
  backend. Slint 1.18.1's Skia implementation does include its internal `softbuffer` and `wgpu-30` feature edges; these
  are recorded transparently in the canonical spec and do not select Slint's separate software renderer. The
  application calls `BackendSelector` with winit + Skia explicitly.
- A source search of `slint/src/**/*.rs` found no Tauri/`halation-core`/Qt paths, FFI declarations, `include!` or
  wrappers. Cargo manifest `path` keys are only this crate's own `src/lib.rs` and `src/main.rs` targets. The service
  tests are new and use made-up data in temporary sandboxes. The actual native renderer/presentation is intentionally
  not inferred from this audit or the release link; visual review remains pending.
- If a later audit finds contamination, remove it and implement the affected unit anew before validation.

The focused tests are new tests of the contracts above; no test file from the former Rust implementations was used as a
template.
