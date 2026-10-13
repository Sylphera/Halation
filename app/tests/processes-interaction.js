// Geometry at interruption boundaries, using the frontend scheduler and existing development host.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { serve, launch, openApp, sleep, until } = require('./common');
const { createHost } = require('./host');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hal-pm-interaction-'));
  const host = createHost(tmp), server = serve(), browser = await launch();
  try {
    const app = await openApp(browser, server, host, { motion: true, width: 1280, height: 800 });
    const { page } = app;
    const settle = async () => assert(await until(() => page.evaluate(() => !window.__motion.busy()), 5000, 20));
    await settle();
    await page.evaluate(() => {
      window.__geometry = () => ['.isl-bg', '.isl-mark', '#keysBtn', '#openBase', '#langBtn'].map(s => {
        const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      });
    });
    const jump = pair => Math.max(...pair.before.flatMap((r, i) => r.map((v, k) => Math.abs(v - pair.after[i][k]))));
    const toggle = () => page.evaluate(() => {
      const before = window.__geometry(); document.querySelector('#procBtn').click(); return { before, after: window.__geometry() };
    });
    for (const delay of [16, 35, 75, 16, 110, 20, 55, 16]) {
      assert(jump(await toggle()) < .2, 'manual interruption preserves surface, mark and individual controls');
      await sleep(delay);
    }
    await page.evaluate(() => window.__procs.closeTray({ restore: false })); await settle();
    const split = await page.evaluate(() => {
      const before = window.__geometry();
      let finish; const gate = new Promise(r => { finish = r; });
      window.__finishJob = finish;
      window.__jobHandle = window.__shell.jobs.submit({ tool: 'grade', kind: 'export-image', title: 'Artwork.png', lane: 'cpu', run: async ctx => { ctx.progress(.35, 'Rendering'); await gate; } });
      window.__jobHandle.done.catch(() => {});
      window.__procs.paintIsland();
      return { before, after: window.__geometry() };
    });
    assert(jump(split) < .2, 'activity splits from the exact shared geometry: ' + JSON.stringify(split) + ''); await settle();
    assert(await page.evaluate(() => document.querySelector('#procIsland').classList.contains('detached') && document.querySelector('#toolbox').parentElement.matches('.head')), 'live work detaches');
    for (const delay of [16, 50, 90, 20]) {
      assert(jump(await toggle()) < .2, 'detached island opening and closing stays continuous'); await sleep(delay);
    }
    await page.evaluate(() => window.__procs.closeTray({ restore: false })); await settle();
    const joined = await page.evaluate(async () => {
      window.__finishJob(); await window.__jobHandle.done;
      const before = window.__geometry(); window.__procs.paintIsland(); return { before, after: window.__geometry() };
    });
    assert(jump(joined) < .2, 'completion reintegrates from the current geometry'); await settle();
    assert(await page.evaluate(() => document.querySelector('#procIsland').contains(document.querySelector('#toolbox')) && getComputedStyle(document.querySelector('.tb-bg')).visibility === 'hidden'), 'completion restores one toolbox contour');
    await page.evaluate(() => document.documentElement.dataset.motion = 'reduce');
    await toggle(); await toggle(); await settle();
    assert(!app.errors.length, app.errors.join('\n'));
    console.log('PASS Process Manager: manual reversals, split, activity reversals, completion, reduced motion; no frontend errors');
  } finally { await browser.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
