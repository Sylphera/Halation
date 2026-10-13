// Grade looks quality (docs/GRADE_LOOKS_SPEC.md §7.2): every catalogue look's colour function on the test set of
// fixtures/looks, at 100 % with no adjustments. Clipping, grey-ramp monotony and banding, chroma ceiling, skin and
// primary hue shifts, distance between looks of a category, and the LUT hash baseline (determinism).
// HAL_LOOKS_REPORT=1 prints the table of every look; HAL_LOOKS_BASELINE=1 rewrites grade-looks-baseline.json.
const fs = require("fs"), path = require("path"), assert = require("assert/strict");
const { serve, launch } = require("./common");
const SET = path.join(__dirname, "fixtures", "looks"), BASE = path.join(__dirname, "grade-looks-baseline.json");
const IMAGES = ["portrait-day.jpg", "portrait-warm.jpg", "portrait-dark-skin.jpg", "people-street.jpg", "landscape-sky.jpg", "landscape-green.jpg", "night-city.jpg", "interior-dark.jpg", "high-key.jpg", "render.jpg", "cover.png", "saturated.jpg", "near-mono.jpg"];
// skin rectangles (x, y, w, h) in fixture pixels
const SKIN = { "portrait-day.jpg": [320, 480, 90, 110], "portrait-warm.jpg": [500, 340, 80, 60], "portrait-dark-skin.jpg": [470, 150, 120, 70] };
// limits (§7.2); the distance floor is the one fixed with the approved looks
// creative looks (intent.creative: cover and thumbnail design) may move skin, primaries and the grey ramp, but still keep
// part of the hue spread unless they are declared duotones (intent.duotone: a two-colour print over the picture's tones); hues: share of the picture's hue spread a colour look keeps (no single-colour wash); step: largest grey-ramp step in 8-bit code values; skin: mean degrees; distance: mean ΔE OKLab of the closest pair
const LIM = { clip: 0.005, chroma: 0.32, chromaVivid: 0.37, skin: 12, primary: 25, step: 3.5, distance: 0.015, hues: 0.6, huesCreative: 0.35 };

