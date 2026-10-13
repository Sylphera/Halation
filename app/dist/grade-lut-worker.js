// One small LUT request at a time; transferable output, no retained image or GPU resources.
// { def }: a look's RGBA16F LUT (half floats); { parameters }: a classic look's RGBA8 LUT.
import { buildLUT, buildLookLUT } from './grade-color.js';
self.onmessage = ({ data: { id, parameters, def } }) => {
  try { const bytes = def ? buildLookLUT(def) : buildLUT(parameters); self.postMessage({ id, bytes }, [bytes.buffer]); }
  catch (error) { self.postMessage({ id, error: String(error) }); }
};
