# Native beta visual system (Slint)

Status: first visual pass of the native beta, delegated by Java on 2026-10-21 ("se tiene que ver como una herramienta…
cuando se vea profesional y logrado, al menos el menú Home, empezaré a iterar"). It is a starting point for Java's
visual iteration, not an approved design. Annex of `docs/SLINT_SPEC.md`; that spec still owns architecture, services
and gates. Clean-room: written for Slint from zero; only the Lucide icon SVGs and the Halation mark are reused assets.

## Problems this pass fixes

| Before | After |
|---|---|
| Inverted hierarchy: a 154 px logo and a 38 px wordmark were the loudest things on Home. | The task is the loudest thing: page title, then the drop zone. The mark lives small at the top of the rail. |
| Tools twice: icon list in the rail and an 11-tile strip on Home. | One owner each: the rail navigates **places**, Home launches **tools**. |
| Everything centred on different widths (980, 610 px), no shared edge. | One content column, one left edge for every block and every page. |
| Low contrast: grey on grey, 9–10 px captions. | Near-black ground, three text levels checked ≥ 4.5:1, nothing under 10 px. |
| Rail with no clear active state. | Filled item plus a 3 px accent bar on the rail edge, label under every icon. |
| Generic, borderless tiles and identical buttons. | Cards with icon well, name and one-line purpose; primary/secondary/ghost buttons. |

## Navigation owner

- **Rail = places**: Home, Library, Jobs (top group), Settings (bottom). Always visible, labelled, one active item.
- **Home = tool launcher**: the ten media tools as cards. Library is a place, so it is in the rail, not in the grid.
- When tools get engines, the open tool will show as a fifth rail entry under Jobs (future; not in this pass).

## Layout grid

- Rail: 68 px, flush to the window edge, 1 px right hairline. Items 56 × 52 px.
- Content column: max 1120 px, centred in the area right of the rail; side padding 28 px under 1180 px of content
  width, 40 px from there. Every page and every Home block starts on the column's left edge.
- Top padding: 28 px when the window is under 760 px tall, 44 px from there. Home's block sits at 40 % of the free
  height when the window is taller than it needs (optical centre), so 1280 × 800 is not top-heavy.
- Status bar: 28 px, along the bottom of the content area on every page: build on the left, Library state on the right.
- Home tool grid: 5 columns from 1000 px of column width, 4 below; gap 12 px. 10 tools = 2 rows (5 col) or 3 rows
  (4 col). Card height 64 px.
- Home top band: drop zone (flexible) + Recent panel (300 px, 260 px under 1000 px of column); height 112 px.
- Settings keeps the same left edge with a 760 px measure for readability.
- Supported window: 960 × 600 and up; nothing scrolls on Home at 960 × 600.

## Type scale (Segoe UI)

| Token | Size / weight | Use |
|---|---|---|
| display | 24 px / 600 | Page title (one per page) |
| title | 15 px / 600 | Drop zone headline, empty-state headline |
| body-strong | 13 px / 600 | Card names, row names, setting names |
| body | 13 px / 400 | Page subtitle, body copy |
| label | 12 px / 500 | Buttons, section headers, rail is 10 px / 500 |
| caption | 11 px / 400 | Card purpose, row details, status bar |

Nothing visible is smaller than 10 px. Sentence case everywhere; no upper-case tracked labels.

## Colour tokens (Rust `theme` → Slint `Theme`)

| Token | Value | Role |
|---|---|---|
| background | #000000 | Window and page ground (pure black, Java's brand direction) |
| rail | #050504 | Rail and status bar |
| surface | #111110 | Cards, panels, inputs |
| surface-raised | #181817 | Hover |
| surface-high | #20201e | Pressed, icon wells, active rail item, selected row |
| border | #262624 | Hairlines, card borders |
| border-strong | #353532 | Hover borders |
| text | #f4f4f2 | Primary text |
| muted | #a6a6a0 | Secondary text |
| subtle | #8b8b85 | Tertiary text (hints, purposes) |
| accent | #9fb4ea | Pale blue: active indicator, focus ring, links, drop highlight |
| accent-soft | #141a28 | Accent fills (drop highlight, notices) |
| primary / on-primary | #eeeeeb / #0a0a09 | Primary button (one per view) |
| warning / warning-soft | #e2c27f / #1d1a12 | Honest "not connected" status |
| danger / danger-soft | #f0a6a6 / #2a1717 | Errors and missing files |
| success | #9fd6b2 | Finished jobs |

Greys lean slightly warm, after the #050504 tone Java set for UI surfaces.

Accent is used sparingly (state, focus, links); surfaces stay neutral. Contrast is asserted in `tests/services.rs`
for every text token on the grounds it is drawn on.

## Spacing and shape

- Spacing steps: 4, 8, 12, 16, 20, 24, 32, 40 px.
- Radii: 6 px chips, 8 px buttons and inputs, 10 px cards and rail items, 12 px panels.
- Depth comes from surface steps and 1 px borders only: no drop shadow, no blur (decided earlier for cost).
- Halation, the one bold element: a static pale-blue radial bloom around the drop target (and a fainter one behind the
  Home header), like the glow film shows around a bright light. No animation, no timer, no blur.

## States

| State | Treatment |
|---|---|
| Hover | surface → surface-raised, border → border-strong, icon tint muted → text |
| Pressed | surface-high, immediate (0 ms) |
| Focus (keyboard) | 2 px accent border; never removed |
| Active (rail, tab) | surface-high fill, text colour, 3 px accent bar (rail) |
| Disabled | 45 % opacity, no hover |
| Drag over drop zone | accent border + accent-soft fill |
| Unavailable tool | Card stays legible; a single "Engines not connected" warning chip in the Tools header, and the accessible label says it. Clicking shows an honest notice in that chip. |
| Error | danger text on danger-soft with a warning icon |

Motion: native Slint `animate` on colours only, `Theme`-independent duration from Rust (160 ms, 0 ms with reduced
motion). No new animations in this pass.

## Components

`RailItem`, `AppButton` (primary, secondary, ghost; compact), `ToolCard`, `StatusChip`, `PageHeader`, `Notice`.
Pages build only from these plus layout.

## Acceptance criteria

1. Home at 960 × 600 and 1280 × 800 shows: title, drop zone, Recent, ten tool cards, status bar; nothing clipped, no
   scrolling, all on one left edge (`tests/ui_layout.rs` checks the bounds).
2. The rail has no tool icons; exactly one rail item is active and it matches the page.
3. The largest text on Home is the page title (24 px); the mark is 32 px wide, in the rail.
4. Every text token passes 4.5:1 on its ground (test).
5. Library, Jobs and Settings use the same column, `PageHeader`, buttons and chips.
6. No shadow, blur, timer or animated background; idle CPU/GPU unchanged (no new property animations at rest).
7. fmt, strict Clippy, all tests and the release build pass.

## Out of scope

- Auralis or any animated background; window-transition motion; tool pages (no engines yet).
- Search/command palette, tooltips, light theme, custom title bar.
- Pixel parity with the Tauri app; Spanish strings.
- Java's visual approval: this pass stays "implemented, pending visual review" until Java reviews the native window.
