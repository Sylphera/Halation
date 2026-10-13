"""Reference for Vocal Remover's Rust pipeline (stems.rs → matches_the_python_reference): UVR-MDX-NET Inst HQ4 on
onnxruntime with a numpy STFT that follows UVR's separate.py, as measured in the HQ4 report.
Usage: python3 stems-reference.py <UVR-MDX-NET-Inst_HQ_4.onnx> <out folder> [audio file] → mix.f32, inst.f32
(interleaved stereo, 44.1 kHz). Without an audio file a 20 s synthetic song is made (a chord and a sung-like line).
Then: HALATION_ORT=<libonnxruntime 1.24> HALATION_HQ4=<model> HALATION_HQ4_REF=<out folder> cargo test matches_the
HTDemucs: python3 stems-reference.py --htdemucs <955717e8-8726e21a.th> <out folder> → drums.f32, bass.f32, other.f32,
vocals.f32 of out folder's mix.f32 with demucs itself (PyTorch: apply_model, shifts 0, overlap 0.25, the song
normalised as demucs' separate does). Then HALATION_HTDEMUCS=<htdemucs-955717e8.onnx> HALATION_HQ4_REF=<out folder>
cargo test matches_demucs"""
import sys, subprocess, numpy as np, onnxruntime as ort

N_FFT, HOP, DIM_F, DIM_T, COMP = 5120, 1024, 2560, 256, 1.019
CHUNK = HOP * (DIM_T - 1)
TRIM = N_FFT // 2
WIN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)

def stft(x):
    xp = np.pad(x, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    n = 1 + (xp.shape[1] - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    S = np.fft.rfft(xp[:, idx] * WIN, axis=-1).transpose(0, 2, 1)
    return np.stack([S.real, S.imag], 1).reshape(-1, S.shape[1], n)[:, :DIM_F].astype(np.float32)

def istft(spec, length):
    c2, f, n = spec.shape
    full = np.zeros((c2, N_FFT // 2 + 1, n), np.float32); full[:, :f] = spec
    full = full.reshape(c2 // 2, 2, -1, n)
    fr = np.fft.irfft((full[:, 0] + 1j * full[:, 1]).transpose(0, 2, 1), n=N_FFT, axis=-1) * WIN
    tot = N_FFT + HOP * (n - 1)
    y = np.zeros((fr.shape[0], tot), np.float32); w = np.zeros(tot, np.float32)
    for i in range(n):
        y[:, i * HOP:i * HOP + N_FFT] += fr[:, i]; w[i * HOP:i * HOP + N_FFT] += WIN ** 2
    return y[:, N_FFT // 2:N_FFT // 2 + length] / np.maximum(w[N_FFT // 2:N_FFT // 2 + length], 1e-11)

def demix(sess, mix):
    gen = CHUNK - 2 * TRIM
    pad = gen + TRIM - mix.shape[-1] % gen
    m = np.concatenate([np.zeros((2, TRIM), np.float32), mix, np.zeros((2, pad), np.float32)], 1)
    res = np.zeros((2, m.shape[1]), np.float32); div = np.zeros_like(res)
    for s in range(0, m.shape[1], CHUNK - N_FFT):
        e = min(s + CHUNK, m.shape[1]); n = e - s
        part = m[:, s:e]
        if n < CHUNK: part = np.concatenate([part, np.zeros((2, CHUNK - n), np.float32)], 1)
        spec = stft(part); spec[:, :3, :] = 0
        wav = istft(sess.run(None, {"input": spec[None]})[0][0], CHUNK)
        win = np.hanning(n).astype(np.float32)
        res[:, s:e] += wav[:, :n] * win; div[:, s:e] += win
    return (res / np.where(div == 0, 1, div))[:, TRIM:-TRIM][:, :mix.shape[-1]] * COMP

def song(sec=20, sr=44100):
    t = np.arange(sec * sr) / sr
    chord = sum(np.sign(np.sin(2 * np.pi * f * t)) * 0.06 for f in (110, 138.6, 164.8))
    beat = np.exp(-((t % 0.5) * 30)) * np.sin(2 * np.pi * 60 * t) * 0.4
    f0 = 220 * 2 ** (np.floor(t / 1.25) % 5 / 12) * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * t))
    voice = sum(np.sin(2 * np.pi * np.cumsum(f0 * k) / sr) / k for k in range(1, 8)) * 0.15 * (np.sin(np.pi * t / 1.25) ** 2)
    return np.stack([chord + beat + voice * 0.9, chord * 0.8 + beat + voice]).astype(np.float32)

def htdemucs(ck, out):
    import torch
    from demucs.apply import apply_model
    from demucs.states import load_model
    model = load_model(torch.load(ck, map_location="cpu", weights_only=False)).eval()
    mix = torch.from_numpy(np.fromfile(f"{out}/mix.f32", np.float32).reshape(-1, 2).T.copy())
    ref = mix.mean(0)
    wav = (mix - ref.mean()) / ref.std()
    with torch.no_grad():
        src = apply_model(model, wav[None], shifts=0, split=True, overlap=0.25, progress=False)[0]
    src = src * ref.std() + ref.mean()
    for name, x in zip(model.sources, src):
        x.numpy().T.astype(np.float32).tofile(f"{out}/{name}.f32")
    print("sources", model.sources, "seconds", mix.shape[1] / 44100)

if __name__ == "__main__":
    if sys.argv[1] == "--htdemucs":
        htdemucs(*sys.argv[2:4]); sys.exit()
    model, out = sys.argv[1:3]
    if len(sys.argv) > 3:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[3], "-ac", "2", "-ar", "44100", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        mix = np.frombuffer(raw, np.float32).reshape(-1, 2).T.copy()
    else:
        mix = song()
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    inst = demix(sess, mix)
    mix.T.astype(np.float32).tofile(f"{out}/mix.f32"); inst.T.astype(np.float32).tofile(f"{out}/inst.f32")
    print("seconds", mix.shape[1] / 44100)
