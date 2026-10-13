// Runs inside the real app (debug build, HALATION_SELFTEST) to drive encode.rs through the real IPC:
// whole frames, rectangles, repeated frames, audio, cancel, free space and export folders.
// The result goes to Settings\app.json (key "selftest"); tests/realapp.py checks it and the files with ffprobe.
(async () => {
  const H = window.__hal;
  await H.ready;
  const E = window.__halEncoder, out = { files: {}, errors: [] };
  const W = 64, Hh = 48, N = 10;
  // frame k: a colour ramp whose alpha fades from left to right; odd frames are sent as a 32×24 rectangle
  const frame = k => { const d = new Uint8Array(W * Hh * 4); for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; d[i] = 255; d[i + 1] = k * 20; d[i + 2] = y * 5; d[i + 3] = Math.round(x / (W - 1) * 255); } return d; };
  const rectOf = k => { const d = new Uint8Array(32 * 24 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = 20; d[i + 1] = 200; d[i + 2] = k * 20; d[i + 3] = 255; } return d; };
  try {
    const dir = await E.folder("selftest - layers");
    out.dir = dir;
    for (const f of ["prores4444", "webm", "h264", "png"]) {
      const enc = await E.open(f, { file: E.join(dir, f), width: W, height: Hh, fps: 30 });
      for (let k = 0; k < N; k++) {
        if (k === 4) await enc.same();                       // frame 4 repeats frame 3
        else if (k % 2) await enc.write(rectOf(k), { x: 16, y: 12, w: 32, h: 24 });
        else await enc.write(frame(k));
      }
      out.files[f] = await enc.finish();
    }
    const wav = await E.open("wav", { file: E.join(dir, "audio"), input: { audio: true, rate: 48000, channels: 2 } });
    const s = new Float32Array(48000); for (let i = 0; i < s.length; i++) s[i] = Math.sin(i / 20) * 0.5;
    await wav.write(new Uint8Array(s.buffer));
    out.files.wav = await wav.finish();
    // cancel: the partial file disappears
    const c = await E.open("prores4444", { file: E.join(dir, "cancelled"), width: W, height: Hh, fps: 30 });
    await c.write(frame(0)); await c.abort();
    out.cancelledPath = c.path;
    // a bad rectangle is refused with a message
    const b = await E.open("h264", { file: E.join(dir, "bad"), width: W, height: Hh, fps: 30 });
    try { await b.write(new Uint8Array(16), { x: 60, y: 0, w: 8, h: 1 }); out.errors.push("bad rectangle accepted"); } catch (e) { out.badRect = String(e.message || e); }
    await b.abort();
    out.free = await E.freeSpace();
    const tmp = await E.folder("selftest - removed");
    out.removed = await E.removeFolder(tmp);
    out.removedPath = tmp;
  } catch (e) { out.errors.push(String(e && e.message || e)); }
  await H.invoke("state_set", { key: "selftest", value: out });
})();
