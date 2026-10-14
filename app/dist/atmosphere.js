// The window's background (formerly a React bundle; now plain script). Three parts: the navigation refraction shared by
// both backgrounds, the tool/page atmosphere (a worker-driven canvas under the tools) and the mount: Home's Drape
// (drape.js) in its isolated host, window.__atmo, and the review hooks used by the visual tests.
// Needs soft-light.js (window.__softLightGLSL), render-budget.js, blue-noise.js and drape.js before it.
(() => {
"use strict";

/* ===== navigation refraction ===== */
// One radial impact creates a continuous damped wave packet; the scene supplies all visible light.
const NAVIGATION_REFRACTION_GLSL = `
vec2 navigationDisplacement(vec2 p, float phase, float extent) {
  if (phase <= 0.0 || phase >= 1.4) return vec2(0.0);
  float distance = length(p);
  float front = extent * phase;
  float wavelength = extent * 0.20;
  float wake = (front - distance) / wavelength;
  // One travelling, damped oscillation packet: three crests in the same continuous field.
  float packet = smoothstep(0.0, 0.22, wake) * (1.0 - smoothstep(2.4, 3.0, wake));
  float impact = smoothstep(0.0, 0.10, phase) * (1.0 - smoothstep(1.05, 1.4, phase));
  float oscillation = sin(6.2831853 * wake) * exp(-0.65 * max(wake, 0.0));
  float strength = 0.04 * packet * impact * exp(-0.9 * distance);
  float core = smoothstep(0.0, 0.035, distance);
  return p / max(distance, 0.0001) * oscillation * strength * core;
}
vec2 navigationRefraction(vec2 p, vec2 phases, float extent) {
  vec2 displacement = navigationDisplacement(p, phases.x, extent);
  // A new navigation keeps the prior impact briefly while the new drop builds from zero.
  displacement += navigationDisplacement(p, phases.y, extent) * (1.0 - smoothstep(0.0, 0.16, phases.x));
  return p + displacement;
}
`;

// The Drape scene keeps its clock, grain, coverage and approved canvas transform.
// The packet keeps its 1100 ms travel rate, with a short, diminishing oscillatory tail.
function bindNavigationRefraction(api, drape) {
  const trigger = api.navigationWave.bind(api);
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => mq.matches || document.documentElement.dataset.motion === 'reduce';
  let at = 0, previousAt = 0, raf = 0;
  // the phases go to Drape's presentation pass (drape.js), which draws at 60 Hz while the packet travels
  const write = (phase, previousPhase = -1) => { if (drape) drape.wave(phase, previousPhase); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; write(0); };
  const frame = now => {
    const phase = (now - at) / 1100;
    if (still() || document.hidden || phase >= 1.4) { stop(); return; }
    write(phase, previousAt ? (now - previousAt) / 1100 : -1);
    raf = requestAnimationFrame(frame);
  };
  api.navigationWave = () => {
    if (still()) return;
    trigger();
    previousAt = at;
    at = performance.now();
    write(0, previousAt ? (at - previousAt) / 1100 : -1);
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const release = () => { if (still() || document.hidden) stop(); };
  new MutationObserver(release).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  mq.addEventListener('change', release);
  document.addEventListener('visibilitychange', release);
}

/* ===== tool atmosphere ===== */
// Tools share Welcome's quiet light field, held still. Drape owns Home.
// Keep the existing mode spring, worker, scales and cadence.
function startToolAtmosphere(onPhase) {
"use strict";

/* ===== shaders ===== */
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
// Each background is a function of the pixel; "mix" draws both while one gives way to the other (m: 0 Home, 1 tool):
// Home recedes while the quiet tool field comes up.
const FN = {
  // Same base as Welcome, without its animated mass or drift
  tool: window.__softLightGLSL + `vec3 tool(vec2 fc,float m){
  vec2 p=(fc-.5*r)/r.y;
  return softLight(p,0.,0.,1.)+softGrain(fc);
}`
};
const PAGE = `vec3 page(vec2 fc,float m){
  vec2 uv=(fc-.5*r)/r.y;
  float T=t*.008;
  vec2 c1=vec2(.08*sin(T),.62+.03*cos(T*1.3)+.25*(1.-m));
  vec2 c2=vec2(.06*cos(T*.7),.7+.25*(1.-m));
  float a=exp(-2.1*length((uv-c1)*vec2(.7,1.6)));
  float b=exp(-2.9*length((uv-c2)*vec2(.8,1.8)));
  float s=a*.06+b*.0315;
  return s*mix(vec3(1.),tint,.6)+vec3(.0225,.0225,.0218);
}`;
const HEAD = `precision highp float;uniform vec2 r;uniform float t;uniform vec3 tint;uniform vec3 v;uniform float m;uniform vec2 wave;
${NAVIGATION_REFRACTION_GLSL}
vec2 composed(vec2 fc){
  vec2 p=(fc-.5*r)/r.y;
  float extent=length(vec2(r.x/r.y,1.)*.5)+.12;
  return .5*r+navigationRefraction(p,wave,extent)*r.y;
}`;
const FS = {
  page: HEAD + PAGE + "void main(){gl_FragColor=vec4(page(composed(gl_FragCoord.xy),1.),1.);}",
  mixPage: HEAD + PAGE + "void main(){float k=m*m*(3.-2.*m);vec2 fc=composed(gl_FragCoord.xy);gl_FragColor=vec4(page(fc,k)*smoothstep(.25,1.,k),1.);}",
  home: HEAD + "void main(){gl_FragColor=vec4(0.,0.,0.,1.);}",
  tool: HEAD + FN.tool + "void main(){gl_FragColor=vec4(tool(composed(gl_FragCoord.xy),1.),1.);}",
  // the silk dims faster than the haze comes up, so the middle of the change is darker than either end, never grey
  mix: HEAD + FN.tool + "void main(){float k=m*m*(3.-2.*m);vec2 fc=composed(gl_FragCoord.xy);gl_FragColor=vec4(tool(fc,k)*smoothstep(.25,1.,k),1.);}"
};
const FPS = { home: 30, tool: 10, page: 10, mix: 60, mixPage: 60 }, SCALE = { home: 0.6, tool: 1, page: 0.35, mix: 1, mixPage: 0.6 };

/* ===== renderer ===== */
// Runs in the worker (or, without OffscreenCanvas, on the page): a canvas, the programs and the frame loop.
// set({ mode, still, visible, w, h, tint, dur }) changes what it draws; w and h are the window's size, drawn at the
// mode's scale. A change of mode is a move of m (0 Home, 1 tool) on the interface's spring (motion.js: critically
// damped, over dur ms; interrupted, it goes back from where it is with its speed); meanwhile it draws "mix".
function renderer(canvas, FS, VS, FPS, SCALE, onDraw, debug = false) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  const st = { mode: "home", field: "tool", dpr: 1, still: false, visible: true, w: 1, h: 1, tint: [0.73, 0.78, 0.9], variant: [0, 1, 1, 40], dur: 300 };
  let waveAt = -Infinity;
  let previousWaveAt = -Infinity;
  const waveLive = now => !st.still && now-waveAt>=0 && now-waveAt<1540;
  // the change between the two: from, to, when it started, its speed at the start (in distances per duration)
  const W = 9.23, sp = (x, v0) => x >= 1 ? 1 : 1 - (1 + (W - v0) * x) * Math.exp(-W * x);
  let mv = { from: 0, to: 0, at: 0, v0: 0 };
  const mAt = now => { const x = (now - mv.at) / st.dur; return x >= 1 ? mv.to : x <= 0 ? mv.from : mv.from + (mv.to - mv.from) * sp(x, mv.v0); };
  const moving = now => now - mv.at < st.dur && mv.from !== mv.to;
  const drawn = now => moving(now) ? (st.field === "page" ? "mixPage" : "mix") : st.mode;
  function retarget(to, now) {
    const m0 = mAt(now), h = 8, m1 = mAt(now + h);
    const speed = moving(now) ? (m1 - m0) / h : 0;   // per ms
    const d = to - m0;
    mv = { from: m0, to, at: now, v0: d && speed ? Math.max(-8, Math.min(24, speed * st.dur / d)) : 0 };
  }
  const progs = {};
  let t0 = performance.now() - 40000;   // start where the folds already cross the window (variant[3] seconds in)
  const tick = typeof requestAnimationFrame === "function" ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
  let loop = false, last = 0, frozen = 0, held = 0, fading = false, manual = false, lastDraw = null, reviewAt = 0;
  const clock = () => manual ? reviewAt : performance.now();
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  function compile(fs) {
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    return { p, r: gl.getUniformLocation(p, "r"), t: gl.getUniformLocation(p, "t"), tint: gl.getUniformLocation(p, "tint"), v: gl.getUniformLocation(p, "v"), m: gl.getUniformLocation(p, "m"), wave: gl.getUniformLocation(p, "wave") };
  }
  // now: the time of the picture (a still picture keeps its own); at: the time of the change between modes
  function draw(now, at = now) {
    const k = drawn(at), g = progs[k] || (progs[k] = compile(FS[k]));
    if (!g) return;
    const pixelScale = SCALE[k] * (k === "tool" || k === "mix" ? st.dpr : 1);
    const w = Math.max(1, Math.round(st.w * pixelScale)), h = Math.max(1, Math.round(st.h * pixelScale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(g.p);
    gl.uniform2f(g.r, w, h);
    gl.uniform1f(g.m, mAt(at));
    const waveTime = waveLive(at) ? (at-waveAt)/1000 : 0;
    gl.uniform2f(g.wave, waveTime / 1.1, !st.still && Number.isFinite(previousWaveAt) ? (at - previousWaveAt) / 1100 : -1);
    gl.uniform1f(g.t, (now - t0) / 1000);
    gl.uniform3fv(g.tint, st.tint);
    gl.uniform3f(g.v, st.variant[0], st.variant[1], st.variant[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (debug) lastDraw = { mode: k, cssWidth: st.w, cssHeight: st.h, width: w, height: h,
      bufferWidth: gl.drawingBufferWidth, bufferHeight: gl.drawingBufferHeight, viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
      scale: SCALE[k], time: (now - t0) / 1000, at, mix: mAt(at), wave: waveTime, tint: st.tint.slice(), variant: st.variant.slice() };
    if (onDraw) onDraw(canvas, mAt(at));
  }
  function frame(now) {
    if (!st.visible || st.still || manual) { loop = false; return; }
    tick(frame);
    if (now - last < 1000 / (waveLive(now) ? 60 : FPS[drawn(now)]) - 2) return;
    last = now; draw(now);
  }
  return {
    scene() { return lastDraw && { ...lastDraw }; },
    renderAt(scene) { const time=typeof scene==='number'?scene:scene.time,at=typeof scene==='number'?lastDraw.at:scene.at;manual = true;reviewAt=at;if(typeof scene==='object'&&scene.wave!==undefined)waveAt=scene.wave>0?at-scene.wave*1000:-Infinity; draw(t0 + time * 1000, at); return { ...lastDraw }; },
    set(o) {
      const now = clock(), changed = o.mode !== undefined && o.mode !== st.mode;
      const redraw = changed || o.w !== undefined && (o.w !== st.w || o.h !== st.h);
      if (o.variant) t0 = now - o.variant[3] * 1000;
      if (o.mode && o.mode !== "home") st.field = o.mode;
      Object.assign(st, o);
      if (o.wave && !st.still) { previousWaveAt = waveAt; waveAt = now; }
      // a change moves m (hidden: at once)
      if (changed) { const to = o.mode === "home" ? 0 : 1; if (!st.visible) mv = { from: to, to, at: 0, v0: 0 }; else retarget(to, now); }
      if (!st.visible) return;
      // a still frame is drawn again once a second: a canvas handed to a worker can drop its only frame when the
      // layers around it change (the grain), and one frame a second of a still picture costs nothing. With reduced
      // motion a change of mode is a short fade over the still picture.
      if (st.still) {
        if (!frozen) frozen = now;
        draw(frozen, now);
        if (changed && !fading) { fading = true; const step = () => { const n = performance.now(); draw(frozen, n); if (moving(n)) tick(step); else { fading = false; draw(frozen, n); } }; tick(step); }
        if (!held) held = setInterval(() => st.still && st.visible ? draw(frozen, performance.now()) : (clearInterval(held), held = 0), 1000);
        return;
      }
      frozen = 0;
      if (redraw) { last = 0; draw(clock()); }
      if (!loop) { loop = true; tick(frame); }
    }
  };
}

/* ===== clean tool page host ===== */

const canvas=document.createElement("canvas");canvas.className="atmo tool-atmo";canvas.setAttribute("aria-hidden","true");document.body.prepend(canvas);
let mode="home",send=null,atmoScene=null,atmoSceneAt=null;
function tint(){const c=getComputedStyle(document.documentElement).getPropertyValue("--atmo").trim().replace("#","");const n=parseInt(c.length===3?c.replace(/./g,"$&$&"):c,16);return isNaN(n)?[.73,.78,.9]:[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];}
const VARIANT=[0,1,1,40];
const still=()=>matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.dataset.motion==="reduce";
const size=()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio});
const dur=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue(still()?"--fade":"--place"))||300;
try{
 if(canvas.transferControlToOffscreen&&typeof Worker==="function"){
  const off=canvas.transferControlToOffscreen();
  const src="const renderer="+renderer+";let r=null;onmessage=e=>{const d=e.data;if(d.canvas){r=renderer(d.canvas,"+JSON.stringify(FS)+","+JSON.stringify(VS)+","+JSON.stringify(FPS)+","+JSON.stringify(SCALE)+",(c,m)=>postMessage({phase:m}),d.debug);postMessage({ready:true,atmo:!!r});}if(r&&d.set)r.set(d.set);if(d.scene&&r)postMessage({id:d.id,scene:r.scene()});if(d.sceneAt!==undefined&&r)postMessage({id:d.id,scene:r.renderAt(d.sceneAt)});};";
  const url=URL.createObjectURL(new Blob([src],{type:"text/javascript"})),worker=new Worker(url),pending=new Map();let serial=0;
  worker.onmessage=e=>{const d=e.data;if(d.phase!==undefined){onPhase(d.phase);return;}if(d.ready){if(!d.atmo)canvas.hidden=true;URL.revokeObjectURL(url);}else{const done=pending.get(d.id);if(done){pending.delete(d.id);done(d);}}};
  worker.postMessage({canvas:off,debug:!!window.__halVisualTest},[off]);
  const request=o=>new Promise(resolve=>{const id=++serial;pending.set(id,resolve);worker.postMessage({...o,id});});
  atmoScene=()=>request({scene:true}).then(d=>d.scene);atmoSceneAt=sceneAt=>request({sceneAt}).then(d=>d.scene);send=o=>worker.postMessage({set:o});
 }else{
  const r=renderer(canvas,FS,VS,FPS,SCALE,(c,m)=>onPhase(m),!!window.__halVisualTest);
  if(r){send=o=>r.set(o);atmoScene=()=>Promise.resolve(r.scene());atmoSceneAt=t=>Promise.resolve(r.renderAt(t));}else canvas.hidden=true;
 }
}catch(e){console.warn("tool atmosphere",e);canvas.hidden=true;}
if(send){
 document.addEventListener("visibilitychange",()=>send({visible:!document.hidden}));addEventListener("resize",()=>send(size()));
 new MutationObserver(()=>send({still:still(),dur:dur()})).observe(document.documentElement,{attributes:true,attributeFilter:["data-motion"]});
 matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change",()=>send({still:still(),dur:dur()}));
}
const api={navigationWave(){if(send&&!still())send({wave:true});},mode(m){if(!FS[m]||m===mode)return;mode=m;canvas.dataset.mode=m;if(send)send({mode});},get current(){return mode;},get variant(){return VARIANT.slice();}};
if(window.__halVisualTest)api.review={scene:()=>atmoScene(),sceneAt:t=>atmoSceneAt(t)};
canvas.dataset.mode=mode;if(send)send({mode,still:still(),visible:!document.hidden,tint:tint(),variant:VARIANT,dur:dur(),...size()});
return api;
}

/* ===== mount ===== */
// Isolated host: navigation refracts the scene locally, outside the approved canvas transform. The surface holds the
// canvas and the .drape-wave proxy whose scale (motion.js backgroundWave) Drape reads; neither is transformed.
const host = document.createElement("div");
host.className = "atmo drape-host";
host.setAttribute("aria-hidden", "true");
const surface = document.createElement("div");
surface.className = "drape-surface";
host.append(surface);
document.body.prepend(host);
let drape = null;
try { drape = window.__drape ? window.__drape.create(surface, { refraction: NAVIGATION_REFRACTION_GLSL }) : null; }
catch (e) { console.warn("Drape", e); }

let mode = "home";
const tool = startToolAtmosphere(m => {
  // Original background mode spring and envelopes. No new navigation motion.
  const k = m * m * (3 - 2 * m);
  host.style.opacity = String(Math.pow(Math.max(0, 1 - k), 1.6));
  host.style.transform = `scale(${1 + .14 * k})`;
  host.style.visibility = m === 1 ? "hidden" : "visible";
  host.dataset.rest = m === 1 ? "tool" : m === 0 ? "home" : "mix";
});
// Home source below the additive tool layer, grain above both, all below the unchanged UI.
document.body.prepend(host);
window.__atmo = {
  mode(next) {
    if (next !== "home" && next !== "tool" && next !== "page") return;
    mode = next;
    host.dataset.mode = next;
    tool.mode(next);
  },
  navigationWave() { tool.navigationWave(); },
  get current() { return mode; },
  get variant() { return tool.variant; },
  toolReview: tool.review,
};
host.dataset.mode = mode;
bindNavigationRefraction(window.__atmo, drape);

// Review-only inspection and controlled draw (visual tests); no product control.
if (window.__halVisualTest && drape) {
  const scene = () => { const s = drape.scene(); return s && { ...s, mode }; };
  window.__atmo.review = { scene, sceneAt(value) { drape.sceneAt(value || {}); return scene(); } };
}
})();
