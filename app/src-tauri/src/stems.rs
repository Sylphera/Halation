//! Vocal Remover (docs/VOCAL_REMOVER_SPEC.md): a song split into vocals and instrumental with UVR-MDX-NET Inst HQ4, or
//! into drums, bass, other and vocals with HTDemucs, on ONNX Runtime, on the GPU through DirectML or on the CPU.
//! Downloaded components in Tools\stems: the runtime (onnxruntime.dll built with DirectML + DirectML.dll) and each
//! model, every file checked by size and sha256, from its source or its mirror. One song per call: FFmpeg decodes it,
//! the STFT runs here (rustfft), the model on ONNX Runtime, chunk by chunk with the waveform of what is final sent to
//! the page (event "stems-progress"), and the stems end as 32-bit float WAV in a folder of the workspace's temp until
//! the page exports them.

use crate::{download::*, paths::*, tools::*};
use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::{AtomicU64, Ordering}, Arc, Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

/* ---------- components: files, sources, verification ---------- */

/// Where a file comes from: a plain download, or one entry of a zip (a NuGet package)
pub(crate) struct Source {
    pub url: &'static str,
    pub inner: Option<&'static str>,
}
/// A file of a component, its exact size and sha256, and its sources in order (the second is the fallback)
pub(crate) struct Asset {
    pub comp: &'static str,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub sources: &'static [Source],
}

/// The files of both components. The DLLs come first from Halation's own release (two loose files, 36 MB) and fall
/// back to the NuGet packages they were taken from; HQ4 comes first from UVR's release, then the mirror. HTDemucs has no
/// official ONNX: Halation's export of Meta's checkpoint (app/scripts/htdemucs-export.py) lives in its own release.
pub(crate) const ASSETS: [Asset; 4] = [
    Asset {
        comp: "onnxruntime",
        file: "onnxruntime.dll",
        size: 17_328_152,
        sha256: "e7eedec6a6f26dc39dc948276a75ef6d2bee3fff944d874ceed0bbd3b97bff40",
        sources: &[
            Source { url: "https://github.com/Sylphera/Halation/releases/download/stems-v1/onnxruntime.dll", inner: None },
            Source { url: "https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime.DirectML/1.24.4", inner: Some("runtimes/win-x64/native/onnxruntime.dll") },
        ],
    },
    Asset {
        comp: "onnxruntime",
        file: "DirectML.dll",
        size: 18_527_776,
        sha256: "9c9e6d822561c6c41b90e6994b3e8857cf1d66dbfb1e0c4c799c7c89b4e92da1",
        sources: &[
            Source { url: "https://github.com/Sylphera/Halation/releases/download/stems-v1/DirectML.dll", inner: None },
            Source { url: "https://www.nuget.org/api/v2/package/Microsoft.AI.DirectML/1.15.4", inner: Some("bin/x64-win/DirectML.dll") },
        ],
    },
    Asset {
        comp: "stems-hq4",
        file: "UVR-MDX-NET-Inst_HQ_4.onnx",
        size: 59_074_342,
        sha256: "3c4b5b9b05090fdf238f38ba5046813982d50e2a652e9cb3324ea79720c3c9c8",
        sources: &[
            Source { url: "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_4.onnx", inner: None },
            Source { url: "https://github.com/Sylphera/Halation/releases/download/stems-v1/UVR-MDX-NET-Inst_HQ_4.onnx", inner: None },
        ],
    },
    Asset {
        comp: "stems-htdemucs",
        // stems-v2's file with DirectML's fixes (app/scripts/htdemucs-dml.py): the same outputs, the GPU accepts it and
        // computes it right (stems-v4: the Splits as Slices)
        file: "htdemucs-955717e8-dml4.onnx",
        size: 170_410_904,
        sha256: "c957fdfeb90f41a7008943bcab55bdef2db6631e77355406bad7e45ee27950be",
        sources: &[Source { url: "https://github.com/Sylphera/Halation/releases/download/stems-v4/htdemucs-955717e8-dml4.onnx", inner: None }],
    },
];
/// Files an earlier version of a component left in Tools\stems (HTDemucs before DirectML's fixes, stems-v2 and stems-v3)
const OLD_FILES: [(&str, &str); 2] = [("stems-htdemucs", "htdemucs-955717e8.onnx"), ("stems-htdemucs", "htdemucs-955717e8-dml.onnx")];
/// The ONNX Runtime the DLL is (the `ort` crate speaks its API: feature api-24)
pub(crate) const ORT_VERSION: &str = "1.24.4";

pub(crate) fn stems_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("stems"))
}

/// Where a file of a component goes: the runtime's two DLLs in Tools\stems\runtime, the models in Tools\stems
pub(crate) fn place(dir: &Path, a: &Asset) -> PathBuf {
    if a.comp == "onnxruntime" {
        dir.join("runtime").join(a.file)
    } else {
        dir.join(a.file)
    }
}

/// A component is there when each of its files exists with its exact size (the sha256 is checked when installing).
fn has(dir: &Path, comp: &str) -> bool {
    ASSETS.iter().filter(|a| a.comp == comp).all(|a| fs::metadata(place(dir, a)).is_ok_and(|m| m.is_file() && m.len() == a.size))
}

/// The runtime library: HALATION_ORT first (an onnxruntime of the system, for tests off Windows), then Halation's copy.
pub(crate) fn runtime_path(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("HALATION_ORT").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let d = stems_dir(app).ok()?;
    (cfg!(windows) && has(&d, "onnxruntime")).then(|| place(&d, &ASSETS[0]))
}

/// The two ways to split a song: its component and the tracks it gives, in the model's order
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Model {
    Hq4,
    Demucs,
}
impl Model {
    pub(crate) fn comp(self) -> &'static str {
        match self {
            Model::Hq4 => "stems-hq4",
            Model::Demucs => "stems-htdemucs",
        }
    }
    pub(crate) fn tracks(self) -> &'static [&'static str] {
        match self {
            Model::Hq4 => &["vocals", "instrumental"],
            Model::Demucs => &DEMUCS_SOURCES,
        }
    }
    fn asset(self) -> &'static Asset {
        ASSETS.iter().find(|a| a.comp == self.comp()).expect("an asset per model")
    }
}

pub(crate) fn model_path(app: &AppHandle, m: Model) -> Option<PathBuf> {
    let d = stems_dir(app).ok()?;
    has(&d, m.comp()).then(|| place(&d, m.asset()))
}

/// tools_status: the runtime and each model, their path when installed
pub(crate) fn status(app: &AppHandle) -> [(&'static str, Option<String>); 3] {
    let s = |p: Option<PathBuf>| p.map(|p| p.to_string_lossy().into_owned());
    [("onnxruntime", s(runtime_path(app))), ("stems-hq4", s(model_path(app, Model::Hq4))), ("stems-htdemucs", s(model_path(app, Model::Demucs)))]
}

pub(crate) fn sha256_of(p: &Path) -> Result<String, String> {
    let mut f = fs::File::open(p).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn verify(p: &Path, a: &Asset) -> Result<(), String> {
    let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    if size != a.size {
        return Err(format!("{}: {size} bytes, expected {}", a.file, a.size));
    }
    if sha256_of(p)? != a.sha256 {
        return Err(format!("{}: the sha256 does not match", a.file));
    }
    Ok(())
}

/// One entry of a zip to `dest`
fn unzip_one(zip_path: &Path, inner: &str, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut entry = zip.by_name(inner).map_err(|_| format!("{inner} is not in the package"))?;
    let mut out = fs::File::create(dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    Ok(())
}

/// A file of a component into `dest`: each source in order, downloaded (and taken out of its package), checked by size
/// and sha256 and only then renamed into place. A source that fails or does not match is deleted and the next one
/// tried; when none gives the right file the error names each failure and nothing is left behind.
pub(crate) fn fetch_verified(agent: &ureq::Agent, a: &Asset, sources: &[Source], dest: &Path, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let part = dest.with_extension("check");
    let pkg = dest.with_extension("pkg");
    let mut errors = vec![];
    for s in sources {
        let got = (|| {
            if let Some(inner) = s.inner {
                download(agent, s.url, &pkg, STALL, &mut progress)?;
                let r = unzip_one(&pkg, inner, &part);
                let _ = fs::remove_file(&pkg);
                r?;
            } else {
                download(agent, s.url, &part, STALL, &mut progress)?;
            }
            verify(&part, a)
        })();
        match got {
            Ok(()) => return fs::rename(&part, dest).map_err(|e| e.to_string()),
            Err(e) => {
                let _ = fs::remove_file(&part);
                let _ = fs::remove_file(&pkg);
                errors.push(e);
            }
        }
    }
    // only stalls: the page recognises the start of the message (shell.js shows "the download stopped")
    if errors.iter().all(|e| e.starts_with(STALLED)) && !errors.is_empty() {
        return Err(errors.swap_remove(0));
    }
    Err(errors.join(" · "))
}

/// Installs a component ("onnxruntime" | "stems-hq4"): its files not there yet, each verified.
pub(crate) fn install(app: &AppHandle, comp: &str) -> Result<(), String> {
    if comp == "onnxruntime" && !cfg!(windows) {
        return Err(format!("ONNX Runtime with DirectML is for Windows; elsewhere set HALATION_ORT to an onnxruntime {ORT_VERSION} library"));
    }
    let d = stems_dir(app)?;
    let agent = agent();
    // files of earlier versions of the component go
    for old in OLD_FILES.iter().filter(|(c, _)| *c == comp) {
        let _ = fs::remove_file(d.join(old.1));
    }
    for a in ASSETS.iter().filter(|a| a.comp == comp) {
        let dest = place(&d, a);
        if let Some(p) = dest.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        if fs::metadata(&dest).is_ok_and(|m| m.len() == a.size) {
            continue;
        }
        let _ = fs::remove_file(&dest);
        fetch_verified(&agent, a, a.sources, &dest, |done, total| {
            let _ = app.emit("tool-progress", json!({ "tool": comp, "file": a.file, "done": done, "total": total }));
        })?;
    }
    Ok(())
}

/* ---------- the STFT of HQ4 (as UVR's separate.py: periodic Hann, centred with reflect, one-sided) ---------- */

pub(crate) const N_FFT: usize = 5120;
pub(crate) const HOP: usize = 1024;
pub(crate) const DIM_F: usize = 2560;
pub(crate) const DIM_T: usize = 256;
/// Samples per chunk the model sees, and the instrumental's compensation (UVR's model_data for HQ4)
pub(crate) const CHUNK: usize = HOP * (DIM_T - 1);
pub(crate) const COMPENSATE: f32 = 1.019;
const TRIM: usize = N_FFT / 2;
/// Samples per point of the waveform sent to the page
pub(crate) const BUCKET: usize = 4096;
pub(crate) const RATE: u32 = 44_100;

pub(crate) struct Stft {
    fwd: Arc<dyn Fft<f32>>,
    inv: Arc<dyn Fft<f32>>,
    win: Vec<f32>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
}

impl Stft {
    pub(crate) fn new() -> Self {
        let mut p = FftPlanner::new();
        let fwd = p.plan_fft_forward(N_FFT);
        let inv = p.plan_fft_inverse(N_FFT);
        let n = fwd.get_inplace_scratch_len().max(inv.get_inplace_scratch_len());
        let win = (0..N_FFT).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / N_FFT as f64).cos()) as f32).collect();
        Stft { fwd, inv, win, buf: vec![Complex32::default(); N_FFT], scratch: vec![Complex32::default(); n] }
    }

    /// Two channels of CHUNK samples → the model's input [4, DIM_F, DIM_T] (re L, im L, re R, im R), the first 3 bins at 0.
    pub(crate) fn forward(&mut self, ch: [&[f32]; 2], out: &mut [f32]) {
        let half = N_FFT / 2;
        for (c, x) in ch.iter().enumerate() {
            let len = x.len() as isize;
            // reflect padding: index -k → k, len-1+k → len-1-k
            let at = |i: isize| -> f32 {
                let j = if i < 0 { -i } else if i >= len { 2 * (len - 1) - i } else { i };
                x[j as usize]
            };
            for t in 0..DIM_T {
                let start = (t * HOP) as isize - half as isize;
                for k in 0..N_FFT {
                    self.buf[k] = Complex32::new(at(start + k as isize) * self.win[k], 0.0);
                }
                self.fwd.process_with_scratch(&mut self.buf, &mut self.scratch);
                let (re, im) = ((c * 2) * DIM_F * DIM_T, (c * 2 + 1) * DIM_F * DIM_T);
                for f in 0..DIM_F {
                    let v = if f < 3 { Complex32::default() } else { self.buf[f] };
                    out[re + f * DIM_T + t] = v.re;
                    out[im + f * DIM_T + t] = v.im;
                }
            }
        }
    }

    /// The model's output [4, DIM_F, DIM_T] → two channels of CHUNK samples (overlap-add normalised by the window²).
    pub(crate) fn inverse(&mut self, spec: &[f32], out: [&mut [f32]; 2]) {
        let half = N_FFT / 2;
        let total = N_FFT + HOP * (DIM_T - 1);
        let mut norm = vec![0f32; total];
        for t in 0..DIM_T {
            for k in 0..N_FFT {
                norm[t * HOP + k] += self.win[k] * self.win[k];
            }
        }
        let mut acc = vec![0f32; total];
        for (c, o) in out.into_iter().enumerate() {
            acc.iter_mut().for_each(|v| *v = 0.0);
            let (re, im) = ((c * 2) * DIM_F * DIM_T, (c * 2 + 1) * DIM_F * DIM_T);
            for t in 0..DIM_T {
                // the one-sided spectrum made whole (Hermitian); the DC's imaginary part and the top bin are 0 (irfft)
                self.buf.iter_mut().for_each(|v| *v = Complex32::default());
                self.buf[0] = Complex32::new(spec[re + t], 0.0);
                for f in 1..DIM_F {
                    let v = Complex32::new(spec[re + f * DIM_T + t], spec[im + f * DIM_T + t]);
                    self.buf[f] = v;
                    self.buf[N_FFT - f] = v.conj();
                }
                self.inv.process_with_scratch(&mut self.buf, &mut self.scratch);
                let k0 = t * HOP;
                for k in 0..N_FFT {
                    acc[k0 + k] += self.buf[k].re / N_FFT as f32 * self.win[k];
                }
            }
            for (i, v) in o.iter_mut().enumerate() {
                *v = acc[half + i] / norm[half + i].max(1e-11);
            }
        }
    }
}

