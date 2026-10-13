# UI corrections — 2026-10-05

Approved scope: responsive centering of Grade's upload controls; Cover Test Profiles containment; removal of Title Intro and decorative UI shadows; minimal transition overscan; black SoundCloud default; centered Spotify/SoundCloud controls. Shared borders, crop masks, selection indicators, backgrounds, blur and motion timings remain intact.

The user approved the visual review and subsequently authorized integration and release. The review used the current workspace frontend in the real native WebView2 through external request routing. It did not validate a clean executable containing that frontend. The final Windows build must supply that validation. No probes or request-routing code ships in the product.

## Checks

- Syntax/JSON and whitespace checks passed.
- `ui-corrections.js`: Grade wrapping at three widths; SoundCloud default and theme toggle; control alignment across all six Spotify/SoundCloud views; Profiles scrolling without shadow planes; all nine Home tools and eight Session adapters; no Title Intro or shadow renderer; entering/exiting viewport coverage at wide and reduced widths.
- `tool-transitions.js`: cold/warm loading, interruption, Home sequencing and reduced/off motion passed. One initial timing assertion failed before a successful repeat; assertions were not changed.
- Grade runtime, editor, Sessions system/runtime/media/autosave/UI, Jobs, localization, scan, Send to and Settings passed during this task. Sessions UI had an initial error-status timing failure before a successful repeat.
- Native review checked Grade at three sizes, loaded Spotify/YouTube artwork, Profiles scrolling, warm navigation through the remaining tools, menus and overlays. Transition geometry covered the viewport in maximized (1920 × 1009) and reduced (1100 × 820) windows. Spotify/SoundCloud controls were checked in every view. Optical Play alignment remains a manual visual check.
- Rust compilation, Clippy and Rust tests were unavailable locally; the official Windows workflow runs them.

## Existing and unresolved runner failures

- Library's “200 pictures added from PC” assertion also failed against the unchanged baseline.
- The general Cover Test runner retains outdated preview-size/DOM-location assertions and selectors that also fail against baseline. The new focal checks cover the requested corrections; the old assertions were not relaxed.
- Jobflows still reports the Visualizer batch-codec failure reproduced in baseline. Its queued Grade size assertion also failed on this branch, while repeated baseline runs passed. Grade's processing code is unchanged; the difference is unresolved and is not claimed to be a baseline failure.
- The two previously documented general motion failures remain recorded in the performance report; their assertions were not relaxed.

No investigation or product fixes outside the approved scope were added to address these runner failures.
