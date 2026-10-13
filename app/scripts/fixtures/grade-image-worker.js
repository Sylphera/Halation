// A single full-quality source decode; output is transferred and the caller closes this worker.
self.onmessage = async ({ data: { blob } }) => {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none" });
    self.postMessage({ bitmap }, [bitmap]);
  } catch (error) { self.postMessage({ error: String(error) }); }
};
