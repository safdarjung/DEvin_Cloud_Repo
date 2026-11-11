// GLSL for the App Orb core, two draw calls: a glass ball with a slow aurora inside
// it, and dust points on a sphere round it (plus a few motes in orbit further out).
// AI state (ripple, contraction, swirl, jitter, scatter), the mic level, a one-shot
// ring of light and the pointer move the surface.

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

// Two far-apart hues (a teal role, a pink mode) meet in grey when mixed: the colour is lifted back where they are most mixed.
const BLEND = /* glsl */ `
vec3 blend(vec3 a, vec3 b, float k) {
  vec3 c = mix(a, b, k);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(vec3(0.0), mix(vec3(l), c, 1.0 + 3.2 * k * (1.0 - k)));
}
`;

export const DOTS_VERTEX = /* glsl */ `
attribute float aSeed;
// 0: dust on the surface · 1: a mote in orbit outside it.
attribute float aShell;
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
// A hovered section: view-space direction (xyz) and strength (w); the dust around it brightens.
uniform vec4 uHot;
// The pointer over the orb: view-space direction (xyz) and strength (w); nearby dust lifts toward it.
uniform vec4 uPtr;
// A ring of light crossing the sphere: its angle from the front pole (x) and strength (y).
uniform vec2 uShock;
// Accumulated orbit angle of the motes (faster while thinking).
uniform float uOrbit;
varying float vAlpha;
varying float vBright;
varying float vMix;
${SIMPLEX}
vec3 hash3(float s) { return fract(sin(vec3(s * 127.1, s * 311.7, s * 74.7)) * 43758.5453); }

void main() {
  // Motes turn about the vertical axis at their own pace.
  float oa = aShell * uOrbit * (0.35 + 0.9 * aSeed);
  float oc = cos(oa), os = sin(oa);
  vec3 p = vec3(position.x * oc + position.z * os, position.y, -position.x * os + position.z * oc);
  float radial = 1.0 + 0.02 * sin(uClock * 1.3);
  // Thinking: a twist about the vertical axis.
  float tw = uSwirl * (0.55 * sin(uClock * 1.3 + p.y * 2.6) + p.y * 0.8);
  float c = cos(tw), s = sin(tw);
  vec3 q = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  float n1 = snoise(q * 1.6 + vec3(0.0, 0.0, uTime));
  radial += n1 * uAmp + snoise(q * 3.2 - vec3(uTime * 0.7)) * uAmp * 0.35;
  radial += uLevel * 0.12 * snoise(q * 4.0 + vec3(uClock * 2.3));
  vec3 r = uRot * q;
  float a = acos(clamp(r.z, -1.0, 1.0));
  radial += uRipple * 0.07 * sin(a * 9.0 - uRipplePhase) * exp(-a * 0.6);
  radial += uLevel * 0.1;
  float shock = uShock.y * exp(-pow((a - uShock.x) * 3.5, 2.0));
  float near = uPtr.w * smoothstep(0.72, 1.0, dot(r, uPtr.xyz)) * (1.0 - aShell);
  radial += shock * 0.09 + near * 0.05;
  radial *= 1.0 - uContract * 0.14;
  radial += aShell * (0.26 + 0.24 * aSeed + 0.03 * sin(uClock * 0.7 + aSeed * 30.0));
  // Typing: a light jitter band sweeping up and down.
  float bd = (r.y - 0.7 * sin(uClock * 0.9)) * 5.0;
  float band = exp(-bd * bd);
  radial += uJitter * band * 0.035 * sin(aSeed * 90.0 + uClock * 22.0);
  vec3 pos = r * radial;
  // Error: scatter and regroup.
  vec3 dir = normalize(r + (hash3(aSeed) - 0.5) * 1.4);
  pos += dir * uScatter * (0.15 + 0.5 * aSeed);
  // Entrance: fly in from a scattered cloud, staggered, with a small overshoot.
  float t = clamp((uIntro - aSeed * 0.45) / 0.55, 0.0, 1.0) - 1.0;
  float e = 1.0 + 2.70158 * t * t * t + 1.70158 * t * t;
  pos = mix((hash3(aSeed + 0.37) - 0.5) * vec3(7.0, 5.0, 4.0), pos, e);

  float zf = clamp(r.z * 0.5 + 0.5, 0.0, 1.0);
  float hot = uHot.w * smoothstep(0.8, 1.0, dot(r, uHot.xyz));
  // Each dot twinkles at its own pace.
  float twinkle = 0.78 + 0.22 * sin(uClock * (1.2 + aSeed * 3.0) + aSeed * 40.0);
  vAlpha = (mix(0.08, 0.6, pow(zf, 1.5)) + hot * 0.35 + near * 0.18 + shock * 0.5) * mix(1.0, 0.7, aShell) * min(1.0, (t + 1.0) * 2.5);
  vBright = (0.75 + 0.35 * n1 + hot * 0.8 + near * 0.3 + shock * 0.9) * twinkle;
  vMix = clamp(0.5 + 0.35 * r.y + 0.4 * n1 + hot * 0.5, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uPx * mix(0.55, 1.15, zf) * (1.0 + hot * 0.7 + near * 0.2 + shock * 0.6) * mix(1.0, 0.8, aShell) * (7.5 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const DOTS_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uErrColor;
uniform float uGlow;
uniform float uErr;
uniform float uFill;
varying float vAlpha;
varying float vBright;
varying float vMix;
${BLEND}
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  vec3 col = mix(blend(uColorA, uColorB, vMix) * mix(1.0, vBright, 0.6), uErrColor, uErr * 0.8);
  float alpha = smoothstep(1.0, 0.5, d) * vAlpha * uFill * (0.7 + 0.5 * uGlow) * vBright;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

export const GLASS_VERTEX = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The ball itself: deeper in the middle, a bright rim (fresnel), a slow aurora that
// turns with the dust, and a highlight from a light that follows the pointer.
export const GLASS_FRAGMENT = /* glsl */ `
uniform mat3 uRot;
uniform float uTime;
uniform float uGlow;
uniform float uErr;
uniform float uSwirl;
uniform float uLevel;
uniform float uIntro;
// Opacity of the middle of the ball (the rim is always solid).
uniform float uCore;
uniform vec3 uGlassA;
uniform vec3 uGlassB;
uniform vec3 uErrColor;
uniform vec3 uLight;
uniform vec4 uHot;
uniform vec2 uShock;
varying vec3 vN;
${SIMPLEX}
${BLEND}
void main() {
  vec3 N = normalize(vN);
  float ndv = clamp(N.z, 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  // The same turn as the dust, undone: the aurora rides the sphere.
  vec3 q = N * uRot;
  float t = uTime * 0.5;
  float n1 = snoise(q * 1.25 + vec3(0.0, t, 0.0));
  float n2 = snoise(q * 2.6 + vec3(n1 * 0.8, -t * 1.3, t));
  float band = smoothstep(-0.3, 0.65, n1 * 0.7 + n2 * 0.3 + q.y * 0.35);
  vec3 col = blend(uGlassA, uGlassB, band) * mix(0.66, 1.0, fres);
  // Thinking: bright veins gather inside.
  col += uGlassB * uSwirl * 0.35 * smoothstep(0.35, 0.9, abs(n2));
  col += uGlassB * fres * (0.4 + 0.8 * uGlow + 0.6 * uLevel);
  vec3 L = normalize(uLight);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col *= mix(0.74, 1.1, 0.5 + 0.5 * dot(N, L));
  float nh = max(dot(N, H), 0.0);
  col += vec3(pow(nh, 90.0) * 1.1 + pow(nh, 10.0) * 0.24);
  float a = acos(clamp(N.z, -1.0, 1.0));
  col += uGlassB * uShock.y * exp(-pow((a - uShock.x) * 3.5, 2.0)) * 0.8;
  col += uGlassB * uHot.w * smoothstep(0.8, 1.0, dot(N, uHot.xyz)) * 0.35;
  col = mix(col, uErrColor * (0.55 + 0.6 * nh), uErr * 0.75);
  // The limb is feathered so the edge never looks cut out.
  float alpha = mix(uCore, 1.0, fres) * smoothstep(0.0, 0.16, ndv) * clamp(uIntro * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
