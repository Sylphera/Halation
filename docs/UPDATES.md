# Updates

Halation 1.1.0 and later update themselves from the public releases (Sylphera/Halation).

## How it works

- `update.rs` uses Tauri's updater plugin. `plugins.updater` in `tauri.conf.json` holds the endpoint
  (`releases/latest/download/latest.json` of Sylphera/Halation) and the public key. The private key is the
  `TAURI_SIGNING_PRIVATE_KEY` secret of Sylphera/Halation's Actions, a key made on 2026-10-13 for the first public
  release (copies of 1.1.0 and earlier, which trusted the old key, are not updated; no password,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` stays unset). Losing it means installed copies reject every later setup: keep a copy outside GitHub.
- CI (`build.yml`) builds with `tauri.updater.conf.json` (`createUpdaterArtifacts`), which writes the setup's `.sig`,
  and publishes the same setup twice: `Halation_x64-setup.exe` for people (the README's download count reads only
  this name) and `Halation_<v>_x64-update.exe` (+ `.sig`) for the updater, so updates and the model releases stay out
  of the count. `latest.json` (version, notes = the CHANGELOG section, signature, the update file's URL) goes with
  them; there is no portable exe. Local builds and the Preview sign nothing.
- The release `v<v>` of Sylphera/Halation must carry `Halation_<v>_x64-update.exe` and `latest.json` and be the
  repo's latest release. Until it is, nobody is offered the version.
- The setup runs with `/P /UPDATE` (a progress bar, no shortcuts or WebView2 setup again), plus `/R` to open Halation
  afterwards. It is downloaded to `%TEMP%\Halation-update` and its signature checked before it runs.
- The Preview (`preview` feature) never checks.

## Behaviour (`updates.js`)

- Six seconds after the start the check runs (Settings → About → Updates: "Ask when Halation opens" by default, "Only
  show it in Activity", or "Don't check by itself"). "Check for updates" checks at any time and always asks.
- The dialog: notes, Update, Later, Skip this version (silences that version only), Don't show again (switches to
  "Only show it in Activity").
- While a version waits, Activity has a quiet row (View, or Restart to update once downloaded) and the island at rest a
  small accent dot.
- Update downloads as a job of the net lane (Activity shows its progress). When it ends: "Save session & restart" or
  "Install on close" (Esc = install on close).
- Save session & restart: running and queued jobs are cancelled cleanly, the tools flush, the session is written for
  recovery and `updateResume` (app.json) records what stopped. The quit skips `end_session`, so the next start takes the
  session back without the recovery question (`sessions.js`). A job does not continue from its progress: its tool
  reopens with its inputs and settings and the job is started again.
- Install on close: the setup runs (without `/R`) when the app closes by hand.
- After an update (`update.seen` older than the running version) "What's new" shows the notes kept at the check
  (`update.notes`), plus what the restart stopped; it can be turned off in Settings.
- Portable copy: the same dialog and row, with "Download", which opens the release page; it never downloads.

## Halation Preview

The Preview never checks, so `dev/updates-fixture.js` (loaded only under `window.__halPreview`) simulates a version
1.2.0: buttons under Settings → About → Updates open it as an installed or a portable copy, show What's new, or reset.
The download is a simulated progress in Activity; "Save session & restart" reloads the window as the new version
(session recovered, What's new); "Install on close" only marks it pending. Nothing reaches update.rs.
