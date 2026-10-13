/* Welcome background: Caustics. Silver light from a rippled glass, as water throws it on a ceiling: a net of sharp
   lines with a soft halo, slow pools of light and a faint lavender/cyan dispersion at the edges (docs/BACKGROUNDS_SPEC.md). */
(() => {
  /* ===== shader ===== */
  const VERTEX = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
// three octaves only: more would break the lines into lightning
float fbm3(vec2 p){ float a = .5, s = 0.; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = m * p; a *= .5; } return s / .875; }
float ridge(vec2 p){ return 1. - abs(fbm3(p) * 2. - 1.); }

// x: the net of light (sharp), y: its wide halo
vec2 caustics(vec2 w, float t){
  float ra = ridge(w * .95 + vec2(t * .035, t * .02));
  float rb = ridge(w * 1.4 - vec2(t * .03, -t * .035) + 9.);
  float rc = ridge(w * 2.4 + vec2(t * .05, -t * .03) + 17.);
  float sharp = pow(ra, 18.) * .9 + pow(rb, 18.) * .6 + pow(ra * rb, 9.) * 1.1 + pow(rc, 24.) * .35 * (.4 + ra);
  return vec2(sharp, pow(ra, 4.) * .5 + pow(rb, 4.) * .35);
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 p = (fc - .5 * u_res) / u_res.y;
  float t = u_time;
  vec2 q = p * vec2(1., 1.45) + vec2(0., -.2);
  vec2 w = q + .5 * (vec2(fbm3(q * .55 + vec2(t * .05, 0.)), fbm3(q * .55 + vec2(3.1, -t * .045))) - .5);
  vec2 k = caustics(w, t);
  vec3 sharp = vec3(caustics(w - vec2(.005, 0.), t).x, k.x, caustics(w + vec2(.005, 0.), t).x);   // dispersion
  float pool = fbm3(p * .7 + vec2(-t * .02, t * .015));
  vec3 silver = vec3(.86, .87, .9);
  vec3 tint = mix(vec3(.64, .66, .86), vec3(.51, .71, .84), .5 + .5 * sin(p.x * 1.1 + t * .04));
  float light = smoothstep(-.95, .6, p.y) * (.5 + .5 * smoothstep(1.25, .1, abs(p.x))) * (.55 + .7 * pool);
  vec3 col = vec3(.012, .012, .011);
  col += silver * sharp * .5 * light;
  col += mix(silver, tint, .6) * k.y * .06 * light;
  vec2 top = p - vec2(0., .6);
  col += vec3(.7, .72, .8) * .045 * exp(-dot(top, top) * 2.);
  col *= smoothstep(1.35, .2, length(p * vec2(.8, 1.)));
  col = 1. - exp(-col * 1.35);
  float n = hash(fc + fract(t * 7.13) * 311.) + hash(fc + 57.3 + fract(t * 3.71) * 173.) - 1.;
  col += n * .03 * (.35 + .65 * dot(col, vec3(.33)));   // grain, stronger in the midtones
  col += n / 255.;                                       // dither against banding
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}`;
  const BASE = [3 / 255, 3 / 255, 3 / 255];
  const STILL = 18;          // the frame shown with reduced motion (seconds)
  const MAX_PIXELS = 1_400_000;

  /* ===== lifecycle ===== */
  // Starts the background on Welcome's canvas; returns the function that stops it and frees the GPU.
  window.__welcomeBackground = canvas => {
    const budget = window.__renderBudget, motion = window.__motion;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const still = () => motion.reduced();
    const before = canvas.style.background;
    canvas.style.background = 'var(--welcome-surface-low)';
    let gl = null, program = null, buffer = null, uRes = null, uTime = null;
    let stopped = false, lost = false, onScreen = true, dirty = true;

    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 1.5, budget.profile.dpr) * budget.profile.scale;
      let w = Math.max(1, Math.floor(box.width * ratio)), h = Math.max(1, Math.floor(box.height * ratio));
      if (w * h > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * h)); w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k)); }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    };
    const draw = now => {
      if (stopped || lost || !program) return;
      if (dirty || motion.busy()) { fit(); dirty = false; }
      gl.useProgram(program);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, still() ? STILL : now / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const runnable = () => !stopped && !lost && onScreen && budget.visible && program;
    const task = budget.add(now => {
      if (!runnable()) { task.stop(); return; }
      draw(now);
      if (still()) task.stop();
    }, { fps: 30 });
    const refresh = () => { task.stop(); dirty = true; if (runnable()) task.start(); };
    const unsubscribe = budget.subscribe(refresh);

    const release = () => {
      if (!gl) return;
      if (program) { gl.useProgram(null); gl.deleteProgram(program); }
      if (buffer) gl.deleteBuffer(buffer);
      program = buffer = null;
    };
    const start = () => {
      gl = gl || canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) return;
      const shaders = [];
      try {
        const p = gl.createProgram();
        for (const [type, text] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
          const s = gl.createShader(type); shaders.push(s);
          gl.shaderSource(s, text); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(p, s);
        }
        gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); throw Error(gl.getProgramInfoLog(p)); }
        program = p;
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        uRes = gl.getUniformLocation(program, 'u_res'); uTime = gl.getUniformLocation(program, 'u_time');
      } catch (error) {
        console.warn('Welcome background', error);
        release();
        // Without the shader Welcome keeps a plain dark surface
        if (!gl.isContextLost()) { gl.clearColor(...BASE, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      } finally {
        shaders.forEach(s => gl.deleteShader(s));
      }
      refresh();
    };

    const onLost = event => { event.preventDefault(); lost = true; task.stop(); };
    const onRestored = () => { lost = false; release(); start(); };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const sized = new ResizeObserver(refresh); sized.observe(canvas);
    const seen = new IntersectionObserver(([e]) => { onScreen = Boolean(e?.isIntersecting); refresh(); }, { threshold: .01 });
    seen.observe(canvas);
    const motionAttr = new MutationObserver(refresh);
    motionAttr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    mq.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    start();

    return () => {
      stopped = true; task.dispose(); unsubscribe();
      sized.disconnect(); seen.disconnect(); motionAttr.disconnect();
      mq.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      release();
      canvas.width = canvas.height = 1;
      canvas.style.background = before;
    };
  };
})();
