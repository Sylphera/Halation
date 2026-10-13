"""Vocal Remover's 4-stem model (stems.rs, component stems-htdemucs): export the HTDemucs core (everything except STFT/iSTFT) to ONNX.
Usage: export.py <checkpoint.th | --random> <out.onnx>
--random builds the architecture of the official `htdemucs` (955717e8: 5 transformer layers, 512 bottom channels,
dconv_mode 3, segment 7.8 s) with random weights, for size, operators and speed only."""
import sys, time, torch
from fractions import Fraction
from einops import rearrange
from demucs.htdemucs import HTDemucs

def build(ck):
    if ck == "--random":
        torch.manual_seed(0)
        return HTDemucs(sources=["drums", "bass", "other", "vocals"], audio_channels=2, samplerate=44100,
                        segment=Fraction(39, 5), channels=48, nfft=4096, depth=4, dconv_mode=3, t_layers=5,
                        bottom_channels=512, t_dropout=0.02).eval()
    from demucs.states import load_model
    return load_model(torch.load(ck, map_location="cpu", weights_only=False)).eval()

class Core(torch.nn.Module):
    """HTDemucs.forward between _magnitude() and _mask(): (mix [B,2,L], mag [B,4,2048,T]) -> (spec [B,S,4,2048,T], wave [B,S,2,L])."""
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, mix, mag):
        m = s.m; x = mag; B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True); std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix; meant = xt.mean(dim=(1, 2), keepdim=True); stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1]); inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1]); tenc = m.tencoder[idx]; xt = tenc(xt)
                if not tenc.empty: saved_t.append(xt)
                else: inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                x = x + m.freq_emb_scale * m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = rearrange(x, "b c f t-> b c (f t)"); x = m.channel_upsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f); xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = rearrange(x, "b c f t-> b c (f t)"); x = m.channel_downsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f); xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            x, pre = decode(x, saved.pop(-1), lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]; length_t = lengths_t.pop(-1)
                if tdec.empty: xt, _ = tdec(pre[:, :, 0], None, length_t)
                else: xt, _ = tdec(xt, saved_t.pop(-1), length_t)
        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, mix.shape[-1]) * stdt[:, None] + meant[:, None]
        return x, xt

def pre(m, mix):   # STFT side, outside the ONNX
    return m._magnitude(m._spec(mix))
def post(m, spec, wave, length):   # iSTFT side, outside the ONNX
    return m._ispec(m._mask(None, spec), length) + wave

if __name__ == "__main__":
    ck, out = sys.argv[1], sys.argv[2]
    m = build(ck); core = Core(m).eval()
    L = int(m.segment * m.samplerate)
    print("params M", round(sum(p.numel() for p in m.parameters()) / 1e6, 2), "segment samples", L, flush=True)
    mix = torch.randn(1, 2, L) * 0.1
    with torch.no_grad():
        mag = pre(m, mix)
        ref = m(mix)
        s, w = core(mix, mag); mine = post(m, s, w, L)
        print("core split vs full forward max abs diff", float((ref - mine).abs().max()), flush=True)
        t0 = time.time()
        torch.onnx.export(core, (mix, mag), out, input_names=["mix", "mag"], output_names=["spec", "wave"],
                          opset_version=20, dynamo=True, external_data=False)
        print("export s", round(time.time() - t0, 1), flush=True)
    import onnxruntime as ort, numpy as np, os, collections, onnx
    print("onnx MB", round(os.path.getsize(out) / 1e6, 1))
    g = onnx.load(out); print("ops", dict(collections.Counter(n.op_type for n in g.graph.node).most_common()))
    sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    t0 = time.time(); so, wo = sess.run(None, {"mix": mix.numpy(), "mag": mag.numpy()}); t1 = time.time()
    with torch.no_grad():
        t2 = time.time(); s, w = core(mix, mag); t3 = time.time()
        y = post(m, torch.from_numpy(so), torch.from_numpy(wo), L)
    rel = float((y - ref).norm() / ref.norm())
    print(f"onnx vs torch: rel err {rel:.2e}; one segment ({L/44100:.1f}s) ort {t1-t0:.2f}s torch {t3-t2:.2f}s", flush=True)
