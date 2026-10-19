# Companion and alternative interfaces

Status: 2026-10-19. This records configuration and evidence, not a visual
approval.

| Interface | Installed | Configured | Executed | Visible / connected | Status |
| --- | --- | --- | --- | --- | --- |
| OmO Slim Companion | Official Windows x64 archive v0.1.4; archive hash matched the manifest shipped with 3.0.4 | Enabled by the user layer, bottom-right, medium | Runs inside the existing OpenCode process | Native window exists and publishes agent metadata; tile appearance not visually reviewed | Running; manual visual review pending |
| OpenChamber Desktop | Official v2.4.0 Windows x64 per-user install | Process-scoped launcher reads the official service credential and sets external/skip-start environment variables | Yes | Backend reports authenticated OpenCode v2 ready; session API page matches upstream; window appearance not visually reviewed | API integration verified; manual visual review pending |

## Companion

The Companion is part of the official OmO Slim package and is configured in the
user layer. The repository does not enable, disable or restyle it. It reads live
session state from the same OpenCode process; it does not schedule workers or
read transcripts.

Verification is manual: start the normal session flow and confirm the tile
publishes agent metadata. Do not capture screenshots or video for this check
unless the user requests it.

## OpenChamber

OpenChamber is a separate desktop client installed per user. Its launcher is
private and process-scoped: it reads the official service credential at launch
and instructs the client to connect to the external OpenCode service instead of
starting another one.

- The launcher and its credential are not part of this repository.
- A UI patch for OpenChamber is staged as a private handoff; it is **not
  applied**. Do not apply it, rebuild the client or restart the service from a
  repository task without explicit instruction.
- Backend integration was verified through the official session API. The
  session-list appearance remains a manual visual check.

## Verification

- Plugin/config surface: `opencode plugin list` and `opencode debug config`.
- Companion: live metadata in the normal session flow.
- OpenChamber: authenticated backend ready and session API reachable.

None of these checks authorizes a UX change, a theme change or a public claim of
visual approval.

## Limits

- Both interfaces depend on the running OpenCode service; restarting it is a
  host action, not part of repository work.
- OpenChamber may track upstream releases independently; updates are evaluated
  explicitly and are not coupled to the OmO Slim version pin.
- Visual acceptance of either interface is manual and out of scope for
  repository commits.
