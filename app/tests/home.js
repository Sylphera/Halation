// Home over the mocked backend: the logo (symbol over the wordmark, centred, no box), no search, the tool bar (one
// compact bubble, the dock's pointer light, a tool opens, a module turned off drops out), the background's variant
// per launch, the drop zone (centred, the image's choice inside it, the highlight while dragging), the grain's pace, the Spanish names, and the Home entrance with animations on.
// Usage: node app/tests/home.js   Screenshots go to $SHOTS/home.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { newHost, FX } = require("./scan");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "home");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

(async () => {
  const server = serve(), browser = await launch();
  const { host } = newHost("en");
  const { L } = locale("en");
  const app = await openApp(browser, server, host, { width: 1480, height: 1000 });
  const { page, errors, tab, grade, appReady } = app;
  await page.evaluate(() => { window.__noReload = 1; });
  const active = id => page.evaluate(n => document.querySelector("#v-" + n).classList.contains("on"), id);
  const home = async () => { await page.locator(".rail .tab.home").click(); await until(() => active("home"), 5000, 20); await painted(page); };
  /* ---------- the logo ---------- */
  await home();
  const g = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect(), v = r("#v-home .page-in"), logo = r(".hero .logo"), word = r(".hero .word"), bar = r("#hcards");
    const cards = [...document.querySelectorAll(".hcard")].map(c => c.getBoundingClientRect());
    return { mid: v.left + v.width / 2, logo, word, bar, rows: new Set(cards.map(c => Math.round(c.top))).size, clipped: [...document.querySelectorAll(".hcard b")].some(b => b.scrollWidth > b.clientWidth + 1),
      bg: getComputedStyle(document.querySelector(".hero")).backgroundColor, fill: getComputedStyle(document.querySelector(".hero .logo")).fill, search: !!document.querySelector("#homeSearch, .hsearch") };
  });
  const centred = r => Math.abs(r.left + r.width / 2 - g.mid) < 2;
  ok(centred(g.logo) && centred(g.word) && centred(g.bar), "Home: the symbol, the wordmark and the tool bar are centred");
  ok(g.logo.width >= 120 && g.logo.bottom <= g.word.top && g.word.bottom < g.bar.top, "Home: the symbol, big, over the wordmark, then the tool bar");
  ok(!g.search, "Home: no search");
  ok(g.rows === 1 && g.bar.height < 70 && !g.clipped, `Home: the tools fit one compact row, no name cut: ${g.rows} row(s), ${Math.round(g.bar.height)} px`);
  ok(await page.locator("#v-home .hero .note").textContent() === L("home.tagline"), "Home: the line under the wordmark");
  ok(g.bg === "rgba(0, 0, 0, 0)" && g.fill === "rgb(245, 245, 242)", "Home: no box behind the logo, drawn in the text colour: " + g.bg + " · " + g.fill);
  await page.screenshot({ path: path.join(SHOTS, "home.png") });

  /* ---------- the tool bar: the dock's light follows the pointer ---------- */
  const card = await page.locator('.hcard[data-go="grade"]').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  const light = await page.evaluate(() => { const b = document.querySelector("#hcards"), r = b.getBoundingClientRect(); return { gx: parseFloat(b.style.getPropertyValue("--gx")), w: r.width, glow: getComputedStyle(b, "::after").backgroundImage }; });
  ok(Math.abs(light.gx - (card.x + card.width / 2 - g.bar.left)) < 2 && /radial-gradient/.test(light.glow), "Tool bar: the light sits under the pointer, as on the dock: " + light.gx);
  await page.screenshot({ path: path.join(SHOTS, "toolbar-hover.png"), clip: { x: g.bar.left - 20, y: g.bar.top - 20, width: g.bar.width + 40, height: g.bar.height + 40 } });

  /* ---------- the drop zone: centred, big, the choice for an image inside it ---------- */
  const dz = await page.locator("#homeDrop").boundingBox();
  ok(Math.abs(dz.x + dz.width / 2 - g.mid) < 2 && dz.width >= 560 && dz.height >= 140 && dz.y > g.bar.bottom, `Drop zone: centred under the tool bar, big: ${Math.round(dz.width)}×${Math.round(dz.height)}`);
  await page.evaluate(() => { const z = document.querySelector("#homeDrop"), r = z.getBoundingClientRect(); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(4)], "a.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover"]) z.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 100, clientY: r.top + 40 })); });
  ok(await page.evaluate(() => document.querySelector("#homeDrop").classList.contains("over")) && await page.locator("#dropzone").isHidden(), "Drop zone: dragging over Home lights it up, no window-wide overlay");
  await page.screenshot({ path: path.join(SHOTS, "drop-over.png") });
  await page.evaluate(() => document.dispatchEvent(new DragEvent("dragleave", { bubbles: true, clientX: 0, clientY: 0 })));
  await page.locator("#homeIn").setInputFiles(path.join(FX.FIX, "cover.png"));
  ok(await until(() => page.locator("#homeChoice").isVisible(), 3000, 20) && await page.locator("#imgChoice").isHidden(), "Drop zone: an image asks where it goes inside the zone, not in a menu at the pointer");
  const ch = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), z = r("#homeDrop"), c = r("#homeChoice"), a = r("#homeChoiceActs");
    return { inside: c.left >= z.left && c.right <= z.right && c.top >= z.top && c.bottom <= z.bottom, mid: Math.abs(a.left + a.width / 2 - (z.left + z.width / 2)), name: document.querySelector("#homeChoiceName").textContent, thumb: /url\(/.test(document.querySelector("#homeChoiceThumb").style.backgroundImage) }; });
  ok(ch.inside && ch.mid < 2 && ch.name === "cover.png" && ch.thumb, "Drop zone: the choice sits centred in it, with the image and its name: " + JSON.stringify(ch));
  await page.screenshot({ path: path.join(SHOTS, "drop-choice.png") });
  await page.keyboard.press("Escape");
  ok(await until(() => page.locator("#homeDrop .hd-idle").isVisible(), 3000, 20) && await page.locator("#homeChoice").isHidden(), "Drop zone: Esc goes back to «" + L("home.drop") + "»");

  /* ---------- the tools open, and switching tools and back ---------- */
  await page.locator('.hcard[data-go="upscale"]').click();
  ok(await until(() => active("upscale"), 8000, 20), "A tool of the bar opens it");
  await tab("visualizer"); await home();
  ok(await page.locator(".hcard").count() === await page.evaluate(() => window.__modules.MODULES.filter(m => m.home).length), "Back on Home: every tool is on the bar");
  await page.locator('.hcard[data-go="library"]').click();
  ok(await until(() => active("library"), 5000, 20), "Library opens from the bar");

  /* ---------- a module turned off drops out of the bar ---------- */
  await tab("settings");
  await page.locator('#modules [data-mod="grade"]').uncheck(); await until(() => page.evaluate(() => !document.querySelector('.rail .tab[data-tab="grade"]')), 5000, 20);
  await home();
  ok(await page.locator('.hcard[data-go="grade"]').count() === 0, "Grade turned off: not on the bar");
  await tab("settings");
  await page.locator('#modules [data-mod="grade"]').check(); await until(() => page.evaluate(() => !!document.querySelector('.rail .tab[data-tab="grade"]')), 5000, 20);
  await home();
  ok(await page.locator('.hcard[data-go="grade"]').count() === 1, "Grade back on: on the bar again");

  /* ---------- Drape: one continuous global background, no legacy variants ---------- */
  ok(await page.evaluate(() => document.querySelectorAll('.atmo canvas').length === 1 && !document.querySelector('.grain') && window.__atmo.current === 'home'), "Background: one Drape canvas, no separate grain over Home");
  await page.reload(); await until(() => page.evaluate(() => !!window.__atmo?.review?.scene()), 8000, 30);
  ok(await page.evaluate(() => window.__atmo.review.scene().renderer === 'drape'), "Background: reload mounts the same Drape source");
  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" / ") : ""));
  await page.close();

  /* ---------- Spanish ---------- */
  {
    const es = locale("es").L, { host: h } = newHost("es");
    const e = await openApp(browser, server, h, { width: 1480, height: 1000 });
    const clipped = await e.page.evaluate(() => [...document.querySelectorAll(".hcard b")].some(b => b.scrollWidth > b.clientWidth + 1));
    ok(await e.page.locator('.hcard[data-go="removebg"] b').textContent() === es("tab.removebg") && !clipped, "Spanish: the tool names on the bar, none cut");
    await e.page.screenshot({ path: path.join(SHOTS, "home-es.png") });
    ok(!e.errors.length, "No page errors in Spanish" + (e.errors.length ? ": " + e.errors.join(" / ") : ""));
    await e.page.close();
  }

  /* ---------- the entrance, with animations on ---------- */
  const { host: h2 } = newHost("en");
  const m = await openApp(browser, server, h2, { width: 1480, height: 1000, motion: true });
  await m.tab("library");
  await m.page.locator(".rail .tab.home").click();
  // GSAP tweens (motion.js) running on Home: their targets and the properties they move
  const running = await m.page.evaluate(() => new Promise(res => requestAnimationFrame(() => {
    const tw = window.__motion.gsap.globalTimeline.getChildren(true, true, false).filter(t => t.progress() < 1 && t.targets);
    const on = el => tw.some(t => t.targets().includes(el));
    res({
      logo: on(document.querySelector(".hero .logo")),
      word: on(document.querySelector(".hero .word")),
      bar: on(document.querySelector("#hcards")),
      props: tw.filter(t => t.targets().some(el => el.closest && el.closest("#v-home"))).flatMap(t => Object.keys(t.vars)).filter(k => !["opacity", "transform", "transformOrigin", "duration", "delay", "ease", "overwrite", "immediateRender", "onComplete", "startAt", "runBackwards", "stagger", "x", "y", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "force3D", "parent", "onInterrupt", "filter", "paused"].includes(k))
    });
  })));
  ok(running.logo && running.word && running.bar, "Entrance: the logo, the wordmark and the tool bar come forward: " + JSON.stringify([running.logo, running.word, running.bar]));
  ok(!running.props.length, "Entrance: only transform, opacity and the depth blur move" + (running.props.length ? ": " + running.props.join(",") : ""));
  await m.page.waitForTimeout(120);
  await m.page.screenshot({ path: path.join(SHOTS, "entrance-mid.png") });
  await until(() => m.page.evaluate(() => !window.__motion.busy()), 5000, 30);
  ok(await m.page.evaluate(() => getComputedStyle(document.querySelector(".hero .logo")).opacity === "1"), "Entrance: everything ends in place");
  ok(await m.page.evaluate(() => document.querySelectorAll('.atmo canvas').length === 1 && !document.querySelector('.grain')), "Home: Drape owns its integrated grain/dither");
  // Library and Settings are pages with their own backdrop; a tool is what restores the tool backdrop
  await m.tab("grade");
  ok(await until(()=>m.page.evaluate(() => window.__atmo.current === 'tool' && getComputedStyle(document.querySelector('.drape-host')).visibility === 'hidden' && !document.querySelector('.grain')),5000,20), "Navigation: tools restore the previous backdrop without Drape");
  await m.page.locator(".rail .tab.home").click();
  // a box crossing the edge of a scrolling column keeps its rounded frame at the edge (common.js)
  await m.tab("settings");
  await m.page.evaluate(() => { document.querySelector("#v-settings").scrollTop = 520; });
  const cut = await until(() => m.page.evaluate(() => { const sc = document.querySelector("#v-settings").getBoundingClientRect(); return [...document.querySelectorAll("#v-settings .card")].map(c => { const r = c.getBoundingClientRect(); return { crosses: r.top < sc.top || r.bottom > sc.bottom, clip: c.style.clipPath, cut: c.classList.contains("boxcut") }; }).filter(c => c.crosses); }).then(c => c.length && c.every(x => x.clip.startsWith("inset(") && (x.cut || x.clip === "inset(50%)")) ? c : null), 2000, 30);
  ok(cut, "Settings scrolled: every card crossing an edge keeps its rounded frame there");
  await m.page.evaluate(() => { document.querySelector("#v-settings").scrollTop = 0; });
  ok(await until(() => m.page.evaluate(() => { const c = document.querySelector("#v-settings .card"); return !c.style.clipPath && !c.classList.contains("boxcut"); }), 2000, 30), "Back at the top: the first card is whole again");
  ok(!m.errors.length, "No page errors with animations on" + (m.errors.length ? ": " + m.errors.join(" / ") : ""));

  await browser.close(); server.close();
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
