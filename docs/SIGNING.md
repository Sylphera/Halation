# Code signing

Status: **parked (2026-10-13).** SignPath Foundation accepts at its discretion and asks for reputation (downloads, stars, coverage); the project is too new. Apply once it has real use. Releases stay unsigned (Authenticode).
The updater signature (minisign, `docs/UPDATES.md`) is separate and already active.

## Route

**SignPath Foundation** (free for OSI-licensed projects). The certificate is issued to *SignPath Foundation*, so Windows
shows that publisher and no personal name. Signing happens in GitHub Actions on this public repository; every signing
request is approved by hand in SignPath.

Fallback: **Certum Open Source Code Signing** (about €69 for the card set, physical card + reader, identity check;
the certificate carries the developer's real name prefixed with "Open Source Developer"). Signing with the card is local,
so it does not fit the CI-only release flow; only if SignPath rejects the project.

Neither removes SmartScreen at once: an OV certificate builds reputation with downloads over time.

## SignPath conditions (signpath.org/terms, checked 2026-10-13)

| Condition | Halation |
| --- | --- |
| OSI license, no commercial dual licensing, no proprietary components | GPL-3.0-or-later; bundle holds only the app, LICENSE, NOTICE, THIRD_PARTY. Engines (FFmpeg, yt-dlp…) are downloaded later from upstream, not signed by us |
| Actively maintained, already released in the form to be signed | Needs the first release built from this public repo |
| Built from source by CI, verifiable origin | `build.yml` on GitHub-hosted `windows-latest` |
| Manual approval of every release | Approver role in SignPath |
| Product name and version metadata enforced | CI already checks `ProductName`/`ProductVersion` of both files |
| Disclose data transfers, announce system changes, uninstaller | `PRIVACY.md`; NSIS setup has an uninstaller |
| Home and download pages say "Code signing policy" and credit SignPath | **Missing**: section below goes into README and release notes once accepted |
| Team roles listed; MFA for everyone on GitHub and SignPath | **Missing**: section below; MFA must be on for the GitHub account |
| No exploitation or vulnerability-scanning features | None |

## Steps for the owner

1. GitHub: two-factor authentication on for `Sylphera`.
2. Apply at <https://signpath.org/apply> (web form). Answers:
   - Project: Halation, <https://github.com/Sylphera/Halation>
   - Description: local creative workspace for Windows (image, video and audio tools), Tauri 2 + Rust.
   - License: GPL-3.0-or-later. Build: GitHub Actions, `.github/workflows/build.yml`.
   - Artifacts: the NSIS setup (`Halation_x64-setup.exe`, and `Halation_<version>_x64-update.exe` for the updater) and
     the `halation.exe` inside it.
   - Maintainer: Sylphera (author, reviewer and approver).
3. After acceptance, in SignPath:
   - Enable MFA. Add the predefined **GitHub.com** Trusted Build System and link it to the project.
   - Project slug `halation`; signing policy slug `release-signing` (Sylphera as approver).
   - Two artifact configurations, both with a `<zip-file>` root (the upload action zips):
     - `exe`: `<zip-file><pe-file path="halation.exe" product-name="Halation"><authenticode-sign/></pe-file></zip-file>`
     - `setup`: `<zip-file><pe-file path="Halation_*_x64-setup.exe" product-name="Halation"><authenticode-sign/></pe-file></zip-file>`
     (check the restriction syntax against SignPath's artifact-configuration docs when creating them).
   - Create a CI user with submitter rights and an API token.
4. GitHub repository settings: secret `SIGNPATH_API_TOKEN`, variable `SIGNPATH_ORGANIZATION_ID`.
5. Apply `docs/signing/build-signpath.patch` to `build.yml` (`git apply docs/signing/build-signpath.patch`), add the
   README section below, and release with a `[build]` commit. Each release then waits for two approvals in SignPath
   (executable, then setup).

## CI change (`docs/signing/build-signpath.patch`)

Without the `SIGNPATH_API_TOKEN` secret the workflow behaves as today. With it:

1. `tauri build --no-bundle` builds `halation.exe`; it is uploaded and signed through
   `signpath/github-action-submit-signing-request@v3`.
2. The signed exe replaces the built one and `tauri bundle --bundles nsis` packs it, so the installed exe is the
   signed file (the existing parity check still holds).
3. The setup is uploaded and signed; its updater `.sig` is made again with `tauri signer sign` over the signed bytes,
   because `latest.json` must match the file the updater downloads.
4. `Get-AuthenticodeSignature` must report `Valid` for both files before the release is published.

Waits up to 24 h per approval (`wait-for-completion-timeout-in-seconds: 86400`); GitHub's job limit is 6 h, so approve
while the run is going.

## README section (add once accepted)

```markdown
## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Committers and reviewers: [Sylphera](https://github.com/Sylphera)
- Approvers: [Sylphera](https://github.com/Sylphera)

Every release is built by GitHub Actions from this repository and signed only after manual approval.
See [PRIVACY.md](PRIVACY.md) for what the app sends over the network.
```

Release notes get one line: `Code signing policy: https://github.com/Sylphera/Halation#code-signing-policy`.
