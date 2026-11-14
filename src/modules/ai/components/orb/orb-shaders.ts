// GLSL for the App Orb core, two draw calls: a hollow net (the links of a honeycomb
// over a sphere, each a thin quad that faces the screen) and the beads at its joints
// (points, plus a few motes in orbit further out). Nothing fills the ball: the far
// half shows through the near half. Links and beads are placed by one function, so
// they move as one body: AI state (ripple, contraction, swirl, jitter, scatter), the
// mic level, a one-shot ring of light, the pointer (the net lifts toward it), a press
// (it dents) and a hard spin (it lags and flattens) all move the net.

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

// Where a joint (or a mote) is this frame, and how lit it is. Shared by the links and the beads.
const PLACE = /* glsl */ `
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
// A hovered feature dot: view-space direction (xyz) and strength (w); the net around it brightens.
uniform vec4 uHot;
// The pointer over the orb: view-space direction (xyz) and strength (w); the net lifts toward it.
uniform vec4 uPtr;
// A press: view-space direction (xyz) and depth (w); the net dents there, and bulges when w swings below zero on release.
uniform vec4 uPoke;
// A ring of light crossing the sphere from uShockDir: its angle from there (x) and strength (y).
uniform vec2 uShock;
uniform vec3 uShockDir;
// Accumulated orbit angle of the motes (faster while thinking).
uniform float uOrbit;
// How far (radians) the net's middle lags behind its poles: it follows the spin speed on a spring.
uniform float uWhirl;
${SIMPLEX}
vec3 hash3(float s) { return fract(sin(vec3(s * 127.1, s * 311.7, s * 74.7)) * 43758.5453); }

struct Placed {
  vec3 pos;
  // Unit direction in view space (z toward the viewer), before any displacement.
  vec3 r;
  float n1;
  float shock;
  float near;
  float hot;
  // Entrance progress of this joint, 0..1.
  float born;
};

// shell 0: a joint of the net · 1: a mote in orbit outside it.
Placed place(vec3 p0, float seed, float shell) {
  Placed o;
  // Entrance: the net inflates from its top joint down, unwinding as it grows.
  o.born = clamp((uIntro - 0.42 * (0.5 - 0.5 * p0.y) - 0.06 * seed) / 0.52, 0.0, 1.0);
  // Motes turn about the vertical axis at their own pace.
  float oa = shell * uOrbit * (0.35 + 0.9 * seed);
  float oc = cos(oa), os = sin(oa);
  vec3 p = vec3(p0.x * oc + p0.z * os, p0.y, -p0.x * os + p0.z * oc);
  float radial = 1.0 + 0.02 * sin(uClock * 1.3);
  // Thinking: a twist about the vertical axis. A hard spin: the middle lags behind the poles.
  float tw = uSwirl * (0.55 * sin(uClock * 1.3 + p.y * 2.6) + p.y * 0.8) - uWhirl * (1.0 - p.y * p.y) + 2.4 * (1.0 - o.born) * (1.0 - o.born);
  float c = cos(tw), s = sin(tw);
  vec3 q = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  o.n1 = snoise(q * 1.6 + vec3(0.0, 0.0, uTime));
  radial += o.n1 * uAmp + snoise(q * 3.2 - vec3(uTime * 0.7)) * uAmp * 0.35;
  radial += uLevel * 0.12 * snoise(q * 4.0 + vec3(uClock * 2.3));
  vec3 r = uRot * q;
  o.r = r;
  float a = acos(clamp(r.z, -1.0, 1.0));
  radial += uRipple * 0.07 * sin(a * 9.0 - uRipplePhase) * exp(-a * 0.6);
  radial += uLevel * 0.1;
  float sa = acos(clamp(dot(r, uShockDir), -1.0, 1.0));
  o.shock = uShock.y * exp(-pow((sa - uShock.x) * 3.5, 2.0));
  o.near = uPtr.w * smoothstep(0.6, 1.0, dot(r, uPtr.xyz)) * (1.0 - shell);
  float dent = smoothstep(0.3, 1.0, dot(r, uPoke.xyz)) * (1.0 - shell);
  radial += o.shock * 0.09 + o.near * 0.08 - uPoke.w * 0.34 * dent * dent;
  radial *= 1.0 - uContract * 0.14;
  radial += shell * (0.26 + 0.24 * seed + 0.03 * sin(uClock * 0.7 + seed * 30.0));
  // Typing: a light jitter band sweeping up and down.
  float bd = (r.y - 0.7 * sin(uClock * 0.9)) * 5.0;
  radial += uJitter * exp(-bd * bd) * 0.035 * sin(seed * 90.0 + uClock * 22.0);
  // A hard spin also flattens the net, like spun dough.
  float squash = min(0.14, 0.5 * uWhirl * uWhirl);
  vec3 pos = (uRot * (q * vec3(1.0 + 0.5 * squash, 1.0 - squash, 1.0 + 0.5 * squash))) * radial;
  // Error: the joints scatter (the links stretch after them) and regroup.
  vec3 dir = normalize(r + (hash3(seed) - 0.5) * 1.4);
  pos += dir * uScatter * (0.15 + 0.5 * seed);
  float t = o.born - 1.0;
  o.pos = pos * (1.0 + 2.70158 * t * t * t + 1.70158 * t * t);
  o.hot = uHot.w * smoothstep(0.8, 1.0, dot(r, uHot.xyz));
  return o;
}
`;

