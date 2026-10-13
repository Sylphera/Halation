# Builds Cutout's model: SAM 2.1 Base+ (Meta, Apache-2.0, https://github.com/facebookresearch/sam2) as ONNX files
# that ONNX Runtime Web can run. Meta's own code at COMMIT and Meta's own checkpoint (sha256 checked), nothing
# converted by third parties.
#
# Two graphs, the same split as Meta's image predictor (sam2_image_predictor.py):
#   encoder  the picture, resized to 1024 × 1024 and normalised → image_embed [1,256,64,64],
#            high_res_feats_0 [1,32,256,256], high_res_feats_1 [1,64,128,128] (set_image, no_mem_embed added)
#   decoder  those + point_coords [B,N,2] (pixels of the 1024 input), point_labels [B,N] (1 subject, 0 background,
#            -1 padding), mask_input [B,1,256,256] (the last answer's logits), has_mask_input [B]
#            → masks [B,4,256,256] (logits: the single mask, then the three of multimask), iou_predictions [B,4],
#            object_score_logits [B,1]. The page picks the mask as _predict does (multimask, or the single mask
#            with the dynamic fallback to multimask when it is unstable).
# The prompt encoder is written out here with the same arithmetic as PromptEncoder._embed_points / _embed_masks
# (the padding point is the page's, as the last point with label -1); every file is checked against PyTorch.
#
# Output in --out: sam21-base-plus-encoder.onnx (float32, the CPU), sam21-base-plus-encoder-fp16.onnx (half
# precision inside, float32 in and out, WebGPU), sam21-base-plus-decoder.onnx (float32), SAM2-LICENSE.txt, and
# each file's size and sha256. --install puts them, with ONNX Runtime Web's WebAssembly, straight into the Cutout
# component's folder (the app's or Halation Preview's), so the model works on this PC without any release.
#
# Needs Python 3.10+, git and: torch torchvision hydra-core iopath pillow numpy onnx onnxscript onnxruntime
# Usage: python app/scripts/sam21-export.py [--out DIR] [--install app|preview] [--weights FILE] [--work DIR]
#        --random: random weights instead of the checkpoint, only to test this script (files named *-random)
import argparse, copy, hashlib, os, shutil, subprocess, sys, urllib.request

REPO = "https://github.com/facebookresearch/sam2"
COMMIT = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
WEIGHTS = "sam2.1_hiera_base_plus.pt"
WEIGHTS_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/" + WEIGHTS
WEIGHTS_SHA256 = "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5"
CONFIG = "configs/sam2.1/sam2.1_hiera_b+.yaml"
ORT_VERSION = "1.30.0"   # must match dist/onnxruntime.js and cutout.rs
WASM = "ort-wasm-simd-threaded.asyncify.wasm"
SIZE = 1024

a = argparse.ArgumentParser()
a.add_argument("--out", default=".")
a.add_argument("--install", choices=["app", "preview"])
a.add_argument("--weights")
a.add_argument("--work", default=os.path.join(os.path.expanduser("~"), ".cache", "halation-sam21"))
a.add_argument("--random", action="store_true")
args = a.parse_args()
if args.install:
    # cutout.rs: Tools\cutout of Documents\Halation (the app) or of %LOCALAPPDATA%\com.halation.preview (Preview)
    if args.install == "app":
        docs = os.path.join(os.path.expanduser("~"), "Documents")
        if os.name == "nt":
            import ctypes, ctypes.wintypes
            buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
            ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf)   # CSIDL_PERSONAL: Documents, OneDrive too
            docs = buf.value or docs
        args.out = os.path.join(docs, "Halation", "Tools", "cutout")
    else:
        args.out = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "com.halation.preview", "Tools", "cutout")
os.makedirs(args.work, exist_ok=True); os.makedirs(args.out, exist_ok=True)
tag = "-random" if args.random else ""


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


# ===== sources =====
src = os.path.join(args.work, "sam2")
if not os.path.isdir(os.path.join(src, ".git")):
    subprocess.check_call(["git", "clone", "-q", REPO, src])
subprocess.check_call(["git", "-C", src, "fetch", "-q", "origin", COMMIT])
subprocess.check_call(["git", "-C", src, "checkout", "-q", "--force", COMMIT])

wpath = None
if not args.random:
    wpath = args.weights or os.path.join(args.work, WEIGHTS)
    if not os.path.isfile(wpath):
        print("downloading", WEIGHTS)
        urllib.request.urlretrieve(WEIGHTS_URL, wpath + ".part"); os.replace(wpath + ".part", wpath)
    digest = sha256(wpath)
    print(f"{WEIGHTS} sha256 {digest}")
    if digest != WEIGHTS_SHA256:
        sys.exit(f"{WEIGHTS}: sha256 does not match")

# ===== model =====
sys.path.insert(0, src); os.chdir(src)
import numpy as np, torch, torch.nn as nn
from PIL import Image
from sam2.build_sam import build_sam2

# build_sam2's defaults, as the image predictor gets them (dynamic multimask settings included, used by the page)
model = build_sam2(CONFIG, wpath, device="cpu", mode="eval")
torch.set_float32_matmul_precision("highest")
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]


