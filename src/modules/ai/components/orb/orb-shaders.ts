// GLSL for the App Orb: one draw call of points (app dots + filler dots) on a sphere.
// Ripple constants (9 rings, 0.6 falloff) and the app-dot radial terms mirror
// orb-layout.ts / OrbStage.tsx so DOM labels and hit-testing track their dots.

// 3D simplex noise: Ashima Arts / Stefan Gustavson (MIT), webgl-noise.
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const DOTS_VERTEX = /* glsl */ `
attribute float aApp;
attribute float aSeed;
uniform mat3 uRot;
uniform float uTime;
uniform float uClock;
uniform float uAmp;
uniform float uRipple;
uniform float uRipplePhase;
uniform float uLevel;
uniform float uContract;
uniform float uSwirl;
uniform float uJitter;
uniform float uScatter;
uniform float uIntro;
uniform float uPx;
uniform float uAppSize;
uniform float uStretch;
uniform vec3 uOmega;
// xyz = object-space normal of the hovered app dot, w = its bulge (0..1, springy). B is the one fading out.
uniform vec4 uHotA;
uniform vec4 uHotB;
varying float vApp;
varying float vAlpha;
varying float vBright;
varying float vMix;
varying vec2 vDir;
varying float vSmear;
${SIMPLEX}
vec3 hash3(float s) { return fract(sin(vec3(s * 127.1, s * 311.7, s * 74.7)) * 43758.5453); }

// Filler dots part around a bulging app dot, with a ripple running outward.
vec3 part(vec3 p, vec4 hot, inout float radial) {
  float d = dot(p, hot.xyz);
  float w = smoothstep(0.5, 1.0, d) * hot.w;
  if (w < 0.0005) return p;
  float a = acos(clamp(d, -1.0, 1.0));
  radial -= 0.05 * w;
  radial += 0.03 * hot.w * sin(a * 14.0 - uClock * 5.0) * smoothstep(0.2, 0.9, d);
  return normalize(p + normalize(p - hot.xyz * d + 1e-5) * 0.22 * w);
}
float bulge(vec3 p, vec4 hot) { return hot.w * step(0.9999, dot(p, hot.xyz)); }

void main() {
  vec3 p = position;
  float radial = 1.0;
  float size = 1.0;
  float n1 = 0.0;
  if (aApp < 0.5) {
    // Thinking: a twist about the vertical axis.
    float tw = uSwirl * (0.55 * sin(uClock * 1.3 + p.y * 2.6) + p.y * 0.8);
    float c = cos(tw), s = sin(tw);
    p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
    p = part(p, uHotA, radial);
    p = part(p, uHotB, radial);
    n1 = snoise(p * 1.6 + vec3(0.0, 0.0, uTime));
    radial += n1 * uAmp + snoise(p * 3.2 - vec3(uTime * 0.7)) * uAmp * 0.35;
    radial += uLevel * 0.12 * snoise(p * 4.0 + vec3(uClock * 2.3));
  } else {
    float b = bulge(p, uHotA) + bulge(p, uHotB);
    radial += b * 0.2;
    size = uAppSize * (1.0 + 0.6 * b) * (1.0 + 0.12 * sin(uClock * 1.6 + aSeed * 6.2832));
  }
  vec3 r = uRot * p;
  float a = acos(clamp(r.z, -1.0, 1.0));
  radial += uRipple * 0.07 * sin(a * 9.0 - uRipplePhase) * exp(-a * 0.6);
  radial += uLevel * 0.1;
  radial *= 1.0 - uContract * 0.14;
  // Typing: a light jitter band sweeping up and down.
  float bd = (r.y - 0.7 * sin(uClock * 0.9)) * 5.0;
  float band = exp(-bd * bd);
  radial += uJitter * band * 0.035 * sin(aSeed * 90.0 + uClock * 22.0) * (1.0 - aApp);
  vec3 pos = r * radial;
  // Error: scatter (app dots only move radially so their labels stay true).
  vec3 dir = mix(normalize(r + (hash3(aSeed) - 0.5) * 1.4), r, aApp);
  pos += dir * uScatter * mix(0.15 + 0.5 * aSeed, 0.15, aApp);
  // Entrance: fly in from a scattered cloud, staggered, with a small overshoot.
  float t = clamp((uIntro - aSeed * 0.45) / 0.55, 0.0, 1.0) - 1.0;
  float e = 1.0 + 2.70158 * t * t * t + 1.70158 * t * t;
  pos = mix((hash3(aSeed + 0.37) - 0.5) * vec3(7.0, 5.0, 4.0), pos, e);

  float zf = clamp(r.z * 0.5 + 0.5, 0.0, 1.0);
  vApp = aApp;
  vAlpha = mix(mix(0.1, 0.9, pow(zf, 1.5)), mix(0.22, 1.0, zf), aApp) * min(1.0, (t + 1.0) * 2.5);
  vBright = 0.75 + 0.35 * n1;
  vMix = clamp(0.5 + 0.35 * r.y + 0.4 * n1, 0.0, 1.0);
  // Streak along the dot's own screen motion while the sphere spins.
  vec2 vel = cross(uOmega, r).xy;
  float sp = length(vel);
  vDir = sp > 1e-4 ? vel / sp : vec2(1.0, 0.0);
  vSmear = uStretch * sp;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = size * mix(0.55, 1.15, zf) * uPx * (7.5 / -mv.z) * (1.0 + vSmear);
  gl_Position = projectionMatrix * mv;
}
`;

export const DOTS_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAppCore;
uniform vec3 uErrColor;
uniform float uGlow;
uniform float uErr;
uniform float uFill;
varying float vApp;
varying float vAlpha;
varying float vBright;
varying float vMix;
varying vec2 vDir;
varying float vSmear;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float d = length(vec2(dot(c, vDir), dot(c, vec2(-vDir.y, vDir.x)) * (1.0 + vSmear)));
  if (d > 1.0) discard;
  vec3 col;
  float alpha;
  if (vApp > 0.5) {
    // Solid core with a soft glow around it.
    float core = smoothstep(0.36, 0.28, d);
    float glow = pow(1.0 - d, 2.0) * (0.45 + 0.5 * uGlow);
    col = mix(uColorB, uAppCore, core);
    alpha = (core + glow * (1.0 - core)) * vAlpha;
  } else {
    col = mix(uColorA, uColorB, vMix) * mix(1.0, vBright, 0.6);
    alpha = smoothstep(1.0, 0.5, d) * vAlpha * uFill * (0.7 + 0.5 * uGlow) * vBright;
  }
  col = mix(col, uErrColor, uErr * 0.8);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