/// Chunk starts over the padded song (UVR's demix: TRIM of silence before, enough after to end on a whole chunk)
pub(crate) fn plan(len: usize) -> (usize, Vec<usize>) {
    let gen = CHUNK - 2 * TRIM;
    let padded = TRIM + len + gen + TRIM - len % gen;
    let step = CHUNK - N_FFT;
    (padded, (0..padded).step_by(step).collect())
}

/// np.hanning(n): the symmetric window each chunk is weighted by when added
fn hanning(n: usize) -> Vec<f32> {
    if n == 1 {
        return vec![1.0];
    }
    (0..n).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos()) as f32).collect()
}

/// The overlap-add of a whole song: the instrumental (model output) accumulated with each chunk's weight
pub(crate) struct Demix {
    pub len: usize,
    pub starts: Vec<usize>,
    padded: usize,
    mix: [Vec<f32>; 2],
    res: [Vec<f32>; 2],
    div: Vec<f32>,
    /// samples of the original that are final (no later chunk adds to them)
    pub done: usize,
}

impl Demix {
    pub(crate) fn new(l: Vec<f32>, r: Vec<f32>) -> Self {
        let len = l.len();
        let (padded, starts) = plan(len);
        let pad = |x: Vec<f32>| {
            let mut v = vec![0f32; padded];
            v[TRIM..TRIM + len].copy_from_slice(&x);
            v
        };
        Demix { len, starts, padded, mix: [pad(l), pad(r)], res: [vec![0f32; padded], vec![0f32; padded]], div: vec![0f32; padded], done: 0 }
    }

    /// The model's input for chunk k (zeros past the end)
    pub(crate) fn input(&self, k: usize, stft: &mut Stft, out: &mut [f32]) {
        let s = self.starts[k];
        let e = (s + CHUNK).min(self.padded);
        let mut ch = [vec![0f32; CHUNK], vec![0f32; CHUNK]];
        for (dst, src) in ch.iter_mut().zip(&self.mix) {
            dst[..e - s].copy_from_slice(&src[s..e]);
        }
        stft.forward([&ch[0], &ch[1]], out);
    }

    /// Adds chunk k's output; returns the range of the original now final
    pub(crate) fn add(&mut self, k: usize, stft: &mut Stft, pred: &[f32]) -> (usize, usize) {
        let s = self.starts[k];
        let e = (s + CHUNK).min(self.padded);
        let n = e - s;
        let mut wav = [vec![0f32; CHUNK], vec![0f32; CHUNK]];
        {
            let [a, b] = &mut wav;
            stft.inverse(pred, [a.as_mut_slice(), b.as_mut_slice()]);
        }
        let w = hanning(n);
        for (res, wav) in self.res.iter_mut().zip(&wav) {
            for ((r, x), g) in res[s..e].iter_mut().zip(wav).zip(&w) {
                *r += x * g;
            }
        }
        for (d, g) in self.div[s..e].iter_mut().zip(&w) {
            *d += g;
        }
        let from = self.done;
        let upto = self.starts.get(k + 1).map_or(self.len, |&next| next.saturating_sub(TRIM).min(self.len));
        self.done = upto.max(from);
        (from, self.done)
    }

    /// Instrumental and vocals at sample i of the original, channel c
    #[inline]
    pub(crate) fn at(&self, c: usize, i: usize) -> (f32, f32) {
        let j = i + TRIM;
        let d = if self.div[j] == 0.0 { 1.0 } else { self.div[j] };
        let inst = self.res[c][j] / d * COMPENSATE;
        (inst, self.mix[c][j] - inst)
    }
}

/* ---------- a model's way through a song: chunks in, tracks out ---------- */

/// One input of the model: its name, shape and data
pub(crate) type Input = (&'static str, Vec<usize>, Vec<f32>);

pub(crate) trait Split {
    fn chunks(&self) -> usize;
    fn len(&self) -> usize;
    fn tracks(&self) -> &'static [&'static str];
    /// The model's inputs for chunk k
    fn input(&mut self, k: usize) -> Vec<Input>;
    /// Adds chunk k's outputs; returns how many samples of the song are now final
    fn add(&mut self, k: usize, outs: &[Vec<f32>]) -> usize;
    /// Track t at sample i of the song, channel c
    fn at(&self, t: usize, c: usize, i: usize) -> f32;
    /// How far the tracks' sum is from the song over its first `to` samples (relative, 0 = they add up): a model whose
    /// tracks should add up (HTDemucs) but do not ran wrong (DirectML on some GPUs). 0 for a model they need not.
    fn off_mix(&self, _to: usize) -> f32 {
        0.0
    }
    /// Forgets the chunks added (the song runs again from chunk 0)
    fn clear(&mut self) {}
}

/// The waveform of a range, per track: per BUCKET, the highest absolute value of the louder channel
pub(crate) fn peaks(sp: &dyn Split, from: usize, to: usize) -> Vec<Vec<f32>> {
    (0..sp.tracks().len())
        .map(|t| {
            (from..to)
                .step_by(BUCKET)
                .map(|b| (b..(b + BUCKET).min(to)).flat_map(|i| [sp.at(t, 0, i).abs(), sp.at(t, 1, i).abs()]).fold(0f32, f32::max))
                .collect()
        })
        .collect()
}

/// HQ4: the instrumental from the model, the vocals what is left of the mix
pub(crate) struct Hq4 {
    d: Demix,
    stft: Stft,
}
impl Hq4 {
    pub(crate) fn new(l: Vec<f32>, r: Vec<f32>) -> Self {
        Hq4 { d: Demix::new(l, r), stft: Stft::new() }
    }
}
impl Split for Hq4 {
    fn chunks(&self) -> usize {
        self.d.starts.len()
    }
    fn len(&self) -> usize {
        self.d.len
    }
    fn tracks(&self) -> &'static [&'static str] {
        Model::Hq4.tracks()
    }
    fn input(&mut self, k: usize) -> Vec<Input> {
        let mut x = vec![0f32; 4 * DIM_F * DIM_T];
        self.d.input(k, &mut self.stft, &mut x);
        vec![("input", vec![1, 4, DIM_F, DIM_T], x)]
    }
    fn add(&mut self, k: usize, outs: &[Vec<f32>]) -> usize {
        self.d.add(k, &mut self.stft, &outs[0]).1
    }
    fn at(&self, t: usize, c: usize, i: usize) -> f32 {
        let (inst, voc) = self.d.at(c, i);
        if t == 0 {
            voc
        } else {
            inst
        }
    }
}

/* ---------- HTDemucs (as demucs' apply_model, shifts 0, overlap 0.25; the STFT of htdemucs.py _spec / _ispec) ---------- */

