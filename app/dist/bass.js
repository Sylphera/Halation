// Bass analysis for the Visualizer: the low-passed loudness of a song sampled RATE times a
// second (bassRaw, slow, once per song and cutoff) and the envelope that follows it (bassEnv, fast, per setting).
const RATE = 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function bassRaw(buf, cutoff, rate = RATE) {
  const sr = buf.sampleRate, oac = new OfflineAudioContext(1, buf.length, sr);
  const src = oac.createBufferSource(); src.buffer = buf;
  const f1 = oac.createBiquadFilter(), f2 = oac.createBiquadFilter();
  f1.type = f2.type = "lowpass"; f1.frequency.value = f2.frequency.value = cutoff; f1.Q.value = f2.Q.value = 0.707;
  src.connect(f1); f1.connect(f2); f2.connect(oac.destination); src.start();
  const out = await oac.startRendering();
  const d = out.getChannelData(0), hop = Math.round(sr / rate), n = Math.ceil(d.length / hop);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; const a = i * hop, b = Math.min(d.length, a + hop);
    for (let j = a; j < b; j++) s += d[j] * d[j];
    raw[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  const sorted = Float32Array.from(raw).sort();
  return { raw, p: sorted[Math.floor(sorted.length * 0.97)] || 1e-6 };
}
// P: { sensitivity, threshold (0-100), attack, release (ms) }
function bassEnv(raw, p, P, rate = RATE) {
  const n = raw.length, env = new Float32Array(n);   // always a new array: a running export keeps the old one
  const sens = P.sensitivity / 100, thr = P.threshold / 100, dt = 1 / rate;
  const a = P.attack <= 0 ? 0 : Math.exp(-dt / (P.attack / 1000));
  const r = Math.exp(-dt / (P.release / 1000));
  let e = 0;
  for (let i = 0; i < n; i++) {
    let v = raw[i] / p * sens;
    v = clamp((v - thr) / Math.max(0.05, 1 - thr), 0, 1.4);
    e = v > e ? a * e + (1 - a) * v : r * e + (1 - r) * v;
    env[i] = e;
  }
  return env;
}

export { RATE, bassEnv, bassRaw };
