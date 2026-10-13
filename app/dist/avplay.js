// The sound of a video in the previews (Frame Capture, AI Interpolate): its audio track decoded by the page
// (Mediabunny on WebCodecs), read in ranges like the picture and never whole, played through Web Audio. The preview's
// picture follows the sound's clock, so both stay together however long it plays.
//   const a = await openAudio(MB, input)   the video's Mediabunny Input; null when it has no sound the page can play
//   const clock = await a.start(t, rate=1)  plays from t (seconds of the video); clock() → the video's time now
//   a.stop()                                a short fade, then silence (stop(true): at once)
//   a.volume(v), a.mute(on), a.close()
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AHEAD = 1.5;   // seconds of sound decoded ahead of what is heard
const FADE = 0.18;   // seconds of the fade when it stops

export async function openAudio(MB, input) {
  let track = null;
  try { track = await input.getPrimaryAudioTrack(); if (!track || !(await track.canDecode())) return null; }
  catch (e) { return null; }
  const sink = new MB.AudioBufferSink(track), first = await track.getFirstTimestamp().catch(() => 0);
  let ac = null, out = null, run = null, level = 1, muted = false;
  const target = () => (muted ? 0 : level);
  function context() {
    if (!ac) { ac = new AudioContext({ latencyHint: "playback" }); out = ac.createGain(); out.connect(ac.destination); }
    out.gain.cancelScheduledValues(ac.currentTime); out.gain.setValueAtTime(target(), ac.currentTime);
    return ac;
  }
  function halt(r, now) {
    r.stop = true;
    for (const s of r.nodes) { try { s.stop(now); } catch (e) { /* not started */ } }
    r.nodes.length = 0;
  }
  const api = {
    async start(t, rate = 1) {
      api.stop(true);
      const c = context();
      await c.resume().catch(() => {});
      const my = run = { stop: false, nodes: [] }, t0 = c.currentTime + 0.1;
      (async () => {
        try {
          for await (const { buffer, timestamp } of sink.buffers(first + t)) {
            if (my.stop) break;
            const when = t0 + (timestamp - first - t) / rate, now = c.currentTime;
            if (when + buffer.duration / rate <= now) continue;
            const s = c.createBufferSource();
            s.buffer = buffer; s.playbackRate.value = rate; s.connect(out);
            if (when < now) s.start(now, (now - when) * rate); else s.start(when);
            my.nodes.push(s);
            s.onended = () => { const i = my.nodes.indexOf(s); if (i >= 0) my.nodes.splice(i, 1); };
            while (!my.stop && when - c.currentTime > AHEAD) await sleep(100);
          }
        } catch (e) { /* the video was closed */ }
      })();
      return () => (c.currentTime - t0) * rate + t;
    },
    stop(now = false) {
      const r = run; run = null;
      if (!r || !ac) return;
      if (now) { halt(r); return; }
      const at = ac.currentTime;
      out.gain.cancelScheduledValues(at); out.gain.setValueAtTime(out.gain.value, at); out.gain.linearRampToValueAtTime(0, at + FADE);
      r.stop = true;
      setTimeout(() => { halt(r); if (!run && ac) { out.gain.cancelScheduledValues(ac.currentTime); out.gain.setValueAtTime(target(), ac.currentTime); } }, FADE * 1000 + 30);
    },
    volume(v) { level = Math.max(0, Math.min(1, +v || 0)); if (ac && run) out.gain.setTargetAtTime(target(), ac.currentTime, 0.02); },
    mute(on) { muted = !!on; if (ac && run) out.gain.setTargetAtTime(target(), ac.currentTime, 0.02); },
    playing: () => !!run,
    close() { api.stop(true); if (ac) ac.close().catch(() => {}); ac = null; }
  };
  return api;
}
