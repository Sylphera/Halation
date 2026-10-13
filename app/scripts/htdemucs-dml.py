# HTDemucs for DirectML (stems.rs, component stems-htdemucs, release stems-v3), from htdemucs-export.py's file (stems-v2):
# DirectML refuses the time decoder's 1-D ConvTranspose and Reshape with allowzero 1 (dml_probe in stems.rs, AMD RX 6650 XT,
# 2026-10-07). The 1-D ConvTranspose become 2-D of height 1, allowzero 0 (no shape holds a 0): same weights, the same
# outputs bit for bit on the CPU. stems-v4: every Split as Slices, as DirectML fuses Split → Sigmoid → Mul wrong (the
# GLUs: tracks thousands of times too loud). Needs: onnx, numpy.  Usage: python app/scripts/htdemucs-dml.py <in.onnx> <out.onnx>
import onnx, sys, numpy as np
from onnx import helper, numpy_helper
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
shapes = onnx.shape_inference.infer_shapes(m).graph
dims = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim] for v in list(shapes.value_info) + list(shapes.input)}
g = m.graph
inits = {i.name: i for i in g.initializer}
nodes = []; n1d = 0; nrz = 0; nsplit = 0
def const(name, arr): g.initializer.append(numpy_helper.from_array(np.asarray(arr, np.int64), name))
const("dml_axis2", [2])
for n in g.node:
    if n.op_type == "Reshape":
        for a in n.attribute:
            if a.name == "allowzero" and a.i == 1:
                sh = inits.get(n.input[1])
                assert sh is not None and 0 not in numpy_helper.to_array(sh).tolist(), n.name
                a.i = 0; nrz += 1
    if n.op_type == "ConvTranspose":
        k = [a for a in n.attribute if a.name == "kernel_shape"][0].ints
        if len(k) == 1:
            w = inits[n.input[1]]; wa = numpy_helper.to_array(w)
            w2 = numpy_helper.from_array(wa[:, :, None, :], w.name + "_2d"); g.initializer.append(w2)
            x2, y2 = n.input[0] + "_2d_" + n.name, n.output[0] + "_2d"
            nodes.append(helper.make_node("Unsqueeze", [n.input[0], "dml_axis2"], [x2], name=n.name + "_unsq"))
            attrs = {}
            for a in n.attribute:
                v = helper.get_attribute_value(a)
                if a.name in ("kernel_shape", "strides", "dilations", "output_padding"): v = [1 if a.name != "output_padding" else 0] + list(v)
                if a.name == "pads": v = [0, v[0], 0, v[1]]
                if isinstance(v, bytes): v = v.decode()
                attrs[a.name] = v
            nodes.append(helper.make_node("ConvTranspose", [x2, w2.name] + list(n.input[2:]), [y2], name=n.name + "_2d", **attrs))
            nodes.append(helper.make_node("Squeeze", [y2, "dml_axis2"], [n.output[0]], name=n.name + "_sq"))
            n1d += 1; continue
    # stems-v4: DirectML fuses Split → Sigmoid → Mul (the GLUs) and gets it wrong (dml_pieces in stems.rs: right when
    # the Sigmoid's output is asked for, or the Split is two Slices). Each Split as one Slice per part: the same values
    if n.op_type == "Split":
        axis = next((a.i for a in n.attribute if a.name == "axis"), 0)
        if len(n.input) > 1 and n.input[1]:
            sizes = numpy_helper.to_array(inits[n.input[1]]).tolist()
        else:
            k = next(a.i for a in n.attribute if a.name == "num_outputs"); total = dims[n.input[0]][axis]
            assert total % k == 0, n.name; sizes = [total // k] * k
        at = 0
        for j, (y, size) in enumerate(zip(n.output, sizes)):
            p = f"{n.name}_s{j}"
            const(p + "_st", [at]); const(p + "_en", [at + size]); const(p + "_ax", [axis])
            nodes.append(helper.make_node("Slice", [n.input[0], p + "_st", p + "_en", p + "_ax"], [y], name=p))
            at += size
        nsplit += 1; continue
    nodes.append(n)
del g.node[:]; g.node.extend(nodes)
# the old 1-D weights are no longer used
used = {i for n in g.node for i in n.input}
keep = [i for i in g.initializer if i.name in used]; del g.initializer[:]; g.initializer.extend(keep)
onnx.checker.check_model(m)
onnx.save(m, dst)
print("convtranspose 1d→2d:", n1d, "reshape allowzero→0:", nrz, "split→slice:", nsplit)