class Encoder(nn.Module):
    # set_image: forward_image, _prepare_backbone_features, no_mem_embed on the lowest resolution
    def __init__(self, m, half=False):
        super().__init__(); self.m = m; self.half_ = half
    def forward(self, x):
        if self.half_: x = x.half()
        out = self.m.forward_image(x)
        _, feats, _, _ = self.m._prepare_backbone_features(out)
        feats[-1] = feats[-1] + self.m.no_mem_embed
        sizes = [(256, 256), (128, 128), (64, 64)]
        f = [v.permute(1, 2, 0).reshape(1, -1, *s) for v, s in zip(feats, sizes)]
        if self.half_: f = [v.float() for v in f]
        return f[2], f[0], f[1]


class Decoder(nn.Module):
    # PromptEncoder (points and the mask input, as _embed_points and _embed_masks) + MaskDecoder.predict_masks
    def __init__(self, m):
        super().__init__(); self.pe = m.sam_prompt_encoder; self.dec = m.sam_mask_decoder
    def forward(self, image_embed, high_res_feats_0, high_res_feats_1, point_coords, point_labels, mask_input, has_mask_input):
        pe = self.pe
        c = (point_coords + 0.5) / SIZE
        emb = pe.pe_layer._pe_encoding(c)
        lab = point_labels.unsqueeze(-1)
        emb = torch.where(lab == -1, torch.zeros_like(emb) + pe.not_a_point_embed.weight, emb)
        emb = torch.where(lab == 0, emb + pe.point_embeddings[0].weight, emb)
        emb = torch.where(lab == 1, emb + pe.point_embeddings[1].weight, emb)
        h = has_mask_input.view(-1, 1, 1, 1)
        dense = pe.mask_downscaling(mask_input) * h + (1 - h) * pe.no_mask_embed.weight.view(1, -1, 1, 1)
        b = point_coords.shape[0]
        masks, iou, _, obj = self.dec.predict_masks(
            image_embeddings=image_embed.expand(b, -1, -1, -1), image_pe=pe.get_dense_pe(),
            sparse_prompt_embeddings=emb, dense_prompt_embeddings=dense, repeat_image=False,
            high_res_features=[high_res_feats_0, high_res_feats_1])
        return masks, iou, obj


# ===== the reference: Meta's predictor on a picture of the repository =====
from sam2.sam2_image_predictor import SAM2ImagePredictor
pic = np.array(Image.open(os.path.join(src, "notebooks", "images", "truck.jpg")).convert("RGB"))
ph, pw = pic.shape[:2]
pred = SAM2ImagePredictor(model)
with torch.no_grad():
    pred.set_image(pic)
ref = pred._features
# the predictor's own resize and normalisation (the page does the same with a canvas)
x = pred._transforms(pic)[None]
assert pred._transforms.mean == MEAN and pred._transforms.std == STD
# prompts in the picture's pixels: one click; two subject clicks and one background click
PROMPTS = [([[500, 375]], [1]), ([[500, 375], [1125, 625], [200, 1000]], [1, 1, 0])]


def to_input(pts, labels):
    # as the page does it: picture pixels → the 1024 input, then the padding point
    c = np.array(pts, np.float32) / [pw, ph] * SIZE
    c = np.concatenate([c, [[0, 0]]]).astype(np.float32)[None]
    l = np.array(labels + [-1], np.float32)[None]
    return c, l


def iou(a, b):
    a, b = a > 0, b > 0
    u = np.logical_or(a, b).sum()
    return 1. if not u else np.logical_and(a, b).sum() / u


def check(name, got, want, tol):
    d = float(np.abs(got - want).max() / (np.abs(want).max() + 1e-6))
    print(f"  {name}: relative difference {d:.2e}")
    if d > tol: sys.exit(f"{name} does not match")


import onnx, onnxruntime as ort
names = {"encoder": f"sam21-base-plus-encoder{tag}.onnx", "fp16": f"sam21-base-plus-encoder-fp16{tag}.onnx", "decoder": f"sam21-base-plus-decoder{tag}.onnx"}
paths = {k: os.path.abspath(os.path.join(args.out, v)) for k, v in names.items()}
enc_out = ["image_embed", "high_res_feats_0", "high_res_feats_1"]

# ===== encoder =====
enc = Encoder(model).eval()
with torch.no_grad():
    mine = enc(x)
print("encoder (PyTorch) vs the predictor:")
check("image_embed", mine[0].numpy(), ref["image_embed"].numpy(), 1e-4)
check("high_res_feats_0", mine[1].numpy(), ref["high_res_feats"][0].numpy(), 1e-4)
check("high_res_feats_1", mine[2].numpy(), ref["high_res_feats"][1].numpy(), 1e-4)
with torch.no_grad():
    torch.onnx.export(enc, x, paths["encoder"], opset_version=17, input_names=["input"], output_names=enc_out, dynamo=False)
s = ort.InferenceSession(paths["encoder"], providers=["CPUExecutionProvider"])
feats = s.run(None, {"input": x.numpy()})
print("encoder (ONNX Runtime) vs PyTorch:")
for n, g, w in zip(enc_out, feats, mine): check(n, g, w.numpy(), 1e-3)
del s

