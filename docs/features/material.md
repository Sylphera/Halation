# Material and type (Slint beta)

Status: **direction A implemented, pending Java's visual review; type pending Java's choice** (Java, 2026-10-22: "en el original, el material se ve más maduro …
ahora todo es demasiado plano y le hace perder seriedad"; "busca referencias de material en otras apps"; a more
mature typeface, Hermes Agent as inspiration). Annex of [SLINT_VISUAL_SYSTEM.md](../SLINT_VISUAL_SYSTEM.md); colours
stay those of `ui/theme.slint`. Mockup: `material/propuesta-material-tipografia.png` in the project files (rendered
in a browser with the same means Slint has: two-stop linear gradients and 1 px lines, no blur).

## 1. Why the beta reads flat

Measured against the original's rendered result and the beta's own snapshot (`--screenshot`):

| | Original | Beta now |
|---|---|---|
| Light | Every surface has a 1 px sheen on its top edge | None |
| Raised pieces (selected pill, segmented thumb, icon tiles, buttons) | Lighter than their ground, a soft top-to-bottom fall-off, a white border at 11 % | Flat `#1c1c1e` / `#232325`, no edge |
| Recessed pieces (fields, segmented tracks, switch track) | Darker than the panel | Same fill as a button (`#161617`) |
| Borders | White at low alpha, so they read as light catching an edge | Opaque near-black greys (`#1f1f21`), so they read as drawn lines |
| Levels | Ground, panel, raised, popover: four distinct steps | Two steps a few levels apart |
| Type | One family, one weight step between title and body | Same |

Flatness comes from the missing light and the missing levels, not from the colours.

## 2. References from other apps

| App | What gives it weight | Taken |
|---|---|---|
| macOS controls, Logic Pro, Final Cut Pro | One light from above: raised controls are lighter at the top with a bright top edge; wells are darker with a dark top edge | Direction A |
| Raycast | Buttons and key caps with a two-stop fall-off, a 1 px inner highlight and a 1 px dark contact edge underneath | Direction A, the contact edge |
| Linear (2024 interface) | No drawn borders: levels by luminance only, a faint highlight on the top edge of raised items, separators at a few percent of white | Direction B |
| DaVinci Resolve | Neutral near-black panels separated by tone; fields recessed; dense, small, tracked labels | Wells, caption labels |
| Hermes Agent | Typographic contrast: a display face with character for the one title, a quiet sans for everything else, small tracked caps for group labels | §5 |
| Vercel (Geist) | Strict grey scale with every step used for one role | The level table in §3 |

## 3. Levels (both directions)

Light comes from above. Four levels, each with one role:

| Level | Used for | Fill | Edge |
|---|---|---|---|
| Ground | Chrome, frame | `#0b0b0c` | none |
| Well (recessed) | Fields, segmented tracks, switch track off, search | darker than its panel, `#050506` → `#0b0b0c` | white 6 %; dark top line (black 80 %) |
| Bubble (panel) | Settings panels, Home strip, drop zone, recent files | `#18181a` → `#0f0f10` | white 9 %; top sheen white 15 % |
| Raised | Selected pill, segmented thumb, buttons, selects, icon tiles | `#323235` → `#1f1f22` | white 10 %; top sheen white 20 %; contact edge black 75 % (1 px below) |
| Popover | Menus, tooltips | as raised, one step lighter | white 12 %; the only place a real blurred shadow is allowed (drawn only while open) |

Separators inside panels: white 4 % instead of `#1f1f21`. Hover and press veils stay white 6 % / 10 %.

## 4. Two directions (the mockup shows both)

- **A · Relief** (macOS / Logic / Raycast; closest to the original): §3 as written, gradients on bubble, raised and
  well, sheen and contact edge. Strongest sense of material.
- **B · Tonal** (Linear / Resolve): flat fills at the §3 luminances, no borders, only the raised top sheen (white
  10 %). Quieter, more "tool"; less depth.

Chosen by Java (2026-10-22): **A**.

## 5. Type

- **Display face** for page titles and Settings section titles only (and a future tool header). The wordmark,
  the mark and the tagline stay. Candidates, all SIL OFL 1.1 (redistributable inside a GPL app, as Inter is):
  Gloock, DM Serif Display, Instrument Serif, Bodoni Moda, Fraunces, Newsreader, Young Serif. Hermes Agent's own
  face is not identified, so it is a mood reference only. Not decided (Java, 2026-10-22: "yo aun no decidí"); Java
  also wants a new face for the HALATION wordmark. The choice is made in an interactive type lab (Artifact
  https://claude.ai/artifact/N7KdAds8p63QE4EXNdsZ1s: 27 wordmark faces with weight, tracking, width and case, title and
  interface faces, over a live Home and Settings).
- **Interface face:** Inter stays (Geist, IBM Plex Sans and Instrument Sans were compared; none changes the feel
  enough to justify a swap).
- **Contrast:** group labels as small tracked caps (10.5 px, 600, +0.09 em, tertiary text), as in Hermes and Resolve;
  page titles larger (22 px in the display face); body unchanged.

## 6. How it is drawn in Slint, and its cost

- A level is a `Rectangle` with a `@linear-gradient(180deg, top, bottom)` background and a 1 px border whose brush is
  also a gradient, brighter at the top: that is the sheen, curved with the corners. The contact edge is a same-shape
  `Rectangle` 1 px lower, behind it (not under glass panels, where it would show through). Hover and press are a
  veil over the fill, since a gradient brush does not animate; fades go through the brushes' alpha, never `opacity`.
  `components/surface.slint` (`Surface`, `Level`) is used by `button.slint`, `controls.slint` (switch, select and its
  menu, fields, search, segmented), `home.slint` (strip, drop zone and its icon tile, recent files) and `settings.slint`
  (save choice cards); `pills.slint` draws its selection (sidebar, Settings categories, segmented thumb) and Home's
  hover pill the same way (`raised-select`, `raised-hover`); `tooltip.slint` is a popover. Group titles are small
  tracked capitals. Tokens: `theme.slint`, "Material".
- The headless `--screenshot` (software renderer) draws a gradient fill without its rounded corners, so its snapshots
  show square corners on gradient pieces; the Skia window draws them rounded. Review on the real window.
- Cost: two to three extra solid rectangles and one gradient per surface; Skia draws these as plain fills. No blur,
  no `drop-shadow-blur` on anything that stays on screen, so Home's 15 Hz redraw does not grow measurably. The only
  blurred shadow is the open popover.
- The display face loads like Inter, from `assets/fonts/` through the run-time font collection.

## 7. Acceptance

1. Snapshots at 1920 × 1080 of Home, Settings (two sections) and an open select show the four levels distinctly.
2. Every surface uses `Surface` or the §3 tokens in `theme.slint`; no hard-coded colour outside `theme.slint`.
3. No `drop-shadow-blur` outside popovers; `tests/ui_layout.rs` passes unchanged.
4. Preview on KernelPanic and Java's approval before merge.

## 8. Out of scope

Colour palette changes, the Drape, the mark and wordmark, motion (PR #27), tool pages.
