# Asset provenance

`halation-mark.png` is an unchanged copy of the existing pure Halation identity asset
`docs/brand/halation-mark-source.png` (SHA-256 `79DADA76D9075E018641D90642D27E63D8DEEEEA02F6022DC5BFEEDC2F478AC4`).
It is used only as the product mark. The static Home reference image is kept outside the source tree under ignored
`.tools/ui-rebuild-native/home-reference/`; it is composition guidance only and is not embedded in the application.

`halation-wordmark.svg` is the Halation wordmark as the original app renders it on Home (one path, identity asset).
`drop-outline.svg` is the dashed outline of Home's drop zone, drawn for this crate.
`fonts/Inter.ttf` is the Inter typeface (variable weight, Latin subset), SIL Open Font License 1.1, © The Inter
Project Authors (https://github.com/rsms/inter); the original app uses the same typeface.

`drape-loop.mp4`, `drape-tint.bin` and `drape-still.jpg` are recordings of the original Halation's Drape background:
a seamless two-minute loop of 1800 frames of 320 x 180 at 15 fps stored as lifted luma in H.264, the colour of each
luma, and the first frame. They are made by `scripts/record-drape.js` from the original app (Java allowed reusing the
Drape code for recording only, 2026-10-21). `icons/` holds the Lucide icons (ISC). The whole folder ships beside the executable, not inside it.
