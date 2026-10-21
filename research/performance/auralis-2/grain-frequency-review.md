# Cheap-grain frequency review —2026-10-12

The user manually compared the native Preview at320px with the same cheap static blue-noise texture and animated organic field, switching between15Hz reference,10Hz and8Hz. Final decision: **15Hz** ("he hecho las pruebas, se queda a15"). No new GPU figures are claimed for these trials. Normal product remains15Hz;10/8Hz are benchmark-only.

The selector preserves procedural time when switching and does not change grain, field resolution or product defaults. It is not loaded by product index.html. No screenshots/videos were generated.

Functional validation: `auralis-grain.js` passed all grain variants, bounded experimental cadences, stationary grain, no per-frame texture uploads, suspension, reduced motion, context loss/restoration and resource bounds.

To reopen the selector on an already running cheap-grain native experiment with CDP9247 and Playwright available:

`node app/scripts/auralis-grain-frequency-review.cjs`

The integrated renderer is configured at15Hz; fresh native compilation/integration verification is still pending independently of this visual frequency decision.
