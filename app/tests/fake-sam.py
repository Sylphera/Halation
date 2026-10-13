# Builds the tests' stand-ins for Cutout's SAM 2.1 files (app/scripts/sam21-export.py), with the same inputs and
# outputs, small and fast on ONNX Runtime Web's CPU backend:
#   fake-sam-encoder.onnx  the picture averaged per cell into the three feature maps (channels 0–2: R, G, B)
#   fake-sam-decoder.onnx  logits = 6·(R − B) (what is redder than blue is the subject), plus ±30 under each point
#                          (a Gaussian, σ = 6 of 256: subject points +, background points −), plus half the last
#                          answer; the four masks are the same, every score 0.9, the object score 10
# Needs: onnx, numpy.  Usage: python app/tests/fake-sam.py
import os, numpy as np, onnx
from onnx import helper as h, TensorProto as T, numpy_helper as nh

here = os.path.dirname(os.path.abspath(__file__))
F = T.FLOAT


def const(name, arr):
    return h.make_node("Constant", [], [name], value=nh.from_array(np.asarray(arr, np.float32 if np.asarray(arr).dtype.kind == "f" else np.int64), name))


def save(graph, file):
    m = h.make_model(graph, opset_imports=[h.make_opsetid("", 17)], producer_name="halation-tests")
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, os.path.join(here, file))


# ===== encoder =====
nodes, outs = [], []
for name, k, ch, size in [("image_embed", 16, 256, 64), ("high_res_feats_0", 4, 32, 256), ("high_res_feats_1", 8, 64, 128)]:
    nodes += [h.make_node("AveragePool", ["input"], [name + "_rgb"], kernel_shape=[k, k], strides=[k, k]),
              const(name + "_pads", [0, 0, 0, 0, 0, ch - 3, 0, 0]),
              h.make_node("Pad", [name + "_rgb", name + "_pads"], [name])]
    outs.append(h.make_tensor_value_info(name, F, [1, ch, size, size]))
save(h.make_graph(nodes, "fake-sam-encoder", [h.make_tensor_value_info("input", F, [1, 3, 1024, 1024])], outs), "fake-sam-encoder.onnx")

# ===== decoder =====
ys, xs = np.mgrid[0:256, 0:256].astype(np.float32)
nodes = [
    const("s0", [0]), const("s1", [1]), const("s2", [2]), const("s3", [3]), const("ax1", [1]),
    h.make_node("Slice", ["high_res_feats_0", "s0", "s1", "ax1"], ["r"]),
    h.make_node("Slice", ["high_res_feats_0", "s2", "s3", "ax1"], ["b"]),
    h.make_node("Sub", ["r", "b"], ["rb"]), const("six", 6.), h.make_node("Mul", ["rb", "six"], ["base"]),
    # the points, at the 256 grid's pixel centres
    const("quarter", 0.25), const("half", 0.5), h.make_node("Mul", ["point_coords", "quarter"], ["pc"]), h.make_node("Sub", ["pc", "half"], ["pc0"]),
    const("ax2", [2]), h.make_node("Slice", ["pc0", "s0", "s1", "ax2"], ["px"]), h.make_node("Slice", ["pc0", "s1", "s2", "ax2"], ["py"]),
    const("u2", [2, 3]), h.make_node("Unsqueeze", ["px", "u2"], ["px4"]), h.make_node("Unsqueeze", ["py", "u2"], ["py4"]),
    const("gx", xs[None, None, None]), const("gy", ys[None, None, None]),
    h.make_node("Sub", ["gx", "px4"], ["dx"]), h.make_node("Sub", ["gy", "py4"], ["dy"]),
    h.make_node("Mul", ["dx", "dx"], ["dx2"]), h.make_node("Mul", ["dy", "dy"], ["dy2"]), h.make_node("Add", ["dx2", "dy2"], ["d2"]),
    const("k", -1. / (2 * 6 * 6)), h.make_node("Mul", ["d2", "k"], ["e"]), h.make_node("Exp", ["e"], ["g"]),   # [B,N,1,256,256]
    # weight per point: +1 subject, −1 background, 0 padding
    const("two", 2.), const("one", 1.), const("zero", 0.),
    h.make_node("Mul", ["point_labels", "two"], ["l2"]), h.make_node("Sub", ["l2", "one"], ["w0"]),
    h.make_node("GreaterOrEqual", ["point_labels", "zero"], ["real"]), h.make_node("Cast", ["real"], ["realf"], to=F),
    h.make_node("Mul", ["w0", "realf"], ["w"]), const("u3", [2, 3, 4]), h.make_node("Unsqueeze", ["w", "u3"], ["w5"]),
    h.make_node("Mul", ["g", "w5"], ["wg"]), h.make_node("ReduceSum", ["wg", "ax1"], ["bump0"], keepdims=0),   # [B,1,256,256]
    const("amp", 30.), h.make_node("Mul", ["bump0", "amp"], ["bump"]),
    # half the last answer
    const("u123", [1, 2, 3]), h.make_node("Unsqueeze", ["has_mask_input", "u123"], ["hm"]),
    h.make_node("Mul", ["mask_input", "hm"], ["mi"]), h.make_node("Mul", ["mi", "half"], ["mih"]),
    h.make_node("Add", ["base", "bump"], ["l0"]), h.make_node("Add", ["l0", "mih"], ["l1"]),
    h.make_node("Concat", ["l1", "l1", "l1", "l1"], ["masks"], axis=1),
    h.make_node("Shape", ["point_labels"], ["shp"]), h.make_node("Slice", ["shp", "s0", "s1"], ["bdim"]),
    const("four", [4]), h.make_node("Concat", ["bdim", "four"], ["ishape"], axis=0), const("nine", [[0.9]]), h.make_node("Expand", ["nine", "ishape"], ["iou_predictions"]),
    h.make_node("Concat", ["bdim", "s1"], ["oshape"], axis=0), const("ten", [[10.]]), h.make_node("Expand", ["ten", "oshape"], ["object_score_logits"]),
]
inputs = [h.make_tensor_value_info("image_embed", F, [1, 256, 64, 64]), h.make_tensor_value_info("high_res_feats_0", F, [1, 32, 256, 256]),
          h.make_tensor_value_info("high_res_feats_1", F, [1, 64, 128, 128]), h.make_tensor_value_info("point_coords", F, ["b", "n", 2]),
          h.make_tensor_value_info("point_labels", F, ["b", "n"]), h.make_tensor_value_info("mask_input", F, ["b", 1, 256, 256]),
          h.make_tensor_value_info("has_mask_input", F, ["b"])]
outputs = [h.make_tensor_value_info("masks", F, ["b", 4, 256, 256]), h.make_tensor_value_info("iou_predictions", F, ["b", 4]),
           h.make_tensor_value_info("object_score_logits", F, ["b", 1])]
save(h.make_graph(nodes, "fake-sam-decoder", inputs, outputs), "fake-sam-decoder.onnx")
