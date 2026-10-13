// Localization coverage only. No screenshots, video, or visual approval assertions.
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), assert = require("assert/strict");
const { serve, launch, openApp, until } = require("./common");
const { createHost } = require("./host");
const { scanFrame, leftover } = require("./scan");
const DIST = path.join(__dirname, "../dist");
const read = lang => JSON.parse(fs.readFileSync(path.join(DIST, "locales", lang + ".json"), "utf8"));
const en = read("en"), es = read("es");
const vars = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const names = { visualizer: "Audio Visualizer", grade: "Grade", downloader: "Downloader", upscale: "Upscale", framegrab: "Frame Capture", interp: "AI Interpolate", removebg: "Background Remover", covertest: "Cover Test", library: "Library" };

(async () => {
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof es[key], "string", key); assert(es[key].trim(), key);
    assert.deepEqual(vars(es[key]), vars(value), "Placeholders: " + key);
  }
  for (const [id, name] of Object.entries(names)) assert.equal(es["tab." + id], name);
  console.log("PASS every English key has Spanish text and identical placeholders; official tool names preserved");

  const context = { window: {}, document: { documentElement: {} }, fetch: async url => ({ ok: true, json: async () => url.includes("/es.") ? es : en }) };
  context.window.parent = context.window;
  vm.runInNewContext(fs.readFileSync(path.join(DIST, "i18n.js"), "utf8"), context);
  const I = context.window.__i18n;
  await I.load("es");
  for (const key of Object.keys(en).filter(k => k.startsWith("error.native"))) {
    const values = Object.fromEntries(vars(en[key]).map(k => [k, "User File English " + k]));
    const fill = text => text.replace(/\{(\w+)\}/g, (_, k) => values[k]);
    assert.equal(I.error(fill(en[key])), fill(es[key]), key);
  }
  assert.equal(I.t("common.error", { error: "FFmpeg not installed" }), "Error: FFmpeg no está instalado");
  assert.equal(I.error("Error: invalid path"), "Error: Ruta no válida");
  assert.equal(I.error("FFmpeg: Invalid data found when processing input"), "FFmpeg: Invalid data found when processing input");
  assert.equal(I.t("common.savedAs", { name: "English User File.png" }), "Guardado: English User File.png");
  await I.load("en"); assert.equal(I.error("FFmpeg not installed"), "FFmpeg not installed");
  assert.equal(I.error(new Error("invalid path")), "Error: invalid path");
  console.log("PASS all first-party error templates, embedded errors, user names, third-party diagnostics and English compatibility");

  const server = serve(), browser = await launch();
  try {
    for (const language of ["en", "es"]) {
      const host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "halation-localization-")));
      fs.writeFileSync(path.join(host.base, "Settings/app.json"), JSON.stringify({ settings: { language, modules: {} } }));
      const app = await openApp(browser, server, host), page = app.page;
      for (const [id, name] of Object.entries(names)) assert.equal(await page.locator(`.rail [data-tab="${id}"]`).getAttribute("aria-label"), name);
      assert.equal(await page.locator('.rail [data-tab="settings"]').getAttribute("aria-label"), language === "es" ? "Configuración" : "Settings");
      for (const id of ["home", ...Object.keys(names), "settings"]) {
        await app.tab(id);
        if (!["home", "library", "settings"].includes(id)) assert(await until(() => page.frames().some(f => f.url().endsWith(id === "interp" ? "interp.html" : id + ".html")), 15000), id);
        const frame = ["home", "library", "settings"].includes(id) ? page.mainFrame() : page.frames().find(f => f.url().endsWith(id + ".html"));
        await frame.waitForFunction(() => window.__i18n && window.__i18n.lang() === document.documentElement.lang);
        assert.equal(await frame.evaluate(() => document.documentElement.lang), language, id + " language");
        const wrong = await frame.evaluate(() => {
          const bad = [];
          for (const el of document.querySelectorAll("[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]")) {
            for (const attr of ["", "title", "placeholder", "aria-label"]) {
              const key = el.getAttribute("data-i18n" + (attr ? "-" + attr : "")); if (!key) continue;
              const expected = window.t(key), actual = attr ? el.getAttribute(attr) : el.textContent;
              if (el.id === "migration" && !attr && actual === window.t("set.nothingImported")) continue;
              if (!/\{\w+\}/.test(expected) && actual !== expected) bad.push(key + ": " + actual);
            }
          }
          return bad;
        });
        assert.deepEqual(wrong, [], id + " translated attributes");
      }
      await app.tab("settings");
      for (const section of ["general", "you", "files", "processing", "storage", "tools", "about"]) {
        const nav = page.locator(`#setNav [data-sec="sg-${section}"]`);
        if (await nav.count()) await nav.click();
      }
      const version = require("../package.json").version;
      assert.equal(await page.locator("#about").textContent(), language === "es" ? `Halation ${version} · Software libre (GPL-3.0)` : `Halation ${version} · Free software (GPL-3.0)`);
      await page.waitForFunction(() => document.querySelector("#migration").textContent === window.t("set.nothingImported"));
      await page.evaluate(() => window.__shell.toast("FFmpeg not installed"));
      assert.equal(await page.locator("#toast").textContent(), language === "es" ? "FFmpeg no está instalado" : "FFmpeg not installed");
      const key = await page.evaluate(() => window.__shell.jobs.submit({ tool: "grade", title: "English User File.png", lane: "cpu", run: async () => { throw new Error("FFmpeg not installed"); } }).id);
      assert(await until(() => page.evaluate(id => window.__shell.jobs.get(id).state === "failed", key)));
      await page.locator("#procBtn").click();
      assert(await until(() => page.locator("#procList").textContent().then(s => s.includes(language === "es" ? "FFmpeg no está instalado" : "FFmpeg not installed"))));
      assert((await page.locator("#procList").textContent()).includes("English User File.png"));
      assert.deepEqual(await page.evaluate(() => [...window.__i18n.missing]), []);
      assert.deepEqual(app.errors, []);
      console.log("PASS " + language + ": all 12 tabs, iframe language, translated attributes, Settings About, toast and failed job; user content preserved");
      await page.close();
    }
    const host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "halation-localization-pseudo-")));
    fs.writeFileSync(path.join(host.base, "Settings/app.json"), JSON.stringify({ settings: { language: "es" } }));
    const app = await openApp(browser, server, host, { pseudo: true });
    for (const id of Object.keys(names)) {
      await app.tab(id);
      const frame = id === "library" ? app.page.mainFrame() : app.page.frames().find(f => f.url().endsWith(id + ".html"));
      await frame.waitForFunction(() => document.querySelector("[data-i18n]")?.textContent.includes("⟦"));
      const found = (await scanFrame(frame, ["Hanken Grotesk", "JetBrains Mono", "Archivo", "Unbounded", "Syne", "Michroma", "Cinzel", "UnifrakturCook"]))
        .map(([where, text]) => [where, text, leftover(text)]).filter(([, , rest]) => rest);
      assert.deepEqual(found, [], id + " untranslated visible text, titles, labels or options");
    }
    assert.deepEqual(app.errors, []);
    console.log("PASS Spanish pseudo-locale scan of all 9 tools/Library: no unlocalized visible text or accessible attributes");
    await app.page.close();
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