export const BEAD_VERTEX = /* glsl */ `
attribute float aSeed;
attribute float aShell;
uniform float uPx;
varying float vAlpha;
varying float vBright;
varying float vMix;
${PLACE}
void main() {
  Placed o = place(position, aSeed, aShell);
  float zf = clamp(o.r.z * 0.5 + 0.5, 0.0, 1.0);
  // Each bead twinkles at its own pace.
  float twinkle = 0.78 + 0.22 * sin(uClock * (1.2 + aSeed * 3.0) + aSeed * 40.0);
  vAlpha = (mix(0.1, 0.95, pow(zf, 1.5)) + o.hot * 0.35 + o.near * 0.3 + o.shock * 0.5) * mix(1.0, 0.55, aShell) * min(1.0, o.born * 2.5);
  vBright = (0.75 + 0.35 * o.n1 + o.hot * 0.8 + o.near * 0.4 + o.shock * 0.9) * twinkle;
  vMix = clamp(0.5 + 0.35 * o.r.y + 0.4 * o.n1 + o.hot * 0.5, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(o.pos, 1.0);
  gl_PointSize = uPx * mix(0.5, 1.15, zf) * (1.0 + o.hot * 0.7 + o.near * 0.6 + o.shock * 0.8) * mix(1.0, 0.6, aShell) * (7.5 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const BEAD_FRAGMENT = /* glsl */ `
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
  float alpha = smoothstep(1.0, 0.55, d) * vAlpha * uFill * (0.7 + 0.5 * uGlow) * vBright;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

// One link: a quad from its own joint (position) to the other one (aOther), widened across the screen.
export const LINK_VERTEX = /* glsl */ `
attribute vec3 aOther;
attribute float aSeed;
attribute float aOtherSeed;
// Which end of the link this corner is at (0 or 1), and which side of it (-1 or 1).
attribute float aEnd;
attribute float aSide;
// A random number per link: when its packet of light passes.
attribute float aLink;
// The canvas in device px, and a front link's width in device px.
uniform vec2 uView;
uniform float uWidth;
varying float vT;
varying float vAcross;
varying float vHalf;
varying float vLink;
varying float vAlpha;
varying float vBright;
varying float vMix;
${PLACE}
void main() {
  Placed me = place(position, aSeed, 0.0);
  Placed other = place(aOther, aOtherSeed, 0.0);
  vec4 cm = projectionMatrix * modelViewMatrix * vec4(me.pos, 1.0);
  vec4 cf = projectionMatrix * modelViewMatrix * vec4(other.pos, 1.0);
  // Along the link on screen, always from end 0 to end 1, so the two ends agree on which side is which.
  vec2 along = (cf.xy / cf.w - cm.xy / cm.w) * uView * (1.0 - 2.0 * aEnd);
  along /= max(length(along), 1e-4);
  float zf = clamp(me.r.z * 0.5 + 0.5, 0.0, 1.0);
  // Capped: a hovered dot, the pointer and a ring of light together must not turn the links into bars.
  float lit = min(1.2, me.hot * 0.7 + me.near * 0.5 + me.shock * 0.9);
  vHalf = 0.5 * uWidth * mix(0.5, 1.0, zf) * (1.0 + lit);
  // One more px each side for the soft edge.
  vAcross = aSide * (vHalf + 1.0);
  cm.xy += vec2(-along.y, along.x) * vAcross * 2.0 / uView * cm.w;
  gl_Position = cm;
  vT = aEnd;
  vLink = aLink;
  vAlpha = (mix(0.09, 0.82, pow(zf, 1.6)) + lit * 0.4) * min(1.0, me.born * 2.5);
  vBright = 0.8 + 0.3 * me.n1 + lit * 0.7;
  vMix = clamp(0.5 + 0.35 * me.r.y + 0.4 * me.n1 + me.hot * 0.5, 0.0, 1.0);
}
`;

export const LINK_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uErrColor;
uniform float uGlow;
uniform float uErr;
uniform float uFill;
// Packets of light running along the links: how strong (0..1, the AI at work) and their clock.
uniform float uFlow;
uniform float uFlowT;
varying float vT;
varying float vAcross;
varying float vHalf;
varying float vLink;
varying float vAlpha;
varying float vBright;
varying float vMix;
${BLEND}
void main() {
  float edge = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0);
  // A chain, not a wire: each link stops short of its joints, where the beads sit.
  float ends = smoothstep(0.02, 0.2, vT) * smoothstep(0.02, 0.2, 1.0 - vT);
  float packet = uFlow * smoothstep(0.82, 1.0, 1.0 - abs(fract(vLink * 7.0 + vT * 0.3 - uFlowT) * 2.0 - 1.0));
  vec3 col = mix(blend(uColorA, uColorB, clamp(vMix + packet * 0.6, 0.0, 1.0)) * mix(1.0, vBright, 0.6), uErrColor, uErr * 0.8);
  float alpha = edge * ends * min(1.0, vAlpha * uFill * (0.7 + 0.5 * uGlow) * (1.0 + packet * 2.2));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
