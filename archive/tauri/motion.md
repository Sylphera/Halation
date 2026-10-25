# Motion

> **Historical Tauri/GSAP document:** the current native contract is [native motion](../../docs/features/motion.md) and [native design](../../docs/design/design.md). Do not port CSS/JS timing or WebView effects to Slint.

How Halation moves. The code is `app/dist/motion.js` (`window.__motion`), the values are the motion tokens in
`app/dist/tokens.css`, the CSS pieces are in `ui.css` and `shell.css`. The code map is in `ARCHITECTURE.md → Motion`.

The aim (Java, 2026-09-29): a superfluid interface, Apple-like in how it moves. It answers at once like a toolkit and
every change of state carries the eye, so it feels alive for an instant and never waits. There are no loading
screens: what is coming shows its own shape (a skeleton) until it is there.

## Engine

- GSAP 3.15 (`gsap.min.js`) and its Flip plugin (`Flip.min.js`), vendored in `app/dist` and loaded before `motion.js`
  in every page (Java's choice). Every move goes through them: places, menus and their items, dialogs, lists,
  accordions, pills, progress fills, the app starting.
- One physics: a critically damped spring, `x(t) = 1 − (1 + (ω − v0)·t)·e^(−ω·t)` with `ω·T = 9.23`, so it has
  settled (within 0.1 %) at the end of its duration `T` and is at 90 % at 42 % of it. `v0` is the speed it starts
  with: when a move interrupts another (`animate` on the same element and channel, `glide`, `bar`) it starts from where
  the old one is and with its speed (`carry`), so fast clicks flow on instead of stopping dead.
- `motion.js` wraps each tween like a Web Animation (`finished`, `cancel()`); when it ends the element gets back its own
  inline styles, so the stylesheet stays the rest state.
- CSS keeps only what is tied to an element's state: press feedback, switches and the skeleton light, on
  `--ease` (the same spring as a `linear()` curve).

## Tokens

| Token | Value | Use |
|---|---|---|
| `--spring` | 320 ms | the interface: menus, tabs, pills, lists, accordions, dialogs, a press released |
| `--place` | 300 ms | changing place: centered page entrances and returning Home |
| `--fade` | 140 ms | what only fades: exits, a skeleton leaving, reduced motion |
| `--stagger` | 28 ms | between the items of a group that arrive together |
| `--ease` | spring | the spring for CSS transitions |
| `--press-scale` | 0.97 | a press |
| `--depth-blur` | 6 px | a place that recedes goes out of focus |

The durations are settle times, a ceiling: most of the move happens in the first 40 %.

## Rules

1. The first frame answers. A press sinks at once (60 ms) and is released on the spring; a state changes on the
   click; the animation follows. Nothing waits for an animation.
2. One spring. Everything that moves settles on it, without a visible bounce.
3. Two speeds. Inside a place (a tool, a page): `--spring`. Changing place: `--place`, with depth.
4. Interruptible, with the speed carried over; never queued.
5. `transform` and `opacity` move; `filter: blur` only for depth when changing place; never width, height, top or
   left. Colours change at once.
6. Continuity: nothing appears from nowhere. A tool grows out of its dock icon, a menu or a dialog out of its button,
   list items slide to their new place, what is removed fades while the gap closes.
7. No loading screens. A tool that is not ready shows its skeleton; busy work shows a short note over a skeleton.
8. Reduced motion (Windows setting or Settings → "Reduce animations", `data-motion="reduce"` on every frame's
   `<html>`): every animation becomes a short fade (`--fade`); nothing moves.
9. Performance is a requirement: no main-thread task over 50 ms during a transition (`tests/motion.js` trace); a
   transition that drops frames is simplified.

## Places

- The app starting (`shell.js enterApp`): its skeleton (`#bootSkel`, the dock and Home's shape, only if the start
  lasts over 120 ms) fades while the dock slides in from the left with its icons one after another and the content
  comes forward into focus (scale 0.97 → 1, blur 8 px → 0); Home's pieces follow, staggered (`enterHome`).
- Opening a tool or a page (`motion.js swap`): it grows out of its dock icon (scale 0.72 → 1 from the icon, into
  focus) while the place left behind recedes (scale 0.96, out of focus, fading).
- Going back Home: the tool goes back into its icon and Home comes forward from just behind.
- Views with a live canvas (Visualizer, Grade, Intro) move the same way without the blur (`flat`).
- A tool not ready yet (`#toolSkel`, `shell.js toolSkeleton`): its columns as they will be (`SKEL`), coming out of the
  dock icon with the view after 70 ms, crossed by a slow light; the page loads out of sight (`.pending`) and comes
  forward out of its shape once it says it is ready (`__halApp.ready`). Hovering a dock icon (or a Home chip) starts
  loading its tool after 60 ms (`preload`), so the click usually finds it ready and no skeleton is seen.

## The interface

- Dock: static. Its pill slides to the selected tab on the spring, carrying its speed through fast clicks.
- Segmented controls (`.tabs`, `.ltabs`): one pill that slides the same way.
- Menus and popovers grow from the button that opened them (scale 0.96) and their items follow in, one after
  another; closing, they go back into it. Dialogs do the same while their backdrop blurs in with them.
- Lists (`list`, Flip): kept items slide to their new place (matched by key through `data-flip-id`, also when the list
  is rebuilt), new ones scale in staggered, removed ones fade on a ghost while the rest closes the gap.
- Accordions: the content fades in and what follows slides; the height never animates.
- Switches: the knob slides on the spring. Primary buttons light up under the pointer.
- Progress (`.prog` + `M.bar`): the fill settles on the spring at each value; done: mint. Unknown length
  (`.prog.indet`): a soft light crosses the track, faded at both ends. Determinate progress uses one shared
  render-budget clock capped at 30 Hz per realm; subpixel advances snap to their exact target. Hidden/unfocused
  views finish pending progress and release the clock. This cadence does not cap input or navigation motion.
- Processes: the complete four-icon toolbox is the same object and surface as its requested manager. Its other
  controls fade out, its Processes header centers, and the shared surface centers/expands in 420 ms. Closing reverses
  the transformation. Activity remains inside the complete toolbox. Only transform/opacity animate; interrupted
  geometry is rebased from the current rendered rectangle and carries spring speed. The body clips to the transformed
  surface while its text retains its natural size. This duration does not change other page transitions.
  Implementation and automated checks do not replace the user's explicit visual approval.
- Busy work (Cutout, Remove Background, Frame Grab opening a video): the picture stays, dimmed and crossed by the
  skeleton light, with a short note (`.busynote`) of what is happening.

## Ambient

- Product decision2026-10-12 supersedes the earlier no-grain experiment: the user approved stationary blue-noise at50% strength (approved2026-10-12)
  microtexture on animated Drape at320px/15Hz. The old procedural grain warp remains benchmark-only.
  Drape generates the original smooth field in a tiny target; one simple CSS-pixel pass upscales it and adds
  stationary grain/dither. No per-frame grain-texture generation or texture upload.15Hz is preserved under job pressure;
 4/5/8Hz were rejected visually. UI clocks stay independent. DPR does not multiply field/presentation buffers.
- Hidden, Welcome-covered, unfocused and minimized Drape does zero work. Reduced motion retains the last image,
  invalidations redraw once, resize coalesces for160ms, restoration preserves phase. Static Drape remains a control.
  Atmosphere was not redesigned; Home's worker scene is black and static, so it does not duplicate this microtexture.
  Evidence and protocol: research/performance/auralis-2/GRAIN.md.
- Home's mark is static: no ambient levitation or recurring animation. Welcome handoff and navigation entrances remain finite transitions. The dock's mark also never moves.

## Tests

`app/tests/motion.js`: every primitive with animations on (GSAP tweens are logged through `__motion._log` and counted
from the GSAP timeline, CSS from `document.getAnimations()`), the tokens and the spring, the tool skeleton and the
hover preload, places with depth from the dock icon, the loops running only while shown, a performance trace (no task
over 50 ms) and frames per transition (reported: the container draws in software), fast repeated clicks, and reduced
motion as fades in every frame.
