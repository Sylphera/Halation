// Typed slider values in Visualizer and Grade: limits, steps and units.
// Usage: node app/tests/editor.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "editor");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "editor-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1480, height: 950 });
  const { page, errors } = app;
  const functional = process.argv.includes("--functional");
  const shot = name => functional ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, name) });
  // … in the Visualizer and in Grade
  await app.tab("visualizer"); await app.appReady("visualizer");
  const vis = app.vis, vf = app.vFrame();
  await vf.evaluate(() => { const o = document.getElementById("o-coverSize"), d = o.closest("details"); if (d) d.open = true; });
  const vtype = async (loc, text) => { await loc.click(); await vis.locator("input.numedit").fill(text); await vis.locator("input.numedit").press("Enter"); await painted(vf); };
  await vtype(vis.locator("#o-coverSize"), "150");
  const vA = await vf.evaluate(() => [document.getElementById("f-coverSize").value, document.getElementById("o-coverSize").textContent]);
  await vtype(vis.locator("#o-coverSize"), "40.4");
  const vB = await vf.evaluate(() => [document.getElementById("f-coverSize").value, document.getElementById("o-coverSize").textContent]);
  ok(vA[0] === "95" && vB[0] === "40" && /40/.test(vB[1]), `Visualizer cover size: "150" → ${vA[0]} (max), "40.4" → ${vB[0]} ("${vB[1]}")`);
  await vis.locator("#o-coverSize").click(); await shot("typed-value-visualizer.png"); await vis.locator("input.numedit").press("Escape");
  await app.tab("grade"); await app.appReady("grade");
  const gf = app.gFrame(), gtype = async (text) => { await app.grade.locator("#oThumbPct").click(); await app.grade.locator("input.numedit").fill(text); await app.grade.locator("input.numedit").press("Enter"); await painted(gf); };
  await gtype("33");
  const gA = await gf.evaluate(() => [document.getElementById("thumbPct").value, document.getElementById("oThumbPct").textContent]);
  await gtype("2");
  const gB = await gf.evaluate(() => document.getElementById("thumbPct").value);
  ok(gA[0] === "35" && gA[1] === "35 %" && gB === "5", `Grade thumbnail size: "33" → ${gA[0]} (step 5, "${gA[1]}"), "2" → ${gB} (min)`);
  await app.grade.locator("#oThumbPct").click(); await shot("typed-value-grade.png"); await app.grade.locator("input.numedit").press("Escape");
  await gtype("100");

  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (editor)` : "\nAll passed (editor)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