# ===== decoder =====
dec = Decoder(model).eval()
c0, l0 = to_input(*PROMPTS[1])
sample = (mine[0], mine[1], mine[2], torch.from_numpy(c0), torch.from_numpy(l0), torch.zeros(1, 1, 256, 256), torch.zeros(1))
dyn = {"point_coords": {0: "b", 1: "n"}, "point_labels": {0: "b", 1: "n"}, "mask_input": {0: "b"}, "has_mask_input": {0: "b"},
       "masks": {0: "b"}, "iou_predictions": {0: "b"}, "object_score_logits": {0: "b"}}
with torch.no_grad():
    torch.onnx.export(dec, sample, paths["decoder"], opset_version=17,
                      input_names=enc_out + ["point_coords", "point_labels", "mask_input", "has_mask_input"],
                      output_names=["masks", "iou_predictions", "object_score_logits"], dynamic_axes=dyn, dynamo=False)
s = ort.InferenceSession(paths["decoder"], providers=["CPUExecutionProvider"])
print("decoder (ONNX Runtime) vs the predictor:")
feed = dict(zip(enc_out, feats))
last = None
for i, (pts, labels) in enumerate(PROMPTS):
    with torch.no_grad():
        want, wiou, wlow = pred.predict(np.array(pts, np.float32), np.array(labels), mask_input=None if last is None else last, multimask_output=True, return_logits=True)
    c, l = to_input(pts, labels)
    mask = np.zeros((1, 1, 256, 256), np.float32) if last is None else last[None].astype(np.float32)
    got = s.run(None, {**feed, "point_coords": c, "point_labels": l, "mask_input": mask, "has_mask_input": np.array([0. if last is None else 1.], np.float32)})
    check(f"prompt {i + 1}, multimask logits", np.clip(got[0][0, 1:], -32, 32), wlow, 1e-3)
    check(f"prompt {i + 1}, iou", got[1][0, 1:], wiou, 1e-3)
    last = wlow[int(np.argmax(wiou))][None]
# several prompts at once (Automatic's grid), each the same as alone
cs, ls = zip(*[to_input([[px, py]], [1]) for px, py in [(300, 300), (900, 500), (1500, 900)]])
got = s.run(None, {**feed, "point_coords": np.concatenate(cs), "point_labels": np.concatenate(ls), "mask_input": np.zeros((3, 1, 256, 256), np.float32), "has_mask_input": np.zeros(3, np.float32)})
for k in range(3):
    one = s.run(None, {**feed, "point_coords": cs[k], "point_labels": ls[k], "mask_input": np.zeros((1, 1, 256, 256), np.float32), "has_mask_input": np.zeros(1, np.float32)})
    check(f"batch item {k + 1}", got[0][k], one[0][0], 1e-3)

# ===== encoder in half precision =====
# exported from the model in half precision; float32 in and out, so the page feeds both files the same way
enc16 = Encoder(copy.deepcopy(model).half(), half=True).eval()
with torch.no_grad():
    torch.onnx.export(enc16, x, paths["fp16"], opset_version=17, input_names=["input"], output_names=enc_out, dynamo=False)
    half = enc16(x)
print("encoder fp16 vs fp32 (PyTorch):")
for n, g, w in zip(enc_out, half, mine):
    if not torch.isfinite(g).all(): sys.exit(f"{n}: fp16 overflows")
    print(f"  {n}: mean difference {(g - w).abs().mean().item():.2e}")
# what matters: the masks the decoder makes from the half precision features
f16 = dict(zip(enc_out, [v.numpy() for v in half]))
for i, (pts, labels) in enumerate(PROMPTS):
    c, l = to_input(pts, labels)
    z = {"point_coords": c, "point_labels": l, "mask_input": np.zeros((1, 1, 256, 256), np.float32), "has_mask_input": np.zeros(1, np.float32)}
    a_, b_ = s.run(None, {**feed, **z})[0][0], s.run(None, {**f16, **z})[0][0]
    agree = min(iou(a_[k], b_[k]) for k in range(4))
    print(f"  prompt {i + 1}: masks from fp16 vs fp32 features, lowest IoU {agree:.4f}")
    if not args.random and agree < 0.97: sys.exit("fp16 drifts too far from fp32")

# ===== licence, runtime, summary =====
files = [paths["encoder"], paths["fp16"], paths["decoder"]]
lic = os.path.join(os.path.abspath(args.out), "SAM2-LICENSE.txt")
shutil.copyfile(os.path.join(src, "LICENSE"), lic)
files.append(lic)
if args.install:
    w = os.path.join(args.out, WASM)
    if not os.path.isfile(w):
        urllib.request.urlretrieve(f"https://cdn.jsdelivr.net/npm/onnxruntime-web@{ORT_VERSION}/dist/{WASM}", w + ".part"); os.replace(w + ".part", w)
    files.append(w)
for f in files:
    print(f"{os.path.basename(f)}  {os.path.getsize(f)} bytes  sha256 {sha256(f)}")
if args.install:
    print("installed in", args.out)