pub(crate) const DEMUCS_SOURCES: [&str; 4] = ["drums", "bass", "other", "vocals"];
const D_NFFT: usize = 4096;
const D_HOP: usize = 1024;
const D_BINS: usize = D_NFFT / 2;
/// The segment the model was trained on (7.8 s) and its frames; demucs pads the signal by 3/2 hop on each side so
/// the frames match the samples
pub(crate) const SEGMENT: usize = 343_980;
const D_FRAMES: usize = SEGMENT.div_ceil(D_HOP);
const D_PAD: usize = D_HOP / 2 * 3;
/// One segment every 3/4 of one (overlap 0.25)
pub(crate) const D_STRIDE: usize = SEGMENT * 3 / 4;

pub(crate) struct Demucs {
    len: usize,
    /// the song normalised as demucs' separate does (by the mono mix's mean and standard deviation)
    mean: f32,
    std: f32,
    mix: [Vec<f32>; 2],
    pub offsets: Vec<usize>,
    /// per source and channel (s × 2 + c), the weighted sum of the segments, and the sum of the weights
    out: Vec<Vec<f32>>,
    sw: Vec<f32>,
    weight: Vec<f32>,
    fwd: Arc<dyn Fft<f32>>,
    inv: Arc<dyn Fft<f32>>,
    win: Vec<f32>,
    /// the window² summed over the frames of a segment (the iSTFT's normalisation)
    env: Vec<f32>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
}

impl Demucs {
    pub(crate) fn new(l: Vec<f32>, r: Vec<f32>) -> Self {
        let len = l.len();
        let n = len.max(2) as f64;
        let mono = |i: usize| (l[i] as f64 + r[i] as f64) / 2.0;
        let mean = (0..len).map(mono).sum::<f64>() / n;
        let std = ((0..len).map(|i| (mono(i) - mean).powi(2)).sum::<f64>() / (n - 1.0)).sqrt().max(1e-8);
        let norm = |x: Vec<f32>| x.into_iter().map(|v| ((v as f64 - mean) / std) as f32).collect::<Vec<f32>>();
        let mut p = FftPlanner::new();
        let fwd = p.plan_fft_forward(D_NFFT);
        let inv = p.plan_fft_inverse(D_NFFT);
        let scratch = vec![Complex32::default(); fwd.get_inplace_scratch_len().max(inv.get_inplace_scratch_len())];
        let win: Vec<f32> = (0..D_NFFT).map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / D_NFFT as f64).cos()) as f32).collect();
        let mut env = vec![0f32; D_NFFT + D_HOP * (D_FRAMES + 3)];
        for t in 0..D_FRAMES + 4 {
            for (k, w) in win.iter().enumerate() {
                env[t * D_HOP + k] += w * w;
            }
        }
        // apply_model's transition: a triangle over the segment, 1 at its middle
        let half = (SEGMENT / 2) as f32;
        let weight = (0..SEGMENT).map(|i| if i < SEGMENT / 2 { (i + 1) as f32 } else { (SEGMENT - i) as f32 } / half).collect();
        Demucs {
            len,
            mean: mean as f32,
            std: std as f32,
            mix: [norm(l), norm(r)],
            offsets: (0..len).step_by(D_STRIDE).collect(),
            out: vec![vec![0f32; len]; 8],
            sw: vec![0f32; len],
            weight,
            fwd,
            inv,
            win,
            env,
            buf: vec![Complex32::default(); D_NFFT],
            scratch,
        }
    }

    /// Segment k: its length in the song and where the model's segment starts (a short last one is centred, with
    /// the song before it and zeros after, as TensorChunk.padded)
    fn span(&self, k: usize) -> (usize, usize, isize) {
        let off = self.offsets[k];
        let n = (self.len - off).min(SEGMENT);
        let d = SEGMENT - n;
        (off, n, off as isize - (d / 2) as isize)
    }
}

impl Split for Demucs {
    fn chunks(&self) -> usize {
        self.offsets.len()
    }
    fn len(&self) -> usize {
        self.len
    }
    fn tracks(&self) -> &'static [&'static str] {
        Model::Demucs.tracks()
    }
    /// mix [1, 2, SEGMENT] and its spectrum mag [1, 4, 2048, 336] (re L, im L, re R, im R; last bin dropped)
    fn input(&mut self, k: usize) -> Vec<Input> {
        let (_, _, start) = self.span(k);
        let mut mix = vec![0f32; 2 * SEGMENT];
        for (c, src) in self.mix.iter().enumerate() {
            for (i, v) in mix[c * SEGMENT..(c + 1) * SEGMENT].iter_mut().enumerate() {
                let j = start + i as isize;
                if j >= 0 && (j as usize) < self.len {
                    *v = src[j as usize];
                }
            }
        }
        let mut mag = vec![0f32; 4 * D_BINS * D_FRAMES];
        let scale = 1.0 / (D_NFFT as f32).sqrt();
        for c in 0..2 {
            let seg = &mix[c * SEGMENT..(c + 1) * SEGMENT];
            // _spec's reflect padding of D_PAD before; the frames kept start at t × hop of the padded signal
            let at = |j: isize| -> f32 {
                let i = j - D_PAD as isize;
                let i = if i < 0 { -i } else if i >= SEGMENT as isize { 2 * (SEGMENT as isize - 1) - i } else { i };
                seg[i as usize]
            };
            for t in 0..D_FRAMES {
                for (k, b) in self.buf.iter_mut().enumerate() {
                    *b = Complex32::new(at((t * D_HOP + k) as isize) * self.win[k], 0.0);
                }
                self.fwd.process_with_scratch(&mut self.buf, &mut self.scratch);
                let (re, im) = ((c * 2) * D_BINS * D_FRAMES, (c * 2 + 1) * D_BINS * D_FRAMES);
                for f in 0..D_BINS {
                    mag[re + f * D_FRAMES + t] = self.buf[f].re * scale;
                    mag[im + f * D_FRAMES + t] = self.buf[f].im * scale;
                }
            }
        }
        vec![("mix", vec![1, 2, SEGMENT], mix), ("mag", vec![1, 4, D_BINS, D_FRAMES], mag)]
    }
    /// spec [1, 4 sources, 4, 2048, 336] through the iSTFT, plus wave [1, 4, 2, SEGMENT], weighted into the song
    fn add(&mut self, k: usize, outs: &[Vec<f32>]) -> usize {
        let (off, n, _) = self.span(k);
        let trim = (SEGMENT - n) / 2;
        let (spec, wave) = (&outs[0], &outs[1]);
        let scale = (D_NFFT as f32).sqrt() / D_NFFT as f32;
        let mut y = vec![0f32; self.env.len()];
        for s in 0..4 {
            for c in 0..2 {
                y.iter_mut().for_each(|v| *v = 0.0);
                let (re, im) = (((s * 4) + c * 2) * D_BINS * D_FRAMES, ((s * 4) + c * 2 + 1) * D_BINS * D_FRAMES);
                for t in 0..D_FRAMES {
                    self.buf.iter_mut().for_each(|v| *v = Complex32::default());
                    self.buf[0] = Complex32::new(spec[re + t], 0.0);
                    for f in 1..D_BINS {
                        let v = Complex32::new(spec[re + f * D_FRAMES + t], spec[im + f * D_FRAMES + t]);
                        self.buf[f] = v;
                        self.buf[D_NFFT - f] = v.conj();
                    }
                    self.inv.process_with_scratch(&mut self.buf, &mut self.scratch);
                    // two empty frames before each segment's first (_ispec pads them back)
                    let k0 = (t + 2) * D_HOP;
                    for (k, w) in self.win.iter().enumerate() {
                        y[k0 + k] += self.buf[k].re * scale * w;
                    }
                }
                let o0 = D_NFFT / 2 + D_PAD + trim;
                let w0 = (s * 2 + c) * SEGMENT + trim;
                let out = &mut self.out[s * 2 + c][off..off + n];
                for (i, v) in out.iter_mut().enumerate() {
                    let x = y[o0 + i] / self.env[o0 + i] + wave[w0 + i];
                    *v += x * self.weight[i];
                }
            }
        }
        for (v, w) in self.sw[off..off + n].iter_mut().zip(&self.weight) {
            *v += w;
        }
        self.offsets.get(k + 1).copied().unwrap_or(self.len).min(self.len)
    }
    fn at(&self, t: usize, c: usize, i: usize) -> f32 {
        let w = if self.sw[i] == 0.0 { 1.0 } else { self.sw[i] };
        self.out[t * 2 + c][i] / w * self.std + self.mean
    }
    fn off_mix(&self, to: usize) -> f32 {
        let (mut num, mut den) = (0f64, 0f64);
        for c in 0..2 {
            for i in 0..to.min(self.len) {
                let w = if self.sw[i] == 0.0 { 1.0 } else { self.sw[i] };
                let sum: f32 = (0..4).map(|s| self.out[s * 2 + c][i] / w).sum();
                let m = self.mix[c][i] as f64;
                num += (sum as f64 - m).powi(2);
                den += m * m;
            }
        }
        // NaN or infinity: as far as it gets
        let e = (num / den.max(1e-12)).sqrt() as f32;
        if e.is_finite() {
            e
        } else {
            f32::MAX
        }
    }
    fn clear(&mut self) {
        self.out.iter_mut().for_each(|o| o.iter_mut().for_each(|v| *v = 0.0));
        self.sw.iter_mut().for_each(|v| *v = 0.0);
    }
}

/* ---------- reading and writing audio ---------- */

/// The song as 32-bit float stereo at 44.1 kHz (mono doubled, more channels mixed down) through FFmpeg, and its own
/// sample rate and codec as FFmpeg reports them.
pub(crate) fn decode(ffmpeg: &Path, input: &str) -> Result<(Vec<f32>, Vec<f32>, Value), String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-i", input, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-f", "f32le", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut err = child.stderr.take().ok_or("no stderr")?;
    let errs = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let mut raw = vec![];
    child.stdout.take().ok_or("no stdout")?.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let code = child.wait().map_err(|e| e.to_string())?;
    let log = errs.join().unwrap_or_default();
    let audio = log.lines().find(|l| l.contains("Stream #") && l.contains("Audio:")).unwrap_or("");
    let rate = audio.split(',').find_map(|p| p.trim().strip_suffix(" Hz").and_then(|n| n.trim().parse::<u32>().ok()));
    let codec = audio.split("Audio:").nth(1).and_then(|s| s.split([',', ' ']).find(|w| !w.is_empty())).unwrap_or("");
    if !code.success() || raw.len() < 8 {
        let why = if audio.is_empty() { "no audio".to_string() } else { log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string() };
        return Err(why);
    }
    let n = raw.len() / 8;
    let (mut l, mut r) = (Vec::with_capacity(n), Vec::with_capacity(n));
    for f in raw.chunks_exact(8) {
        l.push(f32::from_le_bytes([f[0], f[1], f[2], f[3]]));
        r.push(f32::from_le_bytes([f[4], f[5], f[6], f[7]]));
    }
    Ok((l, r, json!({ "rate": rate, "codec": codec })))
}

