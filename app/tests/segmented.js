// Segmented controls (.tabs, .ltabs) and the rail pill: the indicator covers the selected option exactly.
// For every selector of every tab, in English, Spanish and the pseudo-locale, at 1600, 1280 and 1024 px wide,
// after clicking each option and after resizing the window while it is open: the pill's box matches the selected
// option's box within 1 px, and neither leaves its control (nothing cut). One pass also runs with animations on.
// Usage: node app/tests/segmented.js   Screenshots go to $SHOTS/segmented.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp } = require("./common");
const { newHost } = require("./scan");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "segmented");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const WIDTHS = [1600, 1280, 1024];
// Tabs of the main window whose frames hold segmented controls; the Visualizer's sit in the export dialog.
const FRAMES = { grade: /grade\.html/, upscale: /upscale\.html/, visualizer: /visualizer\.html/, framegrab: /framegrab\.html/, interp: /interp\.html/, removebg: /removebg\.html/, covertest: /covertest\.html/ };
const PANES = {};
const EXTRA = {
  visualizer: () => { document.getElementById("xDialog").showModal(); document.querySelector("#xMode [data-mode=single]").click(); } };

// In a frame: every segmented control that is on screen, with how far its pill is from the selected option
const ALL = ".tabs,.ltabs";
const measure = sel => [...document.querySelectorAll(sel || ".tabs,.ltabs")].filter(b => b.offsetWidth).map(box => {
  const pill = box.querySelector(":scope>.seg-pill");
  const on = [...box.children].find(c => c !== pill && c.matches('[aria-selected="true"],[aria-checked="true"]'));
  const R = el => el.getBoundingClientRect(), c = R(box);
  const name = (box.id || box.className) + ":" + (box.getAttribute("aria-label") || [...box.children].filter(o => o !== pill).map(o => o.textContent.trim()).join("/")).slice(0, 60);
  if (!pill || !on || pill.hidden) return { name, off: 99, inside: false, opts: 0 };
  const p = R(pill), o = R(on);
  const off = Math.max(Math.abs(p.left - o.left), Math.abs(p.top - o.top), Math.abs(p.width - o.width), Math.abs(p.height - o.height));
  const opts = [...box.children].filter(x => x !== pill);
  const inside = [p, ...opts.map(R)].every(r => r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1)
    && opts.every(x => x.scrollWidth <= x.clientWidth + 1);
  return { name, off: +off.toFixed(2), inside, opts: opts.length };
});
// Clicks option i of control k (index among the visible ones)
const clickOpt = (k, i) => { const box = [...document.querySelectorAll(".tabs,.ltabs")].filter(b => b.offsetWidth)[k]; const o = [...box.children].filter(c => !c.classList.contains("seg-pill"))[i]; o.click(); };

// After a click: every animation in the frame has finished (a sliding pill ends), then two frames drawn (resize
// observers deliver after the first)
const settle = f => f.evaluate(() => new Promise(res => {
  const t0 = performance.now(), busy = () => (document.getAnimations().some(a => a.playState === "running") || (window.__motion && window.__motion.busy())) && performance.now() - t0 < 5000;
  const wait = () => busy() ? requestAnimationFrame(wait) : requestAnimationFrame(() => requestAnimationFrame(res));
  wait();
}));

