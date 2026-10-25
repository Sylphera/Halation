# Distribution architecture and release safety

Status: **milestone C/D pending** on the Slint native line (2026-10-25). This is the approved distribution contract from [repo-reorg.md](../../planning/active/repo-reorg.md), not a claim that a native installer/updater exists or has passed real upgrade tests.

## Published Tauri versus unreleased native

`main` remains the published Tauri 1.x line. The releases page and current `README` installer information describe **that** product. `slint/dev-workflow` and the other Slint branches are unreleased development; never label a test binary as a public native release. No automated merge/cut-over to `main`.

## Approved native packaging target (not implemented)

- Windows per-user **NSIS installer only**, no standalone portable distribution. Install the application executable with sibling `assets/`; `locales/`, `presets/`, `licenses/` are created only when real shipped content exists. Do not insert empty folders to satisfy a diagram.
- `halation-updater` will be a **separate executable**, not an unverified self-modifying updater inside the main process.
- Installed native data will live in `%APPDATA%\Halation`. The beta presently uses an isolated `%LOCALAPPDATA%\Halation\slint-beta` profile; a transition requires data migration, not a path rename.
- Compatibility with the existing 1.x `latest.json` update metadata, minisign trust root and previous installers is a **security requirement**. Do not change signing keys, parse or accept untrusted update locations, apply an unauthenticated payload, or silently overwrite an installed binary. Update/install rollback and `/UPDATE` must be specified and tested in an isolated VM/on an approved machine before release.
- Release or tag creation, NSIS build/packaging, installer execution, data migration against a real profile, publication and `main` replacement require the maintainer's explicit go-ahead. CI validates source; CI passing alone is not a release authorization.

## Gates for milestone C (before building or shipping)

1. Inventory native executable's actual dependencies/resources and the supported Windows install/uninstall behavior.
2. Implement the updater with cryptographic verification of the trusted release metadata/artifact and safe staged hand-off to the installer; corrupted/missing/replayed metadata and interrupted update tests must fail closed.
3. Test installer `/UPDATE`, upgrade, rollback, cancel, interruption, file replacement and uninstall using disposable profiles and synthetic files, preserving user data.
4. Verify that existing Tauri 1.x installations use their old compatible releases until the authorized cut-over. Never repoint their update feed casually.
5. Complete milestone D: idempotent/reversible Tauri?native migration for the approved formats. No touching real `Documents\Halation` without explicit authorization and backup/restore evidence.
6. Only then create release workflows, packages, signed metadata, retained licenses and publish with explicit approval.

These are **open engineering tasks**, not completed features. See [planning/ROADMAP.md](../../planning/ROADMAP.md) and [planning/STATUS.md](../../planning/STATUS.md). Old Tauri update implementation details are archived at [archive/tauri/updates.md](../../archive/tauri/updates.md), not binding native code.
