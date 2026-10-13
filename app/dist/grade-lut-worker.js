// One small LUT request at a time; transferable output, no retained image or GPU resources.
import { buildLUT } from './grade-color.js';
self.onmessage = ({ data: { id, parameters } }) => {
  try { const bytes = buildLUT(parameters); self.postMessage({ id, bytes }, [bytes.buffer]); }
  catch (error) { self.postMessage({ id, error: String(error) }); }
};
