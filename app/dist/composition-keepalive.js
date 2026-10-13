/* Keep the visible static shell out of Chromium/Windows' idle composition path.
   Four physical corner pixels alternate by one level; this is not UI motion. */
(() => {
  const PERIOD = 200; // 5 Hz: lowest cadence confirmed by the native-window review.
  const layer = document.createElement('canvas');
  layer.id = 'composition-keepalive'; layer.width = layer.height = 2;
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;right:0;bottom:0;z-index:2147483647;pointer-events:none';
  const context = layer.getContext('2d', { alpha: false });
  if (!context) return;
  let timer = 0, writes = 0, active = false, pageHidden = false;
  const host = document.querySelector('.auralis-host'), welcome = document.querySelector('#welcome');
  const hasLiveScene = () => {
    // Home's CSS mark and animated Auralis already keep composition active.
    if (window.__atmo?.current === 'home' && host?.querySelector('canvas') && !window.__renderBudget.reduced) return true;
    // Welcome's own field is live except with reduced motion.
    return !!welcome?.open && !window.__motion.reduced();
  };
  const needed = () => !pageHidden && window.__renderBudget.visible && window.__renderBudget.focused && !hasLiveScene();
  const destination = () => {
    const fullscreen = document.fullscreenElement;
    return fullscreen?.tagName === 'IFRAME'
      ? fullscreen.contentDocument?.fullscreenElement || fullscreen.contentDocument?.body || document.body
      : fullscreen || document.body;
  };
  const paint = () => {
    if (!needed()) { sync(); return; }
    const surface = destination();
    if (layer.parentElement !== surface) surface.append(layer);
    const value = 9 + (writes % 2);
    context.fillStyle = 'rgb(' + value + ',' + value + ',' + value + ')';
    context.fillRect(0, 0, 2, 2); writes++;
    timer = setTimeout(paint, PERIOD);
  };
  function sync() {
    const next = needed();
    if (next === active) return;
    active = next;
    if (next) { destination().append(layer); paint(); }
    else { clearTimeout(timer); timer = 0; layer.remove(); }
  }
  const size = () => { layer.style.width = layer.style.height = 2 / devicePixelRatio + 'px'; };
  size(); addEventListener('resize', size);
  document.addEventListener('visibilitychange', sync);
  window.__renderBudget.subscribe(sync);
  const observers = [];
  const watch = (element, options) => {
    if (!element) return;
    const observer = new MutationObserver(sync); observer.observe(element, options); observers.push(observer);
  };
  watch(host, { attributes: true, attributeFilter: ['data-mode','data-rest'], childList: true, subtree: true });
  watch(welcome, { attributes: true, attributeFilter: ['open'] });
  watch(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'); reduced.addEventListener('change', sync);
  addEventListener('pagehide', () => { pageHidden = true; sync(); });
  addEventListener('pageshow', () => { pageHidden = false; sync(); });
  // Review-only counters; no persistent preference or product control.
  if (window.__halVisualTest) window.__compositionKeepalive = {
    get periodMs() { return PERIOD; }, get active() { return active; }, get writes() { return writes; }
  };
  sync();
})();