(async () => {
  const server = serve(), browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.address().port}/tokens.css`);
    const files = Object.fromEntries(IMAGES.map(n => [n, fs.readFileSync(path.join(SET, n)).toString("base64")]));
    const r = await page.evaluate(async ([files, SKIN]) => {
      const C = await import("./grade-color.js"), { LOOKS2 } = await import("./grade-looks.js");
      // pictures: every 4th pixel (sRGB 0…1), plus the skin rectangles in full
      const pics = {};
      for (const [n, b64] of Object.entries(files)) {
        const bmp = await createImageBitmap(await (await fetch("data:image/" + (n.endsWith(".png") ? "png" : "jpeg") + ";base64," + b64)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height), x = cv.getContext("2d"); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, bmp.width, bmp.height).data, px = [], skin = [];
        for (let y = 0; y < bmp.height; y += 4) for (let xx = 0; xx < bmp.width; xx += 4) { const i = (y * bmp.width + xx) * 4; px.push(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); }
        const s = SKIN[n];
        if (s) for (let y = s[1]; y < s[1] + s[3]; y += 2) for (let xx = s[0]; xx < s[0] + s[2]; xx += 2) { const i = (y * bmp.width + xx) * 4; skin.push(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); }
        pics[n] = { px: new Float32Array(px), skin: new Float32Array(skin) };
      }
      const lab = (r, g, b) => { const o = C.okLab(C.s2l(r), C.s2l(g), C.s2l(b), [0, 0, 0]); return o; };
      const hue = o => Math.atan2(o[2], o[1]) * 180 / Math.PI;
      const dh = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
      const PRIM = [[0.8, 0.15, 0.15], [0.2, 0.7, 0.2], [0.2, 0.3, 0.85], [0.85, 0.8, 0.2], [0.2, 0.75, 0.8], [0.8, 0.2, 0.75]];
      const out = [], means = {};
      for (const L of LOOKS2) {
        const fn = C.compileLook(L), m = { id: L.id, cat: L.cat, intent: L.intent || {} };
        // clipping: pixels with a channel newly at 0 or 255, over the set
        // strength: mean ΔE (OKLab) from the original; hue spread kept: on each colourful picture, 1 − |mean hue vector|
        // of its colourful pixels, after over before (a look that paints one colour over everything drops towards 0)
        let n = 0, lo = 0, hi = 0, cmax = 0, de = 0; const avg = [], kept = [];
        for (const name of Object.keys(pics)) {
          const p = pics[name].px, mean = []; let ia = 0, ib = 0, ic = 0, oa = 0, ob = 0, oc = 0;
          for (let i = 0; i < p.length; i += 3) {
            // newly crushed to black or blown to white (every channel): detail lost. A single channel at its limit is the gamut
            // knee's edge and keeps the hue, so it does not count
            const o = fn(p[i], p[i + 1], p[i + 2]), wasLo = Math.max(p[i], p[i + 1], p[i + 2]) <= 1.5 / 255, wasHi = Math.min(p[i], p[i + 1], p[i + 2]) >= 254.5 / 255;
            if (!wasLo && Math.max(o[0], o[1], o[2]) <= 1.5 / 255) lo++;
            if (!wasHi && Math.min(o[0], o[1], o[2]) >= 254.5 / 255) hi++;
            n++;
            const q = lab(o[0], o[1], o[2]), c = Math.hypot(q[1], q[2]), s = lab(p[i], p[i + 1], p[i + 2]), sc = Math.hypot(s[1], s[2]); cmax = Math.max(cmax, c);
            de += Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]);
            if (sc > 0.03) { ia += s[1] / sc; ib += s[2] / sc; ic++; }
            if (c > 0.03) { oa += q[1] / c; ob += q[2] / c; oc++; }
            if (i % 30 === 0) mean.push(q[0], q[1], q[2]);
          }
          avg.push(...mean);
          const si = ic ? 1 - Math.hypot(ia, ib) / ic : 0, so = oc ? 1 - Math.hypot(oa, ob) / oc : 0;
          if (si > 0.25 && ic > p.length / 3 * 0.1) kept.push(so / si);
        }
        m.strength = de / n; m.hueKept = kept.length ? kept.reduce((a, b) => a + b) / kept.length : 1;
        means[L.id] = new Float32Array(avg);
        m.clipLo = lo / n; m.clipHi = hi / n; m.chroma = cmax;
        // grey ramp: L of OKLab, 256 steps
        // on encoded values (perceptual steps; OKLab L's cube root would make the first steps from black look like jumps)
        const Ls = []; for (let i = 0; i < 256; i++) { const o = fn(i / 255, i / 255, i / 255); Ls.push(0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2]); }
        let inv = 0, maxStep = 0;
        for (let i = 1; i < 256; i++) { const d = Ls[i] - Ls[i - 1]; if (d < -1e-4) inv++; maxStep = Math.max(maxStep, d); }
        m.inversions = inv; m.stepRatio = maxStep * 255;   // in 8-bit code values (identity: 1)
        // skin: mean hue shift over the three portraits
        let sh = 0, sn = 0;
        for (const name of Object.keys(pics)) { const s = pics[name].skin; for (let i = 0; i < s.length; i += 3) { const a = lab(s[i], s[i + 1], s[i + 2]); if (Math.hypot(a[1], a[2]) < 0.02) continue; const o = fn(s[i], s[i + 1], s[i + 2]), b = lab(o[0], o[1], o[2]); if (Math.hypot(b[1], b[2]) < 0.01) continue; sh += dh(hue(a), hue(b)); sn++; } }
        m.skin = sn ? sh / sn : 0;
        m.primary = Math.max(...PRIM.map(c => { const a = lab(...c), o = fn(...c), b = lab(o[0], o[1], o[2]); return Math.hypot(b[1], b[2]) < 0.02 ? 0 : dh(hue(a), hue(b)); }));
        // determinism: the LUT twice, byte-identical; its hash for the baseline
        const a = C.buildLookLUT(L), b = C.buildLookLUT(L);
        m.same = a.length === b.length && a.every((v, i) => v === b[i]);
        m.hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", a.buffer))].map(v => v.toString(16).padStart(2, "0")).join("");
        out.push(m);
      }
      // distance between looks of one category: mean ΔE (OKLab) over the set, closest pair per category
      const dist = {};
      for (const A of LOOKS2) for (const B of LOOKS2) if (A.cat === B.cat && A.id < B.id) {
        const a = means[A.id], b = means[B.id]; let s = 0; for (let i = 0; i < a.length; i += 3) s += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
        const d = s / (a.length / 3); if (!dist[A.cat] || d < dist[A.cat][0]) dist[A.cat] = [d, A.id, B.id];
      }
      return { looks: out, dist };
    }, [files, SKIN]);
    if (process.env.HAL_LOOKS_REPORT) {
      for (const m of r.looks) console.log(`${m.id.padEnd(14)} clip ${(m.clipLo * 100).toFixed(2)}/${(m.clipHi * 100).toFixed(2)}%  C ${m.chroma.toFixed(3)}  inv ${m.inversions}  step ${m.stepRatio.toFixed(2)}cv  skin ${m.skin.toFixed(1)}°  prim ${m.primary.toFixed(1)}°  ΔE ${m.strength.toFixed(3)}  hues ${(m.hueKept * 100).toFixed(0)}%`);
      for (const [c, d] of Object.entries(r.dist)) console.log(`${c.padEnd(10)} closest ${d[0].toFixed(4)} ${d[1]} ~ ${d[2]}`);
    }
    const fails = [];
    for (const m of r.looks) {
      const it = m.intent, f = (ok, what) => { if (!ok) fails.push(`${m.id}: ${what}`); };
      f(it.crush || m.clipLo <= LIM.clip, `blacks clipped ${(m.clipLo * 100).toFixed(2)} %`);
      f(it.clip || m.clipHi <= LIM.clip, `whites clipped ${(m.clipHi * 100).toFixed(2)} %`);
      f(it.creative || m.inversions === 0, `grey ramp inverts ${m.inversions} times`);
      f(it.clip || it.creative || m.stepRatio <= LIM.step, `grey ramp step of ${m.stepRatio.toFixed(2)} code values`);
      f(m.chroma <= (m.cat === "vivid" ? LIM.chromaVivid : LIM.chroma), `chroma ${m.chroma.toFixed(3)}`);
      f(it.mono || it.skin || it.creative || m.skin <= LIM.skin, `skin hue shift ${m.skin.toFixed(1)}°`);
      f(it.mono || it.hueShift || it.creative || m.primary <= LIM.primary, `primary hue shift ${m.primary.toFixed(1)}°`);
      f(it.mono || it.selective || it.duotone || m.hueKept >= (it.creative ? LIM.huesCreative : LIM.hues), `paints one colour over the picture: ${(m.hueKept * 100).toFixed(0)} % of the hue spread kept`);
      f(m.same, "LUT not deterministic");
    }
    for (const [c, d] of Object.entries(r.dist)) if (d[0] < LIM.distance) fails.push(`${c}: ${d[1]} and ${d[2]} too close (${d[0].toFixed(4)})`);
    const hashes = Object.fromEntries(r.looks.map(m => [m.id, m.hash]));
    if (process.env.HAL_LOOKS_BASELINE || !fs.existsSync(BASE)) fs.writeFileSync(BASE, JSON.stringify(hashes, null, 1) + "\n");
    const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
    for (const [id, h] of Object.entries(hashes)) if (base[id] && base[id] !== h) fails.push(`${id}: LUT changed since the baseline (a published look raises rev, §3.4)`);
    for (const id of Object.keys(base)) if (!hashes[id]) fails.push(`${id}: in the baseline but not in the catalogue`);
    assert.deepEqual(fails, [], "Look quality:\n" + fails.join("\n"));
    console.log(`PASS ${r.looks.length} looks within the quality limits, LUTs deterministic and equal to the baseline`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e.message || e); process.exitCode = 1; });
