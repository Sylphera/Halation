// Shared quiet field; Home Drape does not use it.
window.__softLightGLSL = `
float softHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float softDither(vec2 p) { return softHash(p) + softHash(p + 57.31) - 1.0; }
// The same quiet field in Tools and Welcome. Only Welcome adds the spatial light response.
vec3 softLight(vec2 p, float seconds, float welcome, float opening) {
  vec2 a = (p - vec2(-0.32, 0.335)) * vec2(0.72, 1.15);
  vec2 b = (p - vec2(0.45, -0.12)) * vec2(0.85, 1.05);
  vec3 col = vec3(0.0176, 0.0176, 0.0171);
  vec3 first = mix(vec3(1.0), vec3(0.364706, 0.396078, 0.466667), 0.35);
  vec3 second = mix(vec3(1.0), vec3(0.705882, 0.768627, 0.941176), 0.5);
  col += first * exp(-2.4 * dot(a, a)) * 0.0374;
  col += second * exp(-3.1 * dot(b, b)) * 0.0138;
  // Two broad light volumes: spatial warping, breathing and drift, without visible edges.
  float phase = seconds * 0.174532925;
  float settled = smoothstep(0.35, 1.0, opening);
  vec2 center = vec2(0.30 * sin(phase), 0.40 + 0.16 * sin(phase * 0.83));
  center *= opening;
  vec2 size = mix(vec2(0.52, 0.48), vec2(1.20, 0.92), opening);
  size += settled * vec2(0.25 * sin(phase * 1.13), 0.19 * sin(phase * 0.91));
  vec2 q = (p - center) / size;
  q += settled * vec2(0.22 * sin(q.y * 1.6 + phase), 0.16 * sin(q.x * 1.4 - phase * 0.79));
  float mass = exp(-1.35 * dot(q, q));
  float strength = mix(0.042, 0.022 + 0.007 * sin(phase * 1.07), opening);
  vec2 q2 = (p - vec2(-0.32 * sin(phase * 0.71), -0.13 + 0.22 * sin(phase * 0.93))) / vec2(1.0 + 0.18 * sin(phase), 0.85 + 0.16 * sin(phase * 0.87));
  q2.x += 0.20 * sin(q2.y * 1.5 - phase * 0.91);
  col += (first * mass * strength + second * exp(-1.7 * dot(q2, q2)) * (0.009 - 0.003 * sin(phase * 1.07)) * settled) * welcome;
  return col;
}
vec3 softGrain(vec2 pixel) {
  // Stationary, sub-level quantization dither; no moving noise or particles.
  return vec3(softDither(pixel), softDither(pixel + 13.7), softDither(pixel + 41.9)) / 255.0;
}
`;
