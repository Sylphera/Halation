// Navigation scheduling with real motion and tool readiness. No visual artifacts.
const assert = require('assert/strict');
const { serve, launch, openApp, sleep, until } = require('./common');
const { newHost } = require('./scan');

(async () => {
  const server = serve(), browser = await launch(), { host } = newHost('en');
  const app = await openApp(browser, server, host, { motion: true });
  const page = app.page;
  await page.evaluate(() => window.__shell.session.ready);
  await sleep(500);
  assert.equal(await page.locator(".hero-mark").evaluate(el => getComputedStyle(el).animationName), "none", "Home logo has no recurring ambient animation");
  await page.addInitScript(() => {
    if (window !== top && location.pathname.endsWith('.html')) parent.__navigationEvents?.push('document:' + location.pathname);
  });
  await page.evaluate(() => {
    window.__navigationEvents = [];
    const m = window.__motion, swap = m.swap;
    m.swap = (...args) => {
      const a = swap(...args);
      a?.settled.then(ok => window.__navigationEvents.push('settled:' + args[1].view.id + ':' + ok));
      return a;
    };
    window.__shell.show('grade');
  });
  assert.equal(await page.locator('#v-grade').getAttribute('src'), null, 'Click paints navigation before starting the cold iframe');
  assert.equal(await page.locator('#toolSkel').isVisible(), true);
  await page.evaluate(() => window.__shell.ensureApp('grade'));
  let events = await page.evaluate(() => window.__navigationEvents);
  assert(events.indexOf('settled:v-grade:true') < events.indexOf('document:/grade.html'), JSON.stringify(events));
  await until(() => page.locator('#v-grade').evaluate(e => !e.classList.contains('pending')), 3000);
  await page.evaluate(() => { window.__warmApp = window.__shell.loadedApp('grade'); window.__shell.show('home'); });
  assert(await until(() => page.evaluate(() => window.__navigationEvents.includes('settled:v-home:true')), 3000));
  await page.evaluate(() => { window.__navigationEvents.length = 0; window.__shell.show('grade'); });
  assert(await until(() => page.evaluate(() => window.__navigationEvents.includes('settled:v-grade:true')), 3000));
  assert.equal(await page.evaluate(() => window.__warmApp === window.__shell.loadedApp('grade')), true);
  events = await page.evaluate(() => window.__navigationEvents);
  assert(!events.some(e => e.startsWith('document:')));
  assert(events.includes('settled:v-grade:true'));
  await page.evaluate(() => {
    window.__navigationEvents.length=0;window.__shell.show('home');
    window.__homeReveal=window.__motion.gsap.globalTimeline.getChildren(true,true,false).find(t=>t.targets().includes(document.querySelector('#hcards'))&&t.progress()<1);
  });
  assert.equal(await page.evaluate(() => window.__homeReveal.paused()), true, 'Home reveal is prepared while the shell owns the transition');
  assert(await until(() => page.evaluate(() => !window.__homeReveal.paused()), 3000));
  assert((await page.evaluate(() => window.__navigationEvents)).includes('settled:v-home:true'), 'Home reveal starts after both shell phases');
  await sleep(500);
  await page.evaluate(() => { window.__shell.show('grade'); }); await sleep(400);
  await page.evaluate(() => { window.__shell.show('home');window.__shell.show('grade'); }); await sleep(500);
  assert.equal(await page.locator('#hcards').evaluate(e => e.style.opacity), '', 'An abandoned queued Home reveal restores its inline state');

  // Interrupt both phases: abandoned destinations never start parsing or reveal a stale skeleton.
  await page.evaluate(() => window.__shell.show('removebg')); await sleep(25);
  await page.evaluate(() => window.__shell.show('framegrab')); await sleep(180);
  await page.evaluate(() => window.__shell.show('home')); await sleep(500);
  for (const id of ['removebg', 'framegrab']) assert.equal(await page.locator('#v-' + id).getAttribute('src'), null);
  assert.equal(await page.locator('#toolSkel').isHidden(), true);

  // Explicit hidden loading still completes, even when it must wait for navigation.
  await page.evaluate(async () => { window.__shell.show('settings'); await window.__shell.ensureApp('upscale'); });
  assert.equal(await page.evaluate(() => window.__shell.active()), 'settings');
  assert.equal(await page.evaluate(() => !!window.__shell.loadedApp('upscale')), true);
  await page.evaluate(() => window.__shell.show('upscale')); await sleep(450);
  await page.evaluate(() => window.__shell.show('home')); await sleep(450);
  const upscale = page.frames().find(f => f.url().endsWith('/upscale.html'));
  await upscale.evaluate(() => window.__playIcon=document.querySelector('#videoPlay').firstElementChild);
  for(let i=0;i<3;i++){
    await page.evaluate(() => window.__shell.show('upscale')); await sleep(350);
    await page.evaluate(() => window.__shell.show('home')); await sleep(350);
    assert.equal(await upscale.evaluate(() => window.__playIcon===document.querySelector('#videoPlay').firstElementChild), true, 'Warm exit does not rebuild the already stopped video Play icon');
  }

  // A preload can become ready halfway through a click's transition. Keep its skeleton until settling.
  await page.route('**/interp.html', r => r.fulfill({ contentType: 'text/html', body: '<script>const ready=new Promise(r=>window.finish=()=>{window.readyFinished=true;r()});window.__halApp={get ready(){window.readyObserved=true;return ready}};</script>' }));
  await page.locator('.rail .tab[data-tab=interp]').hover();
  assert(await until(() => page.locator('#v-interp').getAttribute('src').then(Boolean), 2000));
  assert(await until(() => page.frames().some(f => f.url().endsWith('/interp.html')), 2000));
  const frame = page.frames().find(f => f.url().endsWith('/interp.html'));
  assert(frame); await frame.waitForFunction(() => window.readyObserved && !!window.finish);
  // Resolve readiness and sample before yielding to another render task. Node/CDP round trips
  // can outlast the transition, so an external 80 ms sleep cannot identify this state reliably.
  const during = await page.evaluate(async () => {
    window.__navigationEvents.length = 0; window.__shell.show('interp');
    const view = document.querySelector('#v-interp'); view.contentWindow.finish();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    return { ready: view.contentWindow.readyFinished, settled: window.__navigationEvents.includes('settled:v-interp:true'), pending: view.classList.contains('pending') };
  });
  assert.equal(during.ready, true);
  assert.equal(during.settled, false);
  assert.equal(during.pending, true);
  assert(await until(() => page.locator('#v-interp').evaluate(e => !e.classList.contains('pending')), 2000));
  assert((await page.evaluate(() => window.__navigationEvents)).includes('settled:v-interp:true'));

  // Reduced motion uses its real fade completion; it does not inherit a hardcoded 300 ms delay.
  await page.evaluate(() => { document.documentElement.dataset.motion = 'reduce'; window.__navigationEvents.length = 0; window.__shell.show('removebg'); });
  await page.evaluate(() => window.__shell.ensureApp('removebg'));
  events = await page.evaluate(() => window.__navigationEvents);
  assert(events.indexOf('settled:v-removebg:true') < events.indexOf('document:/removebg.html'));
  assert.deepEqual(app.errors, []);
  await page.close();
  const off = await openApp(browser, server, host);
  await off.page.evaluate(() => window.__shell.ensureApp('framegrab'));
  assert.equal(await off.page.evaluate(() => !!window.__shell.loadedApp('framegrab')), true, 'Motion-off hidden loading never waits for a missing animation');
  assert.deepEqual(off.errors, []);
  await browser.close(); server.close(); console.log('OK tool transitions: cold/warm, both-phase interruption, hidden ensureApp, preload readiness, reduced/off motion');
})().catch(e => { console.error(e); process.exit(1); });
