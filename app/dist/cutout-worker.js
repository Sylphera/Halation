// Cutout's model, SAM 2.1 Base+, run by ONNX Runtime Web (onnxruntime.js) in a module worker so the window never
// waits on it. The main window (services.js, cutout section) first asks which backend this PC has ("probe"), sends
// the runtime's WebAssembly and the decoder for that backend ("init"), the encoder only when a picture has to be
// encoded ("encoder"), then:
//   "encode" a picture already scaled to 1024 × 1024 (RGBA bytes) → an id and a copy of its features (the main window
//            keeps them); the features stay here (the last few)
//   "adopt"  features encoded earlier (by an engine that went idle) → an id, without encoding again
//   "decode" the id and prompts (points in the 1024 input, labels 1 subject / 0 background / -1 padding, the last
//            answer's logits) → the 256 × 256 mask logits of each prompt and the model's scores
// On a GPU (WebGPU) both graphs run there, the encoder in half precision when the GPU has it; otherwise on the CPU,
// in one thread (the window is not cross-origin isolated, so WebAssembly threads are not available).
import * as ort from "./onnxruntime.js";

let enc = null, dec = null, cfg = null, backend = "", seq = 0, sessionOpts = null;
const feats = new Map();   // id → { image_embed, high_res_feats_0, high_res_feats_1 } (float32 tensors on the CPU)
const KEEP = 3;
// Only this worker assembles large models; no full model buffer visits the main thread.
const files = new Map();
function fileChunk({ key, bytes, offset, done }) {
  if (!["wasm", "decoder", "encoder"].includes(key)) throw new Error("unknown model file");
  if (offset === 0) files.set(key, { parts: [], length: 0, done: false });
  const file = files.get(key);
  if (!file || file.done || file.length !== offset) throw new Error("invalid model chunk order");
  file.parts.push(new Uint8Array(bytes)); file.length += bytes.byteLength; file.done = done;
  return { bytes: file.length };
}
function takeFile(key) {
  const file = files.get(key);
  if (!file?.done) throw new Error("incomplete model file");
  const bytes = new Uint8Array(file.length); let offset = 0;
  for (const part of file.parts) { bytes.set(part, offset); offset += part.length; }
  files.delete(key); return bytes.buffer;
}

// WebGPU only when an adapter answers: navigator.gpu alone exists on machines without a usable GPU
async function probe({ gpu }) {
  const a = gpu !== false && self.navigator.gpu ? await self.navigator.gpu.requestAdapter().catch(() => null) : null;
  return { gpu: !!a, f16: !!(a && a.features.has("shader-f16")) };
}
// backend "webgpu" | "wasm". On the CPU the graphs are left as exported: ONNX Runtime's graph optimisations make
// the 1024 px encoder outgrow the 4 GB WebAssembly heap.
async function init({ config, backend: want }) {
  const wasm = takeFile("wasm"), decoder = takeFile("decoder");
  cfg = config;
  ort.env.wasm.wasmBinary = new Uint8Array(wasm);
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
  ort.env.wasm.proxy = false;
  const opts = want === "webgpu"
    ? { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }
    : { executionProviders: ["wasm"], graphOptimizationLevel: "disabled", enableCpuMemArena: false, enableMemPattern: false };
  for (const s of [enc, dec]) if (s) await s.release().catch(() => {});
  feats.clear(); enc = null;
  dec = await ort.InferenceSession.create(new Uint8Array(decoder), opts);
  backend = want; sessionOpts = opts;
  return { backend, inputs: dec.inputNames, outputs: dec.outputNames };
}
async function encoder() {
  const bytes = takeFile("encoder");
  if (enc) await enc.release().catch(() => {});
  enc = await ort.InferenceSession.create(new Uint8Array(bytes), sessionOpts);
  return { inputs: enc.inputNames, outputs: enc.outputNames };
}
const FEATS = ["image_embed", "high_res_feats_0", "high_res_feats_1"];
function keep(f) {
  const id = ++seq;
  feats.set(id, f);
  while (feats.size > KEEP) feats.delete(feats.keys().next().value);
  return id;
}
// RGBA bytes (size × size) → the encoder's input: [1, 3, size, size], 0–1, then normalised with the model's mean
// and deviation
function input(rgba, n) {
  const px = n * n, out = new Float32Array(3 * px);
  for (let c = 0; c < 3; c++) {
    const m = cfg.mean[c], s = cfg.std[c];
    for (let i = 0; i < px; i++) out[c * px + i] = (rgba[i * 4 + c] / 255 - m) / s;
  }
  return out;
}
async function encode({ rgba }) {
  if (!enc) throw new Error("no encoder");
  const n = cfg.size, t0 = performance.now();
  const res = await enc.run({ [enc.inputNames[0]]: new ort.Tensor("float32", input(new Uint8ClampedArray(rgba), n), [1, 3, n, n]) });
  const f = {};
  // the decoder takes them as CPU tensors (WebGPU's outputs are read back once; each click uploads them again)
  for (const k of FEATS) { const v = res[k]; f[k] = new ort.Tensor("float32", v.data.slice(), v.dims); }
  for (const v of Object.values(res)) if (v.dispose) v.dispose();
  const copy = FEATS.map(k => ({ data: f[k].data.slice().buffer, dims: f[k].dims }));
  return { id: keep(f), ms: Math.round(performance.now() - t0), backend, feats: copy };
}
function adopt({ feats: list }) {
  const f = {};
  FEATS.forEach((k, i) => { f[k] = new ort.Tensor("float32", new Float32Array(list[i].data), list[i].dims); });
  return { id: keep(f) };
}
// prompts: coords Float32Array [b·n·2], labels Float32Array [b·n], mask Float32Array [b·256·256] or null
async function decode({ id, b, n, coords, labels, mask }) {
  const f = feats.get(id);
  if (!f) throw new Error("gone");
  const t0 = performance.now(), m = 256 * 256;
  const res = await dec.run({
    ...f,
    point_coords: new ort.Tensor("float32", new Float32Array(coords), [b, n, 2]),
    point_labels: new ort.Tensor("float32", new Float32Array(labels), [b, n]),
    mask_input: new ort.Tensor("float32", mask ? new Float32Array(mask) : new Float32Array(b * m), [b, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", new Float32Array(b).fill(mask ? 1 : 0), [b])
  });
  const out = { masks: Float32Array.from(res.masks.data).buffer, iou: Array.from(res.iou_predictions.data), obj: Array.from(res.object_score_logits.data), ms: 0, backend };
  for (const v of Object.values(res)) if (v.dispose) v.dispose();
  out.ms = Math.round(performance.now() - t0);
  return out;
}

self.onmessage = async e => {
  const { id, type, data } = e.data;
  try {
    const out = type === "file" ? fileChunk(data) : type === "probe" ? await probe(data) : type === "init" ? await init(data) : type === "encoder" ? await encoder(data)
      : type === "encode" ? await encode(data) : type === "adopt" ? adopt(data)
      : type === "decode" ? await decode(data) : type === "forget" ? (feats.delete(data.id), {}) : null;
    if (!out) throw new Error("unknown " + type);
    self.postMessage({ id, ok: true, out }, out.masks ? [out.masks] : out.feats ? out.feats.map(f => f.data) : []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
