# Native Converter: performance check (2026-10-22)

Status: Measured in the Linux development container (4 cores, Ubuntu's FFmpeg 6.1, release build). The Windows numbers
on Java's test PC are still to be taken with the same command; until then these figures show proportions, not the
Windows timings.

Method: `cargo run --release -p halation-core --example measure_converter -- <isolated-directory>` generates every input
with FFmpeg (no fixtures), runs each conversion through the job engine exactly as the app does, and prints the table.
The UI-thread figure comes from `cargo test -p halation-app ui_thread_work -- --nocapture` (debug build).

| Case | Measured | Criterion |
| --- | --- | --- |
| MKV 1080p 20 s (H.264 + AAC) → MP4, stream copy vs the planner's H.264 medium re-encode | 225 ms vs 12 865 ms (1.8 %) | §11.2: copy < 5 % of re-encoding — pass |
| WAV 3 min → MP3 (V0) | 2.1 s | §10 reference 1–2 s |
| PNG 24 MP → JPG | 0.99 s | §10 reference < 1 s |
| PNG 24 MP → WEBP (lossy, q 90) | 1.5 s | §10 reference 1–2 s |
| Waveform of a 10 min MP3 (worker job; the page shows a centre-line skeleton meanwhile) | 2.1 s | Off the UI thread |
| Audio preview, first sound from the start / after seeking to 7:30 | 47 ms / 73 ms | — |
| Audio preview decoder (a separate FFmpeg process while playing; none while paused) | 48 MB resident | Disclosed cost; zero at rest |
| UI thread during a 256-image batch: slowest job update (rows, formats, progress) | 4.8 ms (79 updates) | §11.10: no task > 50 ms — pass, asserted by the test |

Notes:

- Playback ends its decoder on pause and on seek and starts a new one at the position reached, so nothing decodes or
  polls at rest. While playing, one 33 ms timer moves the head; it stops with playback.
- The waveform is one vector path of 480 columns (about 12 KB of path text), computed once per file; scrubbing and
  playback only move a clip edge.
