# Upscale / Video Upscale checkpoint — 2026-10-03

> Historical, not authoritative: superseded or finished by 2026-10-21.

Branch: `task/final-beta-polish`. The user explicitly approved the final visual state and requested this checkpoint.

## Approved state

- Upscale → Image | Video, using Halation's existing animated segmented selector. Image retains its existing workflow.
- Video uses only SPAN ch52 with ncnn/Vulkan: ×2 (`spanx2_ch52`) and ×4 (`spanx4_ch52`). No further model research or comparison is part of this block.
- Video Upscale / SPAN is one component in the existing Modules/Settings and Storage system, containing the runner and both models. Installation and removal use the existing component mechanisms.
- The video pipeline reuses FFmpeg, Jobs, CPU/GPU lanes, the workspace, cancellation, audio handling and export registration. Initial support is SDR + CFR; output is MP4 H.264, preserving the exact source frame rate and aspect ratio at ×2/×4. Audio is copied where supported, with the existing AAC fallback policy.
- Progress, smoothed processing FPS/ETA and cancellation are integrated with Jobs / Process Manager.
- Preview is a temporary clip of approximately two seconds from the current player position. It processes only that clip with the selected SPAN scale, retains the original FPS, and omits audio. It creates no export or Library entry and never launches a full render.
- Preview uses AI Interpolate's paired Before/After playback, transport and entry/exit pattern. The earlier single-frame preview and static Image comparator are superseded.
- Closing preview restores the original loaded video, position, playback state and previous scale. The frame workspace is cleaned after temporary clips are loaded; clip URLs are released on closing/replacing preview.
- The current Video viewer, transport, speeds, actions and preview layout follow AI Interpolate's existing hierarchy. This exact UI is visually approved. No further redesign is authorized by this checkpoint.

## Existing evidence and limits

- Previously passed focused checks: real SPAN ×2/×4, exact dimensions and fractional FPS, audio copy, playback, SDR/CFR guards, cancellation and the existing Settings component row.
- Final focused check passed before approval: `.tools/clip-preview-check.cjs` verified approximately two-second ×2/×4 clips generating and playing together, and restoration of original position, playback, scale and file for paused and playing inputs. No captures or suites were generated/run.
- Visual approval was supplied manually in the real local Chromium instance. The frontend used real FFmpeg/SPAN with the existing mocked IPC host.
- Network installation and native Rust compilation/integration were not executed under the user's no-install/no-build constraints. These are limits of technical validation, not withdrawn product or visual approvals.
- The apparent small Before/After difference was explicitly deferred; it has not been investigated.
- No additional validations, merge, build, publication or push were requested for this checkpoint.
