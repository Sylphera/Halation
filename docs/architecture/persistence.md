# Persistence and data ownership

Status: source-backed current native behavior, 2026-10-25; installation profile cut-over and Tauri import **not implemented**.

## Today: isolated beta profile

[`crates/halation-app/src/profile.rs`](../../crates/halation-app/src/profile.rs) determines the native profile root. The current default is `%LOCALAPPDATA%\Halation\slint-beta`, with explicit `--profile-root` and `HALATION_SLINT_PROFILE` overrides for isolated tests/reviews. It is **not** the Tauri `Documents\Halation` profile and not the planned `%APPDATA%\Halation` installed profile. Do not change this path as part of documentation cleanup: it requires a migration design and user approval.

The profile contains settings, library references/index, linked folder metadata and logs. It is not safe to treat a file reference as permission to delete the user's source media. Library removals modify the index, not the source file.

## Core-owned invariants

- [`settings.rs`](../../crates/halation-core/src/settings.rs) validates and bounds deserialization and writes atomically. Corrupt or oversized data fails closed, not silently replaced. Reset backs up the live file and must never overwrite a foreign replacement.
- [`atomic_file.rs`](../../crates/halation-core/src/atomic_file.rs) provides shared atomic-write behavior. [`library.rs`](../../crates/halation-core/src/library.rs), [`sections.rs`](../../crates/halation-core/src/sections.rs), [`destinations.rs`](../../crates/halation-core/src/destinations.rs) have distinct data ownership; callers must preserve their error and cancellation contracts.
- App controllers publish committed models after successful writes, and stale asynchronous results must be discarded. Tests cover persistence and failure paths in [`services.rs`](../../crates/halation-app/tests/services.rs) and the core unit tests.

## Planned profile and Tauri migration: explicit gates

The reorganization plan requires `%APPDATA%\Halation` for the installed native app, an inventory of old Tauri settings/Library/presets/sessions, reversible/idempotent conversions and no mutation of source data. There is **no** silent migration and no authorized global-path switch in the beta. A separate migration stage must test with fabricated fixtures and trial upgrades before a real user profile can be touched. [Distribution and updater gates](distribution.md) and [repo-reorg milestones C/D](../../planning/active/repo-reorg.md) control this work.

## Who owns the formats

New persistent schemas belong in core and need size limits, validation, transactional failure behavior and round-trip/corruption tests. UI-local controls must never become a second persistence format. Product-level data format compatibility must be recorded in a spec and tested before changing stored bytes.
