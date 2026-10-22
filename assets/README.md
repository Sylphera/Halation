# Asset provenance

`halation-mark.png` is the Halation logo (Java, 2026-10-22): a hand-drawn vector stroke,
`docs/media/brand/source/halation-mark.svg`, rendered at 512 px by `tools/render-brand.js` (an identity asset, drawn for
this project). `halation-app-icon.png` is the window and taskbar icon from the same script: the mark on a flat
`#111111` rounded square. The static Home reference image is kept outside the source tree under ignored
`.tools/ui-rebuild-native/home-reference/`; it is composition guidance only and is not embedded in the application.

`halation-wordmark.svg` is the HALATION wordmark (one path, identity asset): Bodoni Moda (SIL OFL 1.1) at weight 600,
optical size 60, tracked 0.20 em, converted to outlines (Java's choice, 2026-10-22).
`halation-wordmark-glow.png` is the wordmark's halation glow (960 x 428, the wordmark plus 180 px around it), drawn
from the wordmark by `tools/render-wordmark-glow.js` with Java's settings (2026-10-22).
`drop-outline.svg` is the dashed outline of Home's drop zone, drawn for this crate.
`fonts/SchibstedGrotesk.ttf` (variable weight, © The Schibsted-Grotesk Project Authors) is the interface face and
`fonts/Italiana.ttf` (© Santiago Orozco, Reserved Font Name "Italiana", unmodified) the page-title face; both SIL Open
Font License 1.1, from the Google Fonts repository.

`drape-loop.mp4`, `drape-tint.bin` and `drape-still.jpg` are recordings of the original Halation's Drape background:
a seamless two-minute loop of 1800 frames of 320 x 180 at 15 fps stored as lifted luma in H.264, the colour of each
luma, and the first frame. They are made by `scripts/record-drape.js` from the original app (Java allowed reusing the
Drape code for recording only, 2026-10-21). `icons/` holds the Lucide icons (ISC). The whole folder ships beside the executable, not inside it.
