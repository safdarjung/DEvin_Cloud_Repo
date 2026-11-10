// GLSL for the App Orb: one draw call of point sprites on a sphere. Icons (apps and
// AI features) sample a baked atlas; a sparse dust of tiny dots only hints the form.
// Ripple constants (9 rings, 0.6 falloff) and every term that moves an icon mirror
// orb-layout.ts / OrbStage.tsx so the DOM label and hit-testing track the icons.

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
// 0 = dust, 1 = app icon, 2 = AI feature icon.
attribute float aKind;
attribute float aSeed;
attribute float aCell;
attribute vec3 aTint;
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
uniform float uIconPx;
uniform float uStretch;
uniform vec3 uOmega;
// xyz = object-space normal of the hovered icon, w = its bulge (0..1, springy). B is the one fading out.
uniform vec4 uHotA;
uniform vec4 uHotB;
varying float vKind;
varying float vCell;
varying vec3 vTint;
varying float vAlpha;
varying float vBright;
varying float vMix;
varying float vHot;
varying vec2 vDir;
varying float vSmear;
${SIMPLEX}
vec3 hash3(float s) { return fract(sin(vec3(s * 127.1, s * 311.7, s * 74.7)) * 43758.5453); }

// Neighbours part around a bulging icon (icons a little, dust more, with a ripple running outward).
vec3 part(vec3 p, vec4 hot, float icon, inout float radial) {
  float d = dot(p, hot.xyz);
  float w = smoothstep(0.5, 1.0, d) * hot.w * step(d, 0.9999);
  if (w < 0.0005) return p;
  float a = acos(clamp(d, -1.0, 1.0));
  radial -= 0.05 * w;
  radial += 0.03 * hot.w * sin(a * 14.0 - uClock * 5.0) * smoothstep(0.2, 0.9, d) * (1.0 - icon);
  return normalize(p + normalize(p - hot.xyz * d + 1e-5) * mix(0.22, 0.12, icon) * w);
}
float bulge(vec3 p, vec4 hot) { return hot.w * step(0.9999, dot(p, hot.xyz)); }

void main() {
  float icon = step(0.5, aKind);
  vec3 p = position;
  float radial = 1.0 + 0.02 * sin(uClock * 1.3);
  float n1 = 0.0;
  float b = icon * (bulge(p, uHotA) + bulge(p, uHotB));
  // Thinking: a twist about the vertical axis.
  float tw = uSwirl * (0.55 * sin(uClock * 1.3 + p.y * 2.6) + p.y * 0.8);
  float c = cos(tw), s = sin(tw);
  vec3 q = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  q = part(q, uHotA, icon, radial);
  q = part(q, uHotB, icon, radial);
  if (icon < 0.5) {
    n1 = snoise(q * 1.6 + vec3(0.0, 0.0, uTime));
    radial += n1 * uAmp + snoise(q * 3.2 - vec3(uTime * 0.7)) * uAmp * 0.35;
    radial += uLevel * 0.12 * snoise(q * 4.0 + vec3(uClock * 2.3));
  }
  radial += b * 0.2;
  vec3 r = uRot * q;
  float a = acos(clamp(r.z, -1.0, 1.0));
  radial += uRipple * 0.07 * sin(a * 9.0 - uRipplePhase) * exp(-a * 0.6);
  radial += uLevel * 0.1;
  radial *= 1.0 - uContract * 0.14;
  // Typing: a light jitter band sweeping up and down.
  float bd = (r.y - 0.7 * sin(uClock * 0.9)) * 5.0;
  float band = exp(-bd * bd);
  radial += uJitter * band * 0.035 * sin(aSeed * 90.0 + uClock * 22.0) * (1.0 - icon);
  vec3 pos = r * radial;
  // Error: scatter (icons only move radially so their label stays true).
  vec3 dir = mix(normalize(r + (hash3(aSeed) - 0.5) * 1.4), r, icon);
  pos += dir * uScatter * mix(0.15 + 0.5 * aSeed, 0.15, icon);
  // Entrance: fly in from a scattered cloud, staggered, with a small overshoot.
  float t = clamp((uIntro - aSeed * 0.45) / 0.55, 0.0, 1.0) - 1.0;
  float e = 1.0 + 2.70158 * t * t * t + 1.70158 * t * t;
  pos = mix((hash3(aSeed + 0.37) - 0.5) * vec3(7.0, 5.0, 4.0), pos, e);

  float zf = clamp(r.z * 0.5 + 0.5, 0.0, 1.0);
  vKind = aKind;
  vCell = aCell;
  vTint = aTint;
  vHot = b;
  // Back hemisphere dim; the typing band and jitter light icons up a touch.
  vAlpha = mix(mix(0.08, 0.6, pow(zf, 1.5)), mix(0.16, 1.0, smoothstep(0.25, 0.8, zf)), icon) * min(1.0, (t + 1.0) * 2.5);
  vBright = mix(0.75 + 0.35 * n1, 1.0 + 0.25 * uJitter * band, icon);
  vMix = clamp(0.5 + 0.35 * r.y + 0.4 * n1, 0.0, 1.0);
  // Dust streaks along its own screen motion while the sphere spins.
  vec2 vel = cross(uOmega, r).xy;
  float sp = length(vel);
  vDir = sp > 1e-4 ? vel / sp : vec2(1.0, 0.0);
  vSmear = uStretch * sp * (1.0 - icon);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float size = mix(uPx * mix(0.55, 1.15, zf), uIconPx * mix(0.5, 1.0, zf) * (1.0 + 0.55 * b), icon);
  gl_PointSize = size * (7.5 / -mv.z) * (1.0 + vSmear);
  gl_Position = projectionMatrix * mv;
}
`;

export const DOTS_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGrid;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uCard;
uniform vec3 uErrColor;
uniform float uGlow;
uniform float uErr;
uniform float uFill;
varying float vKind;
varying float vCell;
varying vec3 vTint;
varying float vAlpha;
varying float vBright;
varying float vMix;
varying float vHot;
varying vec2 vDir;
varying float vSmear;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  vec3 col;
  float alpha;
  if (vKind > 0.5) {
    // A round chip in the page's card colour with the icon in its tint; AI features carry a ring.
    float d = length(c);
    if (d > 1.0) discard;
    float feature = step(1.5, vKind);
    vec3 tint = mix(vTint, uErrColor, uErr * 0.8) * vBright;
    vec2 uv = c / 0.56 * 0.5 + 0.5;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    // Round first: an interpolated 15.9999 must not straddle two cells.
    float ci = floor(vCell + 0.5);
    vec2 cell = vec2(mod(ci, uGrid), floor(ci / uGrid));
    float mask = texture2D(uAtlas, (cell + clamp(uv, 0.0, 1.0)) / uGrid).a * inside;
    float ring = smoothstep(0.80, 0.86, d) * mix(0.35, 1.0, feature);
    col = mix(uCard, tint, 0.10 + 0.05 * feature + 0.08 * vHot);
    col = mix(col, tint, max(mask, ring));
    alpha = smoothstep(1.0, 0.94, d) * vAlpha;
  } else {
    c.y = -c.y;
    float d = length(vec2(dot(c, vDir), dot(c, vec2(-vDir.y, vDir.x)) * (1.0 + vSmear)));
    if (d > 1.0) discard;
    col = mix(mix(uColorA, uColorB, vMix) * mix(1.0, vBright, 0.6), uErrColor, uErr * 0.8);
    alpha = smoothstep(1.0, 0.5, d) * vAlpha * uFill * (0.7 + 0.5 * uGlow) * vBright;
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