/// 32-bit float stereo WAV (format 3)
pub(crate) fn write_wav(path: &Path, frames: usize, mut sample: impl FnMut(usize, usize) -> f32) -> Result<(), String> {
    let mut w = BufWriter::new(fs::File::create(path).map_err(|e| e.to_string())?);
    let data = (frames * 8) as u32;
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&3u16.to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&RATE.to_le_bytes());
    h.extend_from_slice(&(RATE * 8).to_le_bytes());
    h.extend_from_slice(&8u16.to_le_bytes());
    h.extend_from_slice(&32u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data.to_le_bytes());
    w.write_all(&h).map_err(|e| e.to_string())?;
    for i in 0..frames {
        for c in 0..2 {
            w.write_all(&sample(c, i).to_le_bytes()).map_err(|e| e.to_string())?;
        }
    }
    w.flush().map_err(|e| e.to_string())
}

/* ---------- the engine: ONNX Runtime, DirectML or CPU ---------- */

pub(crate) struct Engine {
    session: ort::session::Session,
    pub gpu: bool,
    model: PathBuf,
}

static RUNTIME: OnceLock<Result<(), String>> = OnceLock::new();
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);
static ENGINE_VERSION: AtomicU64 = AtomicU64::new(0);
const ENGINE_IDLE: Duration = Duration::from_secs(30);
struct EngineIdle {
    deadline: Mutex<Option<(Instant, u64)>>,
    wake: Condvar,
}
static ENGINE_IDLE_STATE: OnceLock<EngineIdle> = OnceLock::new();
static ENGINE_IDLE_STARTED: OnceLock<()> = OnceLock::new();

// A cache expiration never waits for or interrupts inference. Destruction is performed
// by the parked background thread after releasing the engine mutex.
fn take_idle_cache<T>(cache: &Mutex<Option<T>>, version: &AtomicU64, expected: u64) -> Option<T> {
    if version.load(Ordering::Acquire) != expected { return None; }
    let mut slot = cache.try_lock().ok()?;
    if version.load(Ordering::Acquire) != expected { return None; }
    slot.take()
}
struct EngineUse;
impl EngineUse {
    fn begin() -> Self { ENGINE_VERSION.fetch_add(1, Ordering::AcqRel); Self }
}
impl Drop for EngineUse {
    fn drop(&mut self) {
        let version = ENGINE_VERSION.fetch_add(1, Ordering::AcqRel) + 1;
        let state = ENGINE_IDLE_STATE.get_or_init(|| EngineIdle { deadline: Mutex::new(None), wake: Condvar::new() });
        ENGINE_IDLE_STARTED.get_or_init(|| {
            if let Err(error) = std::thread::Builder::new().name("stems-cache-idle".into()).spawn(move || {
                loop {
                    let mut deadline = hold(&state.deadline);
                    loop {
                        match *deadline {
                            None => deadline = state.wake.wait(deadline).unwrap_or_else(|e| e.into_inner()),
                            Some((at, _)) if at > Instant::now() => {
                                let delay = at.saturating_duration_since(Instant::now());
                                deadline = state.wake.wait_timeout(deadline, delay).unwrap_or_else(|e| e.into_inner()).0;
                            }
                            Some((_, version)) => {
                                *deadline = None; drop(deadline);
                                drop(take_idle_cache(&ENGINE, &ENGINE_VERSION, version));
                                break;
                            }
                        }
                    }
                }
            }) { eprintln!("Separation cache cleanup unavailable: {error}"); }
        });
        let mut deadline = hold(&state.deadline);
        if ENGINE_VERSION.load(Ordering::Acquire) == version {
            *deadline = Some((Instant::now() + ENGINE_IDLE, version));
            state.wake.notify_one();
        }
    }
}

/// Loads the runtime library once per run of the app. DirectML.dll is loaded first from its full path, so the
/// runtime finds it already in the process (the loader would not look beside onnxruntime.dll).
pub(crate) fn load_runtime(lib: &Path) -> Result<(), String> {
    RUNTIME
        .get_or_init(|| {
            #[cfg(windows)]
            {
                use windows_sys::Win32::System::LibraryLoader::LoadLibraryW;
                let dml = lib.with_file_name("DirectML.dll");
                if dml.is_file() {
                    use std::os::windows::ffi::OsStrExt;
                    let w: Vec<u16> = dml.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                    // SAFETY: a NUL-terminated wide path; the module stays loaded for the life of the process.
                    unsafe { LoadLibraryW(w.as_ptr()) };
                }
            }
            ort::init_from(lib).map_err(|e| e.to_string())?.with_name("halation").commit();
            Ok(())
        })
        .clone()
}

/// Physical cores (the CPU session takes one fewer, so the interface keeps one)
pub(crate) fn physical_cores() -> usize {
    let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GetLogicalProcessorInformation, RelationProcessorCore, SYSTEM_LOGICAL_PROCESSOR_INFORMATION};
        let size = std::mem::size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION>();
        let mut len: u32 = 0;
        // SAFETY: the first call only asks for the size; the second fills a buffer of that size.
        unsafe {
            GetLogicalProcessorInformation(std::ptr::null_mut(), &mut len);
            let mut buf: Vec<SYSTEM_LOGICAL_PROCESSOR_INFORMATION> = Vec::with_capacity(len as usize / size + 1);
            if GetLogicalProcessorInformation(buf.as_mut_ptr(), &mut len) != 0 {
                buf.set_len(len as usize / size);
                let n = buf.iter().filter(|x| x.Relationship == RelationProcessorCore).count();
                if n > 0 {
                    return n;
                }
            }
        }
    }
    logical
}

fn session(model: &Path, gpu: bool) -> Result<ort::session::Session, String> {
    use ort::session::{builder::GraphOptimizationLevel, Session};
    let b = Session::builder().map_err(|x| x.to_string())?.with_optimization_level(GraphOptimizationLevel::Level3).map_err(|x| x.to_string())?;
    let mut b = if gpu {
        let dml = ort::ep::DirectML::default().with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance).build().error_on_failure();
        // DirectML wants sequential execution and no memory pattern
        b.with_memory_pattern(false).map_err(|x| x.to_string())?.with_parallel_execution(false).map_err(|x| x.to_string())?.with_execution_providers([dml]).map_err(|x| x.to_string())?
    } else {
        b.with_intra_threads(physical_cores().saturating_sub(1).max(1)).map_err(|x| x.to_string())?
    };
    b.commit_from_file(model).map_err(|x| x.to_string())
}

/// The session kept between songs (a queue loads the model once); a new one when the model or the device changes.
/// want_gpu: DirectML first (Windows), the CPU when it cannot start; Err only when the CPU fails too. Returns whether
/// the GPU was wanted but not had.
fn prepare(slot: &mut Option<Engine>, model: &Path, want_gpu: bool, note: &mut dyn FnMut(Step)) -> Result<bool, String> {
    let want_gpu = want_gpu && cfg!(windows);
    if slot.as_ref().is_some_and(|e| e.model == model && e.gpu == want_gpu) {
        return Ok(false);
    }
    *slot = None;
    if want_gpu {
        note(Step::Stage("model-gpu"));
        match session(model, true) {
            Ok(s) => {
                *slot = Some(Engine { session: s, gpu: true, model: model.to_path_buf() });
                return Ok(false);
            }
            Err(e) => note(Step::Log(format!("DirectML not available: {e}"))),
        }
    }
    note(Step::Stage("model-cpu"));
    *slot = Some(Engine { session: session(model, false)?, gpu: false, model: model.to_path_buf() });
    Ok(want_gpu)
}

/// The model on one chunk: its inputs in (HQ4 one, HTDemucs two), every output back in order
fn infer(engine: &mut Engine, inputs: &[Input], opts: &ort::session::RunOptions) -> Result<Vec<Vec<f32>>, String> {
    let tensor = |(_, shape, data): &Input| ort::value::Tensor::from_array((shape.clone(), data.clone())).map_err(|e| e.to_string());
    let out = match inputs {
        [a] => engine.session.run_with_options(ort::inputs![a.0 => tensor(a)?], opts),
        [a, b] => engine.session.run_with_options(ort::inputs![a.0 => tensor(a)?, b.0 => tensor(b)?], opts),
        _ => return Err("a model with one or two inputs".into()),
    }
    .map_err(|e| e.to_string())?;
    (0..out.len()).map(|i| out[i].try_extract_tensor::<f32>().map(|(_, d)| d.to_vec()).map_err(|e| e.to_string())).collect()
}

/* ---------- a song, separated ---------- */

/// Jobs running and their run options (cancel stops the model mid-chunk)
#[derive(Default)]
struct Running(HashMap<String, Arc<ort::session::RunOptions>>, std::collections::HashSet<String>);
static RUNNING: OnceLock<Mutex<Running>> = OnceLock::new();
fn running() -> std::sync::MutexGuard<'static, Running> {
    hold(RUNNING.get_or_init(Default::default))
}
const CANCELLED: &str = "cancelled";

/// The work folder of a song's stems in the workspace's temp (stems-<job>), kept until the page lets it go
fn out_folder(temp: &Path, name: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(name);
    let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let parent_ok = p.parent().is_none_or(|d| d.as_os_str().is_empty() || d == temp);
    if !n.starts_with("stems-") || !crate::workspace::valid_key(n) || !parent_ok {
        return Err("not a folder of Vocal Remover".into());
    }
    Ok(temp.join(n))
}

