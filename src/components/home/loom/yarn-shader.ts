// GLSL for the yarn. Every thread is a tube whose centre line is computed in the vertex shader, so the
// whole tangle-to-cloth morph costs two draw calls (fill + inverted-hull ink outline) and no CPU work.
// The curve here mirrors `threadPoint` in weave.ts: change both together.

export const YARN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uP;
uniform float uRadius;
uniform float uOutline;
uniform float uSpacing;
uniform float uLanes;
uniform float uCloth;
uniform float uTangleR;
uniform vec2 uTangleC;
uniform float uWave;
uniform vec2 uPointer;
uniform float uPush;

attribute float aT;
attribute float aAngle;
attribute float aKind;
attribute float aLane;
attribute vec4 aSeed;
attribute vec2 aWindow;
attribute vec3 aColor;

varying vec3 vColor;
varying vec3 vNormal;
varying float vT;
varying float vAngle;
varying vec2 vCloth;

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

vec3 tangle(float t) {
  float a = t * TAU * 0.94;
  float f1 = 2.0 + floor(aSeed.x * 3.0);
  float f2 = 3.0 + floor(aSeed.y * 3.0);
  float f3 = 1.0 + floor(aSeed.z * 4.0);
  float r = (0.74 + 0.26 * sin(a * (f1 + f2) + aSeed.z * TAU)) * uTangleR;
  return vec3(
    sin(a * f1 + aSeed.w * TAU + uTime * 0.23) * r + uTangleC.x,
    sin(a * f2 + aSeed.x * TAU - uTime * 0.19) * r * 0.86 + uTangleC.y,
    cos(a * f3 + aSeed.y * TAU + uTime * 0.15) * r * 0.7
  );
}

vec3 woven(float t) {
  float half_ = (uLanes - 1.0) * 0.5;
  float along = (t - 0.5) * uCloth;
  float lanePos = (aLane - half_) * uSpacing;
  float crossing = along / uSpacing + half_;
  float inside = smoothstep(-0.9, -0.1, crossing) * smoothstep(uLanes - 0.1, uLanes - 0.9, crossing);
  float parity = mod(aLane, 2.0) < 0.5 ? 1.0 : -1.0;
  float z = cos(PI * crossing) * parity * uRadius * 1.12 * inside;
  return aKind < 0.5 ? vec3(lanePos, along, z) : vec3(along, lanePos, -z);
}

vec3 curve(float t, float w) {
  vec3 a = tangle(t);
  vec3 b = woven(t);
  vec3 p = mix(a, b, w);
  p.z += sin(w * PI) * 0.9;
  // Cloth ripples like a flag once it is woven.
  p.z += uWave * w * sin(b.x * 1.1 + b.y * 0.7 + uTime * 1.4) * 0.1;
  // Loose yarn shies away from the pointer.
  vec2 d = p.xy - uPointer;
  float f = uPush * exp(-dot(d, d) / 0.55) * (1.0 - w);
  p.xy += normalize(d + vec2(1e-4)) * f * 0.55;
  p.z += f * 0.35;
  return p;
}

void main() {
  float x = clamp((uP - aWindow.x) / aWindow.y, 0.0, 1.0);
  float w = x * x * (3.0 - 2.0 * x);
  vec3 c0 = curve(aT, w);
  vec3 c1 = curve(aT + 0.004, w);
  vec3 T = normalize(c1 - c0);
  vec3 N = normalize(cross(T, normalize(vec3(0.21, 0.37, 0.9))));
  vec3 B = cross(T, N);
  float taper = smoothstep(0.0, 0.012, aT) * smoothstep(1.0, 0.988, aT);
  vec3 n = cos(aAngle) * N + sin(aAngle) * B;
  vec3 pos = c0 + n * (uRadius * (0.3 + 0.7 * taper) + uOutline);
  vColor = aColor;
  vNormal = normalMatrix * n;
  vT = aT;
  vAngle = aAngle;
  vCloth = woven(aT).xy / uCloth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

/**
 * Cel shading: three hard tones, a ply stripe so it reads as twisted yarn, one specular streak, and a band
 * of light that crosses the finished cloth corner to corner (uSheen is its position; far off when unused).
 */
export const YARN_FRAGMENT = /* glsl */ `
uniform vec3 uLight;
uniform float uSheen;
varying vec2 vCloth;
varying vec3 vColor;
varying vec3 vNormal;
varying float vT;
varying float vAngle;

void main() {
  float d = dot(normalize(vNormal), normalize(uLight));
  float tone = d > 0.25 ? 1.0 : d > -0.3 ? 0.8 : 0.6;
  float ply = fract(vAngle / 6.28318530718 * 2.0 + vT * 46.0);
  float stripe = smoothstep(0.0, 0.08, ply) * smoothstep(0.5, 0.42, ply);
  vec3 col = vColor * tone * (0.88 + 0.12 * stripe);
  col += step(0.9, d) * 0.16;
  col += smoothstep(0.17, 0.0, abs(vCloth.x + vCloth.y - uSheen)) * 0.2;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export const INK_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() {
  gl_FragColor = vec4(uInk, 1.0);
  #include <colorspace_fragment>
}
`;