async function checkFrame(app, name, label, sel = ALL) {
  const f = () => app.page.frames().find(x => FRAMES[name].test(x.url()));
  const now = await f().evaluate(measure, sel);
  ok(now.length > 0 && now.every(m => m.off <= 1 && m.inside), `${label} ${name}: ${now.length} selectors match as they are` + (now.every(m => m.off <= 1 && m.inside) ? "" : " " + JSON.stringify(now)));
  let bad = [];
  for (let k = 0; k < now.length; k++) for (let i = 0; i < now[k].opts; i++) {
    await f().evaluate(([k, i, sel]) => { const box = [...document.querySelectorAll(sel)].filter(b => b.offsetWidth)[k]; const c = [...box.children].filter(c => !c.classList.contains("seg-pill"))[i]; if (c) c.click(); }, [k, i, sel]);   // a box whose options follow another (Cover Test's views) may have fewer now
    await settle(f());
    const m = (await f().evaluate(measure, sel))[k];
    if (!m || m.off > 1 || !m.inside) bad.push(`${now[k].name} #${i}: ${JSON.stringify(m)}`);
  }
  ok(!bad.length, `${label} ${name}: every option of every selector, pill on the option (±1 px) and inside its control` + (bad.length ? " — " + bad.join("; ") : ""));
}
async function checkRail(app, label) {
  const bad = [];
  for (const tab of await app.page.$$eval(".rail .tab[data-tab]", t => t.map(x => x.dataset.tab))) {
    await app.page.locator(`.rail .tab[data-tab="${tab}"]`).click(); await settle(app.page.mainFrame());
    // where the pill ends: measured again while it is still sliding (a tab that boots a heavy tool slows the frames)
    const off = () => app.page.evaluate(t => { const p = document.getElementById("railPill").getBoundingClientRect(), b = document.querySelector(`.rail .tab[data-tab="${t}"]`).getBoundingClientRect(); return Math.abs((p.top + p.height / 2) - (b.top + b.height / 2)); }, tab);
    let d = 0;
    await until(async () => (d = await off()) <= 1, 2000, 100);
    if (d > 1) bad.push(`${tab}: ${d.toFixed(1)} px`);
  }
  ok(!bad.length, `${label} rail: the pill is centred on every selected tab` + (bad.length ? " — " + bad.join(", ") : ""));
}

(async () => {
  const server = serve(), browser = await launch();
  for (const [lang, pseudo] of [["en", false], ["es", false], ["en", true]]) {
    const L = pseudo ? "pseudo" : lang;
    const { host } = newHost(lang);
    const app = await openApp(browser, server, host, { width: WIDTHS[0], height: 900, pseudo });
    for (const name of Object.keys(FRAMES)) { await app.tab(name); if (name !== "upscale") await app.appReady(name); }
    for (const [n, w] of WIDTHS.entries()) {
      await app.page.setViewportSize({ width: w, height: 900 }); await painted(app.page);   // resized while open
      for (const name of Object.keys(FRAMES)) {
        await app.tab(name);
        const f = app.page.frames().find(x => FRAMES[name].test(x.url()));
        if (EXTRA[name]) { await f.evaluate(EXTRA[name]); await settle(f); }
        if (PANES[name]) {
          for (const pane of PANES[name]) {
            await f.evaluate(p => window.__halApp.test.showTab(p), pane); await settle(f);
            await checkFrame(app, name, `${L} ${w}px ${pane}`, ".tabs:not(#inspTabs),.ltabs");
            ok((await f.evaluate(measure)).every(m => m.off <= 1 && m.inside), `${L} ${w}px ${name}: the inspector tabs' pill is on "${pane}"`);
            if (n === 0 || w === 1024) await app.page.screenshot({ path: path.join(SHOTS, `${L}-${w}-${name}-${pane}.png`) });
          }
          continue;
        }
        await checkFrame(app, name, `${L} ${w}px`);
        if (n === 0 || w === 1024) await app.page.screenshot({ path: path.join(SHOTS, `${L}-${w}-${name}.png`) });
        if (name === "visualizer") await f.evaluate(() => document.getElementById("xDialog").close());
      }
      await checkRail(app, `${L} ${w}px`);
    }
    ok(!app.errors.length, `${L}: no console errors` + (app.errors.length ? " — " + app.errors.slice(0, 3).join(" | ") : ""));
    await app.page.close();
  }
  // animations on: the pill slides and ends on the option
  const { host } = newHost("en");
  const app = await openApp(browser, server, host, { width: 1280, height: 900, motion: true });
  await app.tab("grade"); await app.appReady("grade");
  await checkFrame(app, "grade", "motion 1280px");
  await checkRail(app, "motion 1280px");
  await app.page.close();
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (segmented)` : "\nAll passed (segmented)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