/// What a separation tells as it goes: a stage before the first chunk (the runtime, the song, the model on the GPU or
/// the CPU, the first chunk), a line for the log, each chunk with the waveform of the part now final
pub(crate) enum Step {
    Stage(&'static str),
    Log(String),
    Chunk { k: usize, chunks: usize, gpu: bool, from: usize, peaks: Vec<Vec<f32>> },
}

/// How far HTDemucs' four tracks may be from the song they came from (on the CPU, about 0.02 to 0.1)
const OFF_MIX: f32 = 0.5;

pub(crate) struct Outcome {
    pub gpu: bool,
    pub fell: bool,
    /// per track, its highest absolute sample
    pub peaks: Vec<f32>,
    pub model_s: f64,
    pub dsp_s: f64,
}

/// Separates a decoded song into `dir` (one <track>.wav per track of the model). `progress` gets the stages and, after
/// each chunk, the waveform of the part now final; `stop()` is asked between chunks.
pub(crate) fn separate(
    (model, kind): (&Path, Model),
    want_gpu: bool,
    (l, r): (Vec<f32>, Vec<f32>),
    dir: &Path,
    opts: &ort::session::RunOptions,
    stop: impl Fn() -> bool,
    mut progress: impl FnMut(Step),
) -> Result<Outcome, String> {
    let _engine_use = EngineUse::begin();
    let mut sp: Box<dyn Split> = match kind {
        Model::Hq4 => Box::new(Hq4::new(l, r)),
        Model::Demucs => Box::new(Demucs::new(l, r)),
    };
    let mut slot = hold(&ENGINE);
    let mut fell = prepare(&mut slot, model, want_gpu, &mut progress)?;
    let (chunks, len) = (sp.chunks(), sp.len());
    let (mut model_s, mut dsp_s) = (0f64, 0f64);
    let mut sent = 0;
    for k in 0..chunks {
        if stop() {
            return Err(CANCELLED.into());
        }
        let t0 = Instant::now();
        let input = sp.input(k);
        let t1 = Instant::now();
        let engine = slot.as_mut().ok_or("no engine")?;
        let gpu = engine.gpu;
        if k == 0 {
            progress(Step::Stage(if gpu { "first-gpu" } else { "first-cpu" }));
        }
        let pred = match infer(engine, &input, opts) {
            Ok(p) => p,
            Err(_) if stop() => return Err(CANCELLED.into()),
            // the first chunk on the GPU failed: the whole song on the CPU
            Err(e) if gpu && k == 0 => {
                progress(Step::Log(format!("DirectML failed on the first chunk: {e}")));
                fell = true;
                prepare(&mut slot, model, false, &mut progress)?;
                infer(slot.as_mut().ok_or("no engine")?, &input, opts)?
            }
            Err(e) => return Err(e),
        };
        let t2 = Instant::now();
        let mut to = sp.add(k, &pred);
        // the first chunk on the GPU whose tracks do not add up to the song (DirectML ran the model wrong): the whole
        // song on the CPU
        if k == 0 && slot.as_ref().is_some_and(|e| e.gpu) {
            let off = sp.off_mix(to);
            if off > 0.0 {
                progress(Step::Log(format!("first chunk on the GPU: the tracks are {off:.3} off the song")));
            }
            if off > OFF_MIX {
                progress(Step::Log("DirectML ran the model wrong: the CPU".into()));
                fell = true;
                sp.clear();
                prepare(&mut slot, model, false, &mut progress)?;
                let pred = infer(slot.as_mut().ok_or("no engine")?, &input, opts)?;
                to = sp.add(k, &pred);
            }
        }
        drop(input);
        dsp_s += (t1 - t0).as_secs_f64() + t2.elapsed().as_secs_f64();
        model_s += (t2 - t1).as_secs_f64();
        // whole points of the waveform only (the last one may be short): from where the previous event stopped
        let b1 = if to == len { len } else { to / BUCKET * BUCKET };
        let b0 = sent.min(b1);
        sent = b1;
        let p = if b1 > b0 { peaks(sp.as_ref(), b0, b1) } else { vec![vec![]; sp.tracks().len()] };
        progress(Step::Chunk { k: k + 1, chunks, gpu: slot.as_ref().is_some_and(|e| e.gpu), from: b0.div_ceil(BUCKET), peaks: p });
    }
    let gpu = slot.as_ref().is_some_and(|e| e.gpu);
    drop(slot);
    let mut top = vec![];
    for (t, name) in sp.tracks().iter().enumerate() {
        let mut m = 0f32;
        write_wav(&dir.join(format!("{name}.wav")), len, |c, i| {
            let x = sp.at(t, c, i);
            m = m.max(x.abs());
            x
        })?;
        top.push(m);
    }
    Ok(Outcome { gpu, fell, peaks: top, model_s, dsp_s })
}

/// Separates one song (path: any file FFmpeg reads with audio) for a job of the page. mode: "hq4" (vocals,
/// instrumental) | "htdemucs" (drums, bass, other, vocals); device: "auto" (DirectML when it works, else CPU) | "cpu".
/// Events "stems-progress" { job, stage } before the first chunk, then { job, chunk, chunks, device, total, from,
/// peaks { track: [] } } with the waveform as it becomes final (one point per BUCKET samples of `total`, from = index
/// of the first). Returns the folder, the tracks and their files and peaks, the decoded song (original), the device used
/// and whether the GPU failed, the song's own rate and the timings.
#[tauri::command]
pub async fn stems_separate(app: AppHandle, job: String, path: String, mode: Option<String>, device: Option<String>) -> Result<Value, String> {
    if !crate::workspace::valid_key(&job) {
        return Err("invalid job id".into());
    }
    let kind = match mode.as_deref() {
        None | Some("hq4") => Model::Hq4,
        Some("htdemucs") => Model::Demucs,
        Some(m) => return Err(format!("unknown mode {m}")),
    };
    running().1.remove(&job);
    let (a, j) = (app.clone(), job.clone());
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let t0 = Instant::now();
        // each stage goes to the page and, with its time, to stems.log in the workspace's temp (what to send when a
        // song does not move)
        let log_file = crate::workspace::temp_root(&a).ok().map(|d| d.join("stems.log"));
        let log = |line: &str| {
            let line = format!("{:>8.2} s  {j}  {line}", t0.elapsed().as_secs_f64());
            eprintln!("stems: {line}");
            if let Some(f) = &log_file {
                if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(f) {
                    let _ = writeln!(f, "{line}");
                }
            }
        };
        let stage = |s: &str| {
            log(s);
            let _ = a.emit("stems-progress", json!({ "job": j, "stage": s }));
        };
        log(&format!("start {path} ({:?}, {})", kind, device.as_deref().unwrap_or("auto")));
        let lib = runtime_path(&a).ok_or("ONNX Runtime is not installed")?;
        let model = model_path(&a, kind).ok_or(match kind {
            Model::Hq4 => "the HQ4 model is not installed",
            Model::Demucs => "the HTDemucs model is not installed",
        })?;
        let ffmpeg = find_ffmpeg(&a).ok_or("FFmpeg not installed")?;
        stage("runtime");
        load_runtime(&lib).inspect_err(|e| log(&format!("runtime failed: {e}")))?;
        // only now: any call into ORT before load_runtime makes the crate load "onnxruntime.dll" by name, which on
        // Windows can be an older copy in System32 that never answers
        let opts = Arc::new(ort::session::RunOptions::new().map_err(|e| e.to_string())?);
        {
            let mut r = running();
            r.0.insert(j.clone(), opts.clone());
            if r.1.contains(&j) {
                let _ = opts.terminate();
            }
        }
        let stop = || running().1.contains(&j);
        stage("decode");
        let (l, r, src) = decode(&ffmpeg, &path).inspect_err(|e| log(&format!("decode failed: {e}")))?;
        let decode_s = t0.elapsed().as_secs_f64();
        if stop() {
            return Err(CANCELLED.into());
        }
        let frames = l.len();
        let total = frames.div_ceil(BUCKET);
        let dir = out_folder(&crate::workspace::temp_root(&a)?, &format!("stems-{j}"))?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        log(&format!("decoded {:.1} s of audio", frames as f64 / RATE as f64));
        // the song as the model hears it, for Original / Separated in the player
        let original = dir.join("original.wav");
        write_wav(&original, frames, |c, i| if c == 0 { l[i] } else { r[i] })?;
        let tracks = kind.tracks();
        let res = separate((&model, kind), device.as_deref() != Some("cpu"), (l, r), &dir, &opts, stop, |step| match step {
            Step::Stage(s) => stage(s),
            Step::Log(s) => log(&s),
            Step::Chunk { k, chunks, gpu, from, peaks } => {
                if k == 1 || k == chunks {
                    log(&format!("chunk {k}/{chunks} on the {}", if gpu { "GPU" } else { "CPU" }));
                }
                let peaks: serde_json::Map<String, Value> = tracks.iter().zip(peaks).map(|(t, p)| (t.to_string(), json!(p))).collect();
                let _ = a.emit("stems-progress", json!({ "job": j, "chunk": k, "chunks": chunks, "device": if gpu { "gpu" } else { "cpu" }, "total": total, "from": from, "peaks": peaks }));
            }
        });
        let o = match res {
            Ok(o) => o,
            Err(e) => {
                log(&format!("stopped: {e}"));
                let _ = fs::remove_dir_all(&dir);
                return Err(e);
            }
        };
        log(&format!("done in {:.1} s (model {:.1} s)", t0.elapsed().as_secs_f64(), o.model_s));
        let files: serde_json::Map<String, Value> = tracks.iter().map(|t| (t.to_string(), json!(dir.join(format!("{t}.wav")).to_string_lossy()))).collect();
        let peak: serde_json::Map<String, Value> = tracks.iter().zip(&o.peaks).map(|(t, p)| (t.to_string(), json!(p))).collect();
        Ok(json!({
            "dir": dir.to_string_lossy(), "mode": mode.as_deref().unwrap_or("hq4"), "tracks": tracks, "files": files,
            "original": original.to_string_lossy(),
            "peak": peak, "device": if o.gpu { "gpu" } else { "cpu" }, "fellBack": o.fell,
            "seconds": frames as f64 / RATE as f64, "buckets": frames.div_ceil(BUCKET), "source": src,
            "time": { "decode": decode_s, "model": o.model_s, "dsp": o.dsp_s, "total": t0.elapsed().as_secs_f64() }
        }))
    })
    .await
    .map_err(|e| e.to_string());
    let mut r = running();
    r.0.remove(&job);
    r.1.remove(&job);
    result?
}

/// Stops a song being separated: the model's current run ends at once, the loop at the next chunk, its folder goes.
#[tauri::command]
pub fn stems_cancel(job: String) {
    let mut r = running();
    if let Some(o) = r.0.get(&job) {
        let _ = o.terminate();
    }
    r.1.insert(job);
}

