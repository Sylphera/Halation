// WCAG AA contrast of every visible text against the surface behind it.
// contrast(frame) returns the failures: text colour vs the composited background colours of its ancestors.
// Normal text needs 4.5:1, large text (24 px, or 18.66 px bold) 3:1. Disabled controls are exempt, as in WCAG.
exports.contrast = frame => frame.evaluate(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The page behind an iframe is the panel surface of the main window
  const root = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  function background(el) {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = root.a >= 1 ? root : { ...root, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  }
  const disabled = el => !!el.closest(":disabled, [aria-disabled=true], .fp-hidden");
  const out = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement;
    if (!el || !n.nodeValue.trim() || seen.has(el) || /^(SCRIPT|STYLE|OPTION)$/.test(el.tagName)) continue;
    seen.add(el);
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || disabled(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el), fg = parse(cs.color); if (!fg) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const bg = background(el), text = over({ ...fg, a: fg.a * op }, bg);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5, got = ratio(text, bg);
    if (got < need) out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""} “${n.nodeValue.trim().slice(0, 40)}” ${got.toFixed(2)}:1 < ${need}:1`);
  }
  // placeholders
  for (const el of document.querySelectorAll("input[placeholder]")) {
    if (!el.checkVisibility() || disabled(el) || el.value) continue;
    const fg = parse(getComputedStyle(el, "::placeholder").color), bg = background(el);
    if (fg && ratio(over(fg, bg), bg) < 4.5) out.push(`placeholder of #${el.id} ${ratio(over(fg, bg), bg).toFixed(2)}:1`);
  }
  return out;
});
