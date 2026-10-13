// Decorative work shares one bounded clock. Interactive motion and exports keep their own clocks.
(() => {
  'use strict';
  const root = document.documentElement;
  const profiles = [
    Object.freeze({ name:'high', fps:60, dpr:2, scale:1, fieldScale:.5 }),
    Object.freeze({ name:'medium', fps:30, dpr:1, scale:.8, fieldScale:.35 }),
    Object.freeze({ name:'low', fps:20, dpr:.75, scale:.65, fieldScale:.25 })
  ];
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const tasks = new Set(), listeners = new Set();
  let level = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 ? 1 : 0;
  let minimized = false;
  let load = 0, focused = document.hasFocus(), nativeFocused = null, raf = 0, timer = 0, due = 0, inputUntil = 0;
  let late = 0, healthySince = 0, revision = 0;
  const profile = () => profiles[Math.max(level, load >= 3 ? 1 : 0)];
  const visible = () => !document.hidden && !minimized;
  const reduced = () => mq.matches || root.dataset.motion === 'reduce';
  const syncDecoration = () => { const next=visible()&&focused?'running':'paused';if(root.style?.getPropertyValue('--decorative-play-state')!==next)root.style?.setProperty('--decorative-play-state',next); };
  const notify = () => { syncDecoration();revision++; for (const fn of listeners) fn(); };
  function cancel() { clearTimeout(timer); timer = 0; cancelAnimationFrame(raf); raf = 0; }
  function interval(task, now) { return 1000 / Math.min(task.fps, focused ? (now < inputUntil ? Math.min(30, profile().fps) : profile().fps) : 5); }
  function schedule() {
    if (timer || raf || !visible()) return;
    let next = Infinity;
    for (const t of tasks) if (t.active) next = Math.min(next, t.due);
    if (!Number.isFinite(next)) return;
    due = next;
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, Math.max(0, next - performance.now() - 4));
  }
  function frame(now) {
    raf = 0;
    if (!visible()) return;
    // Deadline lateness measures actual scheduling pressure, not the intentional 30/20 fps gaps.
    const delay = Math.max(0, now - due);
    if (focused && delay > 22) { healthySince = 0; if (++late >= 6 && level < 2) { level++; late = 0; notify(); } }
    else { late = Math.max(0, late - 1); if (!healthySince) healthySince = now; if (level && now - healthySince > 20000 && load < 3) { level--; healthySince = now; notify(); } }
    for (const t of tasks) {
      if (!t.active || now + 1 < t.due) continue;
      const step = interval(t, now);
      t.due = t.due > 0 && now - t.due < step ? t.due + step : now + step;
      if (!t.continuous) t.active = false;
      t.fn(now, profile());
    }
    schedule();
  }
  function wake() { cancel(); healthySince = 0; for (const t of tasks) t.due = 0; notify(); schedule(); }
  function add(fn, { fps = 60, continuous = true } = {}) {
    const task = { fn, fps, continuous, active:false, due:0 };
    tasks.add(task);
    return {
      start() { if (task.active) return; task.active = true; task.due = 0; schedule(); },
      setFps(fps) { if(!Number.isFinite(fps)||fps<=0)throw new RangeError("Invalid decorative frame rate");if(task.fps===fps)return;task.fps=fps;task.due=0;cancel();schedule(); },
      stop() { task.active = false; cancel(); schedule(); },
      request() { task.active = true; task.due = 0; schedule(); },
      dispose() { tasks.delete(task); cancel(); schedule(); }
    };
  }
  document.addEventListener('visibilitychange', wake);
  const focus = () => setTimeout(() => { const next=nativeFocused??document.hasFocus();if(next!==focused){focused=next;wake();} },0);
  addEventListener('blur', focus);addEventListener('focus', focus);
  const input = () => { inputUntil = performance.now() + 180; };
  for (const type of ['pointerdown','pointermove','keydown','wheel']) document.addEventListener(type, input, { passive:true, capture:true });
  mq.addEventListener('change', wake);
  new MutationObserver(wake).observe(root, { attributes:true, attributeFilter:['data-motion'] });
  syncDecoration();
  window.__renderBudget = {
    add, interaction:input, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setFocused(on) { nativeFocused=!!on;if(focused!==nativeFocused){focused=nativeFocused;wake();} },
    setMinimized(on) { if(minimized!==!!on){minimized=!!on;wake();} },
    setLoad(n) { const was = load >= 3; load = n; if (was !== (load >= 3)) wake(); },
    get profile() { return profile(); }, get visible() { return visible(); }, get focused() { return focused; },
    get reduced() { return reduced(); }, get revision() { return revision; },
    // Diagnostics are read-only and do not keep a sampling loop alive.
    state() { return { quality:profile().name, active:[...tasks].filter(t=>t.active).length, tasks:tasks.size, raf:!!raf, timer:!!timer, visible:visible(), focused, load, nextInMs:[...tasks].filter(t=>t.active).map(t=>t.due-performance.now()) }; }
  };
  addEventListener('pagehide', () => { cancel(); tasks.clear(); listeners.clear(); }, { once:true });
})();