/// Deletes a song's stems folder (removed from the queue, or replaced)
#[tauri::command]
pub fn stems_clean(app: AppHandle, dir: String) -> Result<(), String> {
    let d = out_folder(&crate::workspace::temp_root(&app)?, &dir)?;
    if d.is_dir() {
        fs::remove_dir_all(&d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The highest absolute sample of the tracks summed with their gains (a mix of what is heard), to export it unclipped.
/// gains: track → gain; a track with gain 0 is not read.
#[tauri::command]
pub async fn stems_peak(app: AppHandle, dir: String, gains: HashMap<String, f32>) -> Result<f32, String> {
    let d = out_folder(&crate::workspace::temp_root(&app)?, &dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut parts = vec![];
        for (t, g) in gains.iter().filter(|(_, g)| **g != 0.0) {
            if !t.chars().all(|c| c.is_ascii_lowercase()) {
                return Err(format!("unknown track {t}"));
            }
            parts.push((fs::read(d.join(format!("{t}.wav"))).map_err(|e| e.to_string())?, *g));
        }
        Ok(mix_peak(&parts))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Over WAV files of write_wav (the samples after the 44-byte header), each with its gain
pub(crate) fn mix_peak(parts: &[(Vec<u8>, f32)]) -> f32 {
    let n = parts.iter().map(|(b, _)| b.len().saturating_sub(44) / 4).min().unwrap_or(0);
    let f = |b: &[u8], i: usize| f32::from_le_bytes([b[44 + i * 4], b[45 + i * 4], b[46 + i * 4], b[47 + i * 4]]);
    (0..n).map(|i| parts.iter().map(|(b, g)| f(b, i) * g).sum::<f32>().abs()).fold(0f32, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_cache_expiration_preserves_active_and_newer_work() {
        let cache = Mutex::new(Some(42));
        let version = AtomicU64::new(3);
        assert_eq!(take_idle_cache(&cache, &version, 2), None);
        assert_eq!(*hold(&cache), Some(42));
        let active = hold(&cache);
        assert_eq!(take_idle_cache(&cache, &version, 3), None);
        assert_eq!(*active, Some(42));
        drop(active);
        version.fetch_add(1, Ordering::AcqRel);
        assert_eq!(take_idle_cache(&cache, &version, 3), None);
        assert_eq!(take_idle_cache(&cache, &version, 4), Some(42));
        assert_eq!(*cache.try_lock().expect("destruction runs outside cache lock"), None);
        assert_eq!(take_idle_cache(&cache, &version, 4), None);
    }

    #[test]
    fn stft_round_trip_is_exact() {
        // the spectrum leaves out bins 0..3 and the top one: a signal with nothing there comes back as it was
        let mut st = Stft::new();
        let tone = |f: f32, g: f32| (0..CHUNK).map(|i| (i as f32 * f).sin() * g + (i as f32 * 0.31).sin() * 0.2).collect::<Vec<f32>>();
        let (l, r) = (tone(0.05, 0.3), tone(0.11, 0.25));
        let mut spec = vec![0f32; 4 * DIM_F * DIM_T];
        st.forward([&l, &r], &mut spec);
        let (mut a, mut b) = (vec![0f32; CHUNK], vec![0f32; CHUNK]);
        st.inverse(&spec, [&mut a, &mut b]);
        let err = |x: &[f32], y: &[f32]| x.iter().zip(y).skip(N_FFT).take(CHUNK - 2 * N_FFT).map(|(x, y)| (x - y).abs()).fold(0f32, f32::max);
        assert!(err(&l, &a) < 1e-5 && err(&r, &b) < 1e-5, "max error {} {}", err(&l, &a), err(&r, &b));
    }

    #[test]
    fn chunks_cover_the_song_like_uvr() {
        let (padded, starts) = plan(441_000);
        assert_eq!(starts[1] - starts[0], CHUNK - N_FFT);
        assert!(*starts.last().unwrap() < padded && padded >= 441_000 + 2 * TRIM);
        let mut d = Demix::new(vec![0.0; 441_000], vec![0.0; 441_000]);
        let mut st = Stft::new();
        let zero = vec![0f32; 4 * DIM_F * DIM_T];
        let mut last = 0;
        for k in 0..d.starts.len() {
            let (from, to) = d.add(k, &mut st, &zero);
            assert_eq!(from, last);
            last = to;
        }
        assert_eq!(last, 441_000);
        // a silent model: everything is vocals, the instrumental is silent
        assert_eq!(d.at(0, 1000), (0.0, 0.0));
    }

    #[test]
    fn wav_header_is_float_stereo() {
        let p = std::env::temp_dir().join(format!("halation-stems-{}.wav", std::process::id()));
        write_wav(&p, 3, |c, i| (c * 10 + i) as f32).unwrap();
        let b = fs::read(&p).unwrap();
        // the peak of a mix: 12 + 2 × 12 at the last frame's right channel
        assert_eq!(mix_peak(&[(b.clone(), 1.0), (b.clone(), 2.0)]), 36.0);
        assert_eq!(mix_peak(&[(b.clone(), 1.0)]), 12.0);
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(u16::from_le_bytes([b[20], b[21]]), 3);
        assert_eq!(b.len(), 44 + 3 * 8);
        assert_eq!(f32::from_le_bytes([b[44 + 12], b[45 + 12], b[46 + 12], b[47 + 12]]), 11.0);
        let _ = fs::remove_file(&p);
    }

    /// A local server: path → body, any other path 404
    fn serve(files: Vec<(&'static str, Vec<u8>)>) -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { break };
                let mut req = [0u8; 2048];
                let n = s.read(&mut req).unwrap_or(0);
                let line = String::from_utf8_lossy(&req[..n]);
                let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                match files.iter().find(|(p, _)| *p == path) {
                    Some((_, body)) => {
                        let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                        let _ = s.write_all(body);
                    }
                    None => {
                        let _ = write!(s, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        });
        format!("http://{addr}")
    }

    fn leak(s: String) -> &'static str {
        Box::leak(s.into_boxed_str())
    }

    #[test]
    fn a_wrong_file_falls_back_to_the_mirror_and_two_leave_nothing() {
        let good = b"the right model".to_vec();
        let sha: String = Sha256::digest(&good).iter().map(|b| format!("{b:02x}")).collect();
        let mut zipped = vec![];
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut zipped));
            z.start_file("runtimes/win-x64/native/x.dll", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(&good).unwrap();
            z.finish().unwrap();
        }
        let base = serve(vec![("/bad", b"tampered model!".to_vec()), ("/good", good.clone()), ("/pkg", zipped)]);
        let a = Asset { comp: "t", file: "x.bin", size: good.len() as u64, sha256: leak(sha), sources: &[] };
        let d = std::env::temp_dir().join(format!("halation-verify-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let agent = ureq::Agent::config_builder().build().new_agent();
        let dest = d.join("x.bin");
        // the first source has the right size and the wrong content: the mirror is used
        let bad_then_good = [Source { url: leak(format!("{base}/bad")), inner: None }, Source { url: leak(format!("{base}/good")), inner: None }];
        fetch_verified(&agent, &a, &bad_then_good, &dest, |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), good);
        fs::remove_file(&dest).unwrap();
        // a file inside a package
        let pkg = [Source { url: leak(format!("{base}/missing")), inner: None }, Source { url: leak(format!("{base}/pkg")), inner: Some("runtimes/win-x64/native/x.dll") }];
        fetch_verified(&agent, &a, &pkg, &dest, |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), good);
        fs::remove_file(&dest).unwrap();
        // both wrong: an error and nothing in the folder
        let both_bad = [Source { url: leak(format!("{base}/bad")), inner: None }, Source { url: leak(format!("{base}/missing")), inner: None }];
        let err = fetch_verified(&agent, &a, &both_bad, &dest, |_, _| {}).unwrap_err();
        assert!(err.contains("sha256") && err.contains("404"), "{err}");
        assert_eq!(fs::read_dir(&d).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_runtime_is_the_one_the_crate_speaks() {
        // ort is built with api-24: the DLL downloaded must be onnxruntime 1.24
        assert!(ORT_VERSION.starts_with("1.24."));
        assert!(ASSETS[0].sources[1].url.ends_with(ORT_VERSION));
    }

    #[test]
    fn only_stems_folders_of_the_temp() {
        let temp = std::env::temp_dir().join("halation-temp");
        assert_eq!(out_folder(&temp, "stems-j_000001").unwrap(), temp.join("stems-j_000001"));
        assert_eq!(out_folder(&temp, &temp.join("stems-j_2").to_string_lossy()).unwrap(), temp.join("stems-j_2"));
        assert!(out_folder(&temp, "other").is_err());
        assert!(out_folder(&temp, &temp.parent().unwrap().join("x").join("stems-1").to_string_lossy()).is_err());
        assert!(out_folder(&temp, "stems-../x").is_err());
    }

    /// The model on real audio, against UVR's pipeline in numpy (tests/stems-reference.py writes the reference):
    /// HALATION_ORT (an onnxruntime 1.24 library), HALATION_HQ4 (the model) and HALATION_HQ4_REF (a folder with mix.f32,
    /// inst.f32 written by the script) must be set; skipped otherwise.
    #[test]
    fn matches_the_python_reference() {
        let (Some(lib), Some(model), Some(refd)) = (std::env::var_os("HALATION_ORT"), std::env::var_os("HALATION_HQ4"), std::env::var_os("HALATION_HQ4_REF")) else {
            eprintln!("skipped: HALATION_ORT, HALATION_HQ4 and HALATION_HQ4_REF not set");
            return;
        };
        let read = |n: &str| -> Vec<f32> { fs::read(Path::new(&refd).join(n)).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect() };
        let (mix, inst) = (read("mix.f32"), read("inst.f32"));
        let n = mix.len() / 2;
        let (l, r): (Vec<f32>, Vec<f32>) = (0..n).map(|i| (mix[2 * i], mix[2 * i + 1])).unzip();
        load_runtime(Path::new(&lib)).unwrap();
        let dir = std::env::temp_dir().join(format!("halation-sep-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let opts = ort::session::RunOptions::new().unwrap();
        let mut seen = 0;
        let o = separate((Path::new(&model), Model::Hq4), false, (l.clone(), r.clone()), &dir, &opts, || false, |step| {
            if let Step::Chunk { from, peaks, .. } = step {
                assert_eq!(from, seen);
                seen += peaks[0].len();
            }
        })
        .unwrap();
        assert_eq!(seen, n.div_ceil(BUCKET));
        let wav = |f: &str| -> Vec<f32> { fs::read(dir.join(f)).unwrap()[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect() };
        let (gi, gv) = (wav("instrumental.wav"), wav("vocals.wav"));
        let num: f64 = gi.iter().zip(&inst).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
        let den: f64 = inst.iter().map(|b| (*b as f64).powi(2)).sum();
        let rel = (num / den).sqrt();
        assert!(rel < 1e-3, "relative error {rel}");
        // vocals + instrumental × 1.019… gives the mix back: vocals = mix − instrumental
        let back: f64 = (0..n).map(|i| ((gv[2 * i] + gi[2 * i] - l[i]) as f64).powi(2)).sum::<f64>() / n as f64;
        let power: f64 = l.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / n as f64;
        assert!(10.0 * (back / power).log10() < -60.0);
        eprintln!("{} s of audio: model {:.1} s, STFT {:.1} s", n / RATE as usize, o.model_s, o.dsp_s);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn demucs_segments_cover_the_song() {
        // 20 s: segments at 0, 5.85 s, 11.7 s, 17.55 s; the last is short and centred with the song before it
        let n = 882_000;
        let mut d = Demucs::new((0..n).map(|i| (i as f32 * 0.01).sin()).collect(), vec![0.0; n]);
        assert_eq!(d.offsets, vec![0, D_STRIDE, 2 * D_STRIDE, 3 * D_STRIDE]);
        let (off, len, start) = d.span(3);
        assert_eq!((off, len), (3 * D_STRIDE, n - 3 * D_STRIDE));
        assert_eq!(start, off as isize - ((SEGMENT - len) / 2) as isize);
        // a model that gives back nothing: every sample gets weight, and the song's mean comes back
        let zeros = [vec![0f32; 16 * D_BINS * D_FRAMES], vec![0f32; 8 * SEGMENT]];
        let ends: Vec<usize> = (0..4).map(|k| d.add(k, &zeros)).collect();
        assert_eq!(ends, vec![D_STRIDE, 2 * D_STRIDE, 3 * D_STRIDE, n]);
        assert!(d.sw.iter().all(|w| *w > 0.0));
        assert!((d.at(3, 1, 1000) - d.mean).abs() < 1e-6);
        assert_eq!(d.input(0)[1].2.len(), 4 * D_BINS * D_FRAMES);
    }

    /// HTDemucs on real audio against demucs itself (tests/stems-reference.py --htdemucs writes drums.f32… beside
    /// mix.f32): HALATION_ORT, HALATION_HTDEMUCS (the ONNX of app/scripts/htdemucs-export.py) and HALATION_HQ4_REF.
    #[test]
    fn matches_demucs() {
        let (Some(lib), Some(model), Some(refd)) = (std::env::var_os("HALATION_ORT"), std::env::var_os("HALATION_HTDEMUCS"), std::env::var_os("HALATION_HQ4_REF")) else {
            eprintln!("skipped: HALATION_ORT, HALATION_HTDEMUCS and HALATION_HQ4_REF not set");
            return;
        };
        let read = |n: &str| -> Vec<f32> { fs::read(Path::new(&refd).join(n)).unwrap().chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect() };
        let mix = read("mix.f32");
        let n = mix.len() / 2;
        let (l, r): (Vec<f32>, Vec<f32>) = (0..n).map(|i| (mix[2 * i], mix[2 * i + 1])).unzip();
        load_runtime(Path::new(&lib)).unwrap();
        let dir = std::env::temp_dir().join(format!("halation-demucs-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let opts = ort::session::RunOptions::new().unwrap();
        let mut seen = 0;
        let o = separate((Path::new(&model), Model::Demucs), false, (l, r), &dir, &opts, || false, |step| {
            if let Step::Chunk { from, peaks, .. } = step {
                assert_eq!(peaks.len(), 4);
                assert_eq!(from, seen);
                seen += peaks[0].len();
            }
        })
        .unwrap();
        assert_eq!(seen, n.div_ceil(BUCKET));
        for t in DEMUCS_SOURCES {
            let want = read(&format!("{t}.f32"));
            let got: Vec<f32> = fs::read(dir.join(format!("{t}.wav"))).unwrap()[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
            let num: f64 = got.iter().zip(&want).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
            let den: f64 = want.iter().map(|b| (*b as f64).powi(2)).sum();
            let rel = (num / den).sqrt();
            eprintln!("{t}: relative error {rel:.1e}");
            assert!(rel < 1e-3, "{t}: relative error {rel}");
        }
        eprintln!("{} s of audio: model {:.1} s, STFT {:.1} s", n / RATE as usize, o.model_s, o.dsp_s);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Which part of HTDemucs DirectML refuses (Windows, a DirectX 12 GPU): the whole model at each optimisation level,
    /// then each probe of HALATION_DML_PROBES (one ONNX per distinct operator, attributes and shapes of the model, made
    /// by vocal-remover/make_probes.py). Results in <probes>\dml-probe.txt. HALATION_ORT, HALATION_HTDEMUCS and
    /// HALATION_DML_PROBES must be set; run with `cargo test --release dml_probe -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dml_probe() {
        use ort::session::{builder::GraphOptimizationLevel as L, Session};
        let (Some(lib), Some(model), Some(probes)) = (std::env::var_os("HALATION_ORT"), std::env::var_os("HALATION_HTDEMUCS"), std::env::var_os("HALATION_DML_PROBES")) else {
            eprintln!("skipped: HALATION_ORT, HALATION_HTDEMUCS and HALATION_DML_PROBES not set");
            return;
        };
        load_runtime(Path::new(&lib)).unwrap();
        let dml = |file: &Path, level: L| -> Result<(), String> {
            let b = Session::builder().map_err(|x| x.to_string())?.with_optimization_level(level).map_err(|x| x.to_string())?;
            let ep = ort::ep::DirectML::default().build().error_on_failure();
            let mut b = b.with_memory_pattern(false).map_err(|x| x.to_string())?.with_parallel_execution(false).map_err(|x| x.to_string())?.with_execution_providers([ep]).map_err(|x| x.to_string())?;
            b.commit_from_file(file).map(|_| ()).map_err(|x| x.to_string())
        };
        // each line written at once: a crash of the runtime still leaves what came before
        let out = Path::new(&probes).join("dml-probe.txt");
        let _ = fs::remove_file(&out);
        let line = |s: String| {
            use std::io::Write;
            eprintln!("{s}");
            let mut f = fs::OpenOptions::new().create(true).append(true).open(&out).unwrap();
            writeln!(f, "{s}").unwrap();
        };
        let first = |e: &str| e.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" | ");
        for (name, level) in [("disabled", L::Disable), ("level1", L::Level1), ("level2", L::Level2), ("level3", L::Level3)] {
            let r = dml(Path::new(&model), level);
            line(format!("model {name}: {}", r.as_ref().map(|_| "OK".to_string()).unwrap_or_else(|e| format!("FAIL {}", first(e)))));
        }
        let mut files: Vec<PathBuf> = fs::read_dir(&probes).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "onnx")).collect();
        files.sort();
        let mut failed = 0;
        for f in &files {
            eprintln!("{}", f.display());
            if let Err(e) = dml(f, L::Level3) {
                failed += 1;
                line(format!("probe {}: FAIL {}", f.file_name().unwrap().to_string_lossy(), first(&e)));
            }
        }
        line(format!("{} probes, {failed} refused", files.len()));
    }

    /// Whether DirectML runs HTDemucs right (Windows, a DirectX 12 GPU): the first chunk of a song on the CPU, then on
    /// DirectML at each optimisation level; per output, how far it is from the CPU's, and how far the four tracks are
    /// from the song (off_mix). HALATION_ORT and HALATION_HTDEMUCS must be set; HALATION_SONG (any audio, decoded with
    /// HALATION_FFMPEG or ffmpeg on the PATH) is optional (else a made-up mix). Results in HALATION_OUT\dml-check.txt
    /// (else the temp folder); HALATION_TAPS (optional) adds the comparison along the graph, HALATION_TAPS_ONLY skips
    /// the whole model. Run with
    /// `cargo test --release dml_check -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dml_check() {
        use ort::session::{builder::GraphOptimizationLevel as L, Session};
        let (Some(lib), Some(model)) = (std::env::var_os("HALATION_ORT"), std::env::var_os("HALATION_HTDEMUCS")) else {
            eprintln!("skipped: HALATION_ORT and HALATION_HTDEMUCS not set");
            return;
        };
        let model = PathBuf::from(model);
        load_runtime(Path::new(&lib)).unwrap();
        let out = std::env::var_os("HALATION_OUT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("dml-check.txt");
        let _ = fs::remove_file(&out);
        let line = |s: String| {
            use std::io::Write;
            eprintln!("{s}");
            let mut f = fs::OpenOptions::new().create(true).append(true).open(&out).unwrap();
            writeln!(f, "{s}").unwrap();
        };
        let (l, r) = match std::env::var("HALATION_SONG") {
            Ok(song) => {
                let ff = std::env::var_os("HALATION_FFMPEG").map(PathBuf::from).unwrap_or_else(|| "ffmpeg".into());
                let (l, r, _) = decode(&ff, &song).unwrap();
                line(format!("song {song}: {:.1} s", l.len() as f64 / RATE as f64));
                (l, r)
            }
            Err(_) => {
                line("a made-up mix (HALATION_SONG not set)".into());
                let f = |i: usize, hz: f64| (2.0 * std::f64::consts::PI * hz * i as f64 / RATE as f64).sin();
                (0..SEGMENT)
                    .map(|i| {
                        let beat = if i % 22050 < 2000 { ((i * 7919) % 1000) as f64 / 500.0 - 1.0 } else { 0.0 };
                        let x = 0.3 * f(i, 55.0) + 0.2 * f(i, 440.0) * f(i, 3.0) + 0.3 * beat;
                        ((x * 0.9) as f32, (x * 0.8) as f32)
                    })
                    .unzip()
            }
        };
        let mut d = Demucs::new(l, r);
        let input = d.input(0);
        let opts = ort::session::RunOptions::new().unwrap();
        let mut cpu = Engine { session: session(&model, false).unwrap(), gpu: false, model: model.clone() };
        let want = infer(&mut cpu, &input, &opts).unwrap();
        drop(cpu);
        let to = d.add(0, &want);
        line(format!("cpu: tracks {:.4} off the song", d.off_mix(to)));
        // HALATION_TAPS_ONLY: straight to the comparison along the graph
        let levels = if std::env::var_os("HALATION_TAPS_ONLY").is_some() {
            vec![]
        } else {
            vec![("disabled", L::Disable), ("level1", L::Level1), ("level2", L::Level2), ("level3", L::Level3)]
        };
        for (name, level) in levels {
            let s = (|| -> Result<Session, String> {
                let b = Session::builder().map_err(|x| x.to_string())?.with_optimization_level(level).map_err(|x| x.to_string())?;
                let ep = ort::ep::DirectML::default().with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance).build().error_on_failure();
                let mut b = b.with_memory_pattern(false).map_err(|x| x.to_string())?.with_parallel_execution(false).map_err(|x| x.to_string())?.with_execution_providers([ep]).map_err(|x| x.to_string())?;
                b.commit_from_file(&model).map_err(|x| x.to_string())
            })();
            let mut e = match s {
                Ok(s) => Engine { session: s, gpu: true, model: model.clone() },
                Err(e) => {
                    line(format!("dml {name}: no session: {}", e.lines().next().unwrap_or("")));
                    continue;
                }
            };
            let t0 = Instant::now();
            let got = match infer(&mut e, &input, &opts) {
                Ok(g) => g,
                Err(x) => {
                    line(format!("dml {name}: run failed: {}", x.lines().next().unwrap_or("")));
                    continue;
                }
            };
            let secs = t0.elapsed().as_secs_f64();
            let mut parts = vec![];
            for (i, (g, w)) in got.iter().zip(&want).enumerate() {
                let nan = g.iter().filter(|v| !v.is_finite()).count();
                let num: f64 = g.iter().zip(w).filter(|(a, _)| a.is_finite()).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
                let den: f64 = w.iter().map(|b| (*b as f64).powi(2)).sum();
                let top = g.iter().filter(|v| v.is_finite()).fold(0f32, |m, v| m.max(v.abs()));
                let wtop = w.iter().fold(0f32, |m, v| m.max(v.abs()));
                parts.push(format!("out{i} rel {:.2e} max {top:.3} (cpu {wtop:.3}) non-finite {nan}", (num / den.max(1e-12)).sqrt()));
            }
            d.clear();
            let to = d.add(0, &got);
            line(format!("dml {name}: {secs:.1} s, tracks {:.4} off the song; {}", d.off_mix(to), parts.join("; ")));
        }
        // HALATION_TAPS: the same model with outputs along the graph (vocal-remover/taps.py); each one on DirectML
        // against the CPU, in the graph's order, and the first that departs
        let Some(taps) = std::env::var_os("HALATION_TAPS").map(PathBuf::from) else { return };
        // the outputs a dozen at a time: the runtime may leave one unset (the crate panics on it), then that dozen one
        // by one, the one left unset reported as unreadable
        let tensor = |(_, shape, data): &Input| ort::value::Tensor::from_array((shape.clone(), data.clone())).unwrap();
        let some = |s: &mut Session, which: &[String]| -> Option<Vec<Option<Vec<f32>>>> {
            let sel = which.iter().fold(ort::session::OutputSelector::no_default(), |o, n| o.with(n.as_str()));
            let ro = ort::session::RunOptions::new().ok()?.with_outputs(sel);
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let out = s.run_with_options(ort::inputs![input[0].0 => tensor(&input[0]), input[1].0 => tensor(&input[1])], &ro).ok()?;
                Some(which.iter().map(|n| out.get(n.as_str()).and_then(|v| v.try_extract_tensor::<f32>().ok().map(|(_, d)| d.to_vec()))).collect())
            }))
            .ok()
            .flatten()
        };
        let run = |s: &mut Session, names: &[String]| -> Result<Vec<Option<Vec<f32>>>, String> {
            let mut all = vec![];
            for part in names.chunks(12) {
                match some(s, part) {
                    Some(v) => all.extend(v),
                    None => {
                        for n in part {
                            all.push(some(s, std::slice::from_ref(n)).and_then(|mut v| v.pop().flatten()));
                        }
                    }
                }
            }
            Ok(all)
        };
        let mut cpu = session(&taps, false).unwrap();
        let names: Vec<String> = cpu.outputs().iter().map(|o| o.name().to_string()).collect();
        let want = run(&mut cpu, &names).unwrap();
        drop(cpu);
        line(format!("taps cpu: {} outputs, {} unreadable", want.len(), want.iter().filter(|w| w.is_none()).count()));
        for (name, level) in [("level3", L::Level3), ("disabled", L::Disable)] {
            let s = (|| -> Result<Session, String> {
                let b = Session::builder().map_err(|x| x.to_string())?.with_optimization_level(level).map_err(|x| x.to_string())?;
                let ep = ort::ep::DirectML::default().with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance).build().error_on_failure();
                let mut b = b.with_memory_pattern(false).map_err(|x| x.to_string())?.with_parallel_execution(false).map_err(|x| x.to_string())?.with_execution_providers([ep]).map_err(|x| x.to_string())?;
                b.commit_from_file(&taps).map_err(|x| x.to_string())
            })();
            let mut e = match s {
                Ok(s) => s,
                Err(e) => {
                    line(format!("taps {name}: no session: {}", e.lines().next().unwrap_or("")));
                    continue;
                }
            };
            let got = match run(&mut e, &names) {
                Ok(g) => g,
                Err(x) => {
                    line(format!("taps {name}: run failed: {}", x.lines().next().unwrap_or("")));
                    continue;
                }
            };
            drop(e);
            let mut first = None;
            for (i, (g, w)) in got.iter().zip(&want).enumerate() {
                let (Some(g), Some(w)) = (g, w) else {
                    line(format!("taps {name} {i:3} {}: unreadable", names[i]));
                    continue;
                };
                let nan = g.iter().filter(|v| !v.is_finite()).count();
                let num: f64 = g.iter().zip(w).filter(|(a, _)| a.is_finite()).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
                let den: f64 = w.iter().map(|b| (*b as f64).powi(2)).sum();
                let rel = (num / den.max(1e-12)).sqrt();
                line(format!("taps {name} {i:3} {}: rel {rel:.2e} non-finite {nan}", names[i]));
                if first.is_none() && (rel > 1e-2 || nan > 0) {
                    first = Some(format!("{i} {} (rel {rel:.2e}, non-finite {nan})", names[i]));
                }
            }
            line(format!("taps {name}: first output off: {}", first.unwrap_or_else(|| "none".into())));
        }
    }

    /// Small pieces of HTDemucs (vocal-remover/dml-check: one ONNX each, fixed shapes) on DirectML against the CPU, with
    /// the same made-up inputs: per output, how far DirectML is. HALATION_ORT and HALATION_DML_PIECES (the folder) must
    /// be set; results in <pieces>\dml-pieces.txt. Run with `cargo test --release dml_pieces -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dml_pieces() {
        use ort::session::{builder::GraphOptimizationLevel as L, Session};
        let (Some(lib), Some(dir)) = (std::env::var_os("HALATION_ORT"), std::env::var_os("HALATION_DML_PIECES")) else {
            eprintln!("skipped: HALATION_ORT and HALATION_DML_PIECES not set");
            return;
        };
        load_runtime(Path::new(&lib)).unwrap();
        let out = Path::new(&dir).join("dml-pieces.txt");
        let _ = fs::remove_file(&out);
        let line = |s: String| {
            use std::io::Write;
            eprintln!("{s}");
            let mut f = fs::OpenOptions::new().create(true).append(true).open(&out).unwrap();
            writeln!(f, "{s}").unwrap();
        };
        let mut files: Vec<PathBuf> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "onnx")).collect();
        files.sort();
        let opts = ort::session::RunOptions::new().unwrap();
        // every output, each read on its own (one left unset is None)
        type Outs = Vec<(String, Option<Vec<f32>>)>;
        let run = |s: &mut Session, ins: &[(String, Vec<i64>, Vec<f32>)]| -> Result<Outs, String> {
            let names: Vec<String> = s.outputs().iter().map(|o| o.name().to_string()).collect();
            let mut vals: Vec<(String, ort::session::SessionInputValue)> = vec![];
            for (n, shape, data) in ins {
                vals.push((n.clone(), ort::value::Tensor::from_array((shape.clone(), data.clone())).map_err(|e| e.to_string())?.into()));
            }
            let o = s.run_with_options(vals, &opts).map_err(|e| e.to_string())?;
            Ok(names
                .iter()
                .map(|n| (n.clone(), std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| o.get(n.as_str()).and_then(|v| v.try_extract_tensor::<f32>().ok().map(|(_, d)| d.to_vec())))).ok().flatten()))
                .collect())
        };
        for f in &files {
            let name = f.file_name().unwrap().to_string_lossy().to_string();
            let mut cpu = session(f, false).unwrap();
            // made-up inputs: a fixed sequence in -1..1 per input, the shape the piece declares
            let mut seed = 12345u64;
            let ins: Vec<(String, Vec<i64>, Vec<f32>)> = cpu
                .inputs()
                .iter()
                .map(|i| {
                    let shape: Vec<i64> = i.dtype().tensor_shape().map(|s| s.iter().copied().collect()).unwrap_or_default();
                    let n = shape.iter().product::<i64>().max(0) as usize;
                    let data = (0..n)
                        .map(|_| {
                            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                            ((seed >> 33) as f32 / (1u64 << 31) as f32) * 2.0 - 1.0
                        })
                        .collect();
                    (i.name().to_string(), shape, data)
                })
                .collect();
            let want = run(&mut cpu, &ins).unwrap();
            drop(cpu);
            for (lv, level) in [("disabled", L::Disable), ("level3", L::Level3)] {
                let s = (|| -> Result<Session, String> {
                    let b = Session::builder().map_err(|x| x.to_string())?.with_optimization_level(level).map_err(|x| x.to_string())?;
                    let ep = ort::ep::DirectML::default().with_performance_preference(ort::ep::directml::PerformancePreference::HighPerformance).build().error_on_failure();
                    let mut b = b.with_memory_pattern(false).map_err(|x| x.to_string())?.with_parallel_execution(false).map_err(|x| x.to_string())?.with_execution_providers([ep]).map_err(|x| x.to_string())?;
                    b.commit_from_file(f).map_err(|x| x.to_string())
                })();
                let got = match s.and_then(|mut s| run(&mut s, &ins)) {
                    Ok(g) => g,
                    Err(e) => {
                        line(format!("{name} {lv}: {}", e.lines().next().unwrap_or("")));
                        continue;
                    }
                };
                let parts: Vec<String> = got
                    .iter()
                    .zip(&want)
                    .map(|((n, g), (_, w))| match (g, w) {
                        (Some(g), Some(w)) => {
                            let num: f64 = g.iter().zip(w).map(|(a, b)| ((a - b) as f64).powi(2)).sum();
                            let den: f64 = w.iter().map(|b| (*b as f64).powi(2)).sum();
                            format!("{n} {:.1e}", (num / den.max(1e-12)).sqrt())
                        }
                        _ => format!("{n} unreadable"),
                    })
                    .collect();
                line(format!("{name} {lv}: {}", parts.join(", ")));
            }
        }
    }
}
