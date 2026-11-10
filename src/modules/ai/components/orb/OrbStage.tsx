"use client";

/* eslint-disable react-hooks/immutability -- useFrame mutates three.js uniforms, refs and DOM styles by design (imperative per-frame loop) */

// The orb itself: ONE draw call of points (app dots + filler dots) and the
// per-frame loop that drives it: AI state -> dot motion, sphere rotation
// (wheel momentum -> springy snap, drag inertia, eased idle spin), app-dot
// screen positions for hit-testing and the hovered dot's DOM label.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, NormalBlending, ShaderMaterial, Vector3, Vector4 } from "three";
import {
  coastDistance, dotField, frontIndex, idleEase, nearestAngle, rippleHeight, rotateYX, scatterEnvelope, spinStretch,
  springStep, waveFor, type OrbState, type Vec3,
} from "./orb-layout";
import { DOTS_FRAGMENT, DOTS_VERTEX } from "./orb-shaders";
import { ORB_ERROR } from "./orb-theme";

/** Live inputs written outside React: mic loudness (0..1) and a keystroke pulse. */
export interface OrbSignals {
  level: number;
  pulse: number;
}

export interface OrbShared {
  rot: { y: number; x: number; vy: number; vx: number; dragging: boolean };
  /** Rotation the sphere springs to (wheel snap, keyboard focus, search). */
  target: { ry: number; rx: number } | null;
  hovered: number | null;
  /** performance.now() of the last wheel/drag/hover/focus input, and of the last wheel event. */
  lastInput: number;
  wheelAt: number;
  /** Wheel momentum in flight: snap to the nearest app dot once it slows. */
  coasting: boolean;
  /** A wheel snap or a touch tap holds the highlight for this long after the last input (0 = pointer/focus owns it). */
  holdMs: number;
  /** Decaying wave pulse sent through the dots on a snap. */
  kick: number;
  /** [x, y, z] per app dot: screen px and depth, refreshed every frame. */
  screen: Float32Array;
  /** Reduced motion renders on demand; inputs call this. */
  invalidate: () => void;
}

export const CAMERA_Z = 7.5;
export const FOV = 45;
const FILLER_DOTS = 1100;
/** Sphere radius as a share of the smaller canvas side. */
const RADIUS_SHARE = 0.37;
const AUTO_SPIN = 0.12;
/** Exponential friction on free spin (1/s). */
const FRICTION = 2.4;
/** Below this speed (rad/s) a wheel spin hands over to the snap spring. */
const SNAP_SPEED = 0.9;
const WHEEL_QUIET_MS = 90;
const ENTRANCE_S = 1.6;
/** Filler dot diameter in CSS px on a 250px-radius sphere. */
const DOT_PX = 5;
/** App dot sprite (core + glow) relative to a filler dot. */
const APP_DOT_SIZE = 4.8;
// Mirror the app-dot terms in orb-shaders.ts.
const HOT_PUSH = 0.2;
const CONTRACT = 0.14;
const LEVEL_PUSH = 0.1;
const RIPPLE_PUSH = 0.07;
const SCATTER_PUSH = 0.15;

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
/** Screen px per world unit at the sphere's centre plane. */
const pxPerWorldUnit = (h: number) => h / (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360));
const worldRadius = (w: number, h: number) => (RADIUS_SHARE * Math.min(w, h)) / pxPerWorldUnit(h);

interface Props {
  count: number;
  state: OrbState;
  reduced: boolean;
  dark: boolean;
  accent: readonly [string, string];
  shared: React.RefObject<OrbShared>;
  signals: React.RefObject<OrbSignals>;
  label: React.RefObject<HTMLElement | null>;
  glow: React.RefObject<HTMLElement | null>;
  /** Highlight app dot i and spring it to the front (null releases the highlight). */
  onSnap: (i: number | null) => void;
}

export function OrbStage({ count, state, reduced, dark, accent, shared, signals, label, glow, onSnap }: Props) {
  const stateRef = useRef(state);
  const snapRef = useRef(onSnap);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    stateRef.current = state;
    snapRef.current = onSnap;
    shared.current.invalidate = invalidate;
    invalidate();
  });

  const field = useMemo(() => dotField(count, FILLER_DOTS), [count]);
  const geo = useMemo(() => {
    const all = [...field.apps, ...field.filler];
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(all.flat()), 3));
    g.setAttribute("aApp", new BufferAttribute(new Float32Array(all.map((_, i) => (i < count ? 1 : 0))), 1));
    // Golden-ratio sequence: a stable, well-mixed 0..1 seed per dot.
    g.setAttribute("aSeed", new BufferAttribute(new Float32Array(all.map((_, i) => (i * 0.61803398875) % 1)), 1));
    return g;
  }, [field, count]);
  useEffect(() => () => geo.dispose(), [geo]);
  const u = useMemo(
    () => ({
      uRot: { value: new Matrix3() }, uTime: { value: 0 }, uClock: { value: 0 }, uAmp: { value: 0.035 }, uRipple: { value: 0 },
      uRipplePhase: { value: 0 }, uLevel: { value: 0 }, uContract: { value: 0 }, uSwirl: { value: 0 }, uJitter: { value: 0 },
      uScatter: { value: 0 }, uIntro: { value: 0 }, uPx: { value: 1 }, uAppSize: { value: APP_DOT_SIZE }, uStretch: { value: 0 }, uOmega: { value: new Vector3() },
      uHotA: { value: new Vector4() }, uHotB: { value: new Vector4() }, uGlow: { value: 0.35 }, uErr: { value: 0 }, uFill: { value: 1 },
      uColorA: { value: new Color() }, uColorB: { value: new Color() }, uAppCore: { value: new Color() }, uErrColor: { value: new Color(ORB_ERROR) },
    }),
    [],
  );
  // Built by hand so the uniform objects written each frame are the ones the material reads.
  const mat = useMemo(
    () => new ShaderMaterial({ vertexShader: DOTS_VERTEX, fragmentShader: DOTS_FRAGMENT, uniforms: u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    [u],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    mat.blending = dark ? AdditiveBlending : NormalBlending;
    // Dark: light dots add up on black. Light: deep, saturated dots on the pale page.
    u.uColorA.value.set(accent[0]).lerp(new Color(accent[1]), dark ? 0.5 : 0);
    u.uColorB.value.set(accent[1]).lerp(new Color(dark ? "#ffffff" : accent[0]), dark ? 0.2 : 0.45);
    u.uAppCore.value.set(dark ? "#ffffff" : accent[0]).lerp(new Color(accent[1]), dark ? 0.25 : 0);
    u.uFill.value = dark ? 1.25 : 1.6;
  }, [accent, dark, u, mat]);

  const local = useRef({ errT: 0, intro: 0, ripple: 0, idle: 0, hot: null as number | null, hotV: 0 });
  const m4 = useMemo(() => [new Matrix4(), new Matrix4()] as const, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now();
    const { width: W, height: H } = size;
    const sh = shared.current;
    const sig = signals.current;
    const lo = local.current;
    const st = stateRef.current;
    const wave = waveFor(st);
    const live = reduced ? 0 : 1;
    const ease = (k: number) => (reduced ? 1 : dt * k);
    const r = sh.rot;

    // Rotation: spring to a target, else momentum; a slowing wheel spin snaps to the app dot it would stop on.
    if (sh.target) {
      if (reduced) {
        r.y = sh.target.ry;
        r.x = sh.target.rx;
        r.vy = r.vx = 0;
      } else {
        const sy = springStep(r.y, r.vy, sh.target.ry, dt);
        const sx = springStep(r.x, r.vx, sh.target.rx, dt);
        r.y = sy.x; r.vy = sy.v; r.x = sx.x; r.vx = sx.v;
      }
    } else if (!r.dragging) {
      r.y += r.vy * dt;
      r.x += r.vx * dt;
      r.vy *= Math.exp(-dt * FRICTION);
      r.vx *= Math.exp(-dt * FRICTION);
      if (sh.coasting && now - sh.wheelAt > WHEEL_QUIET_MS && Math.hypot(r.vy, r.vx) < SNAP_SPEED) {
        sh.coasting = false;
        snapRef.current(frontIndex(field.apps, r.y + coastDistance(r.vy, FRICTION), r.x + coastDistance(r.vx, FRICTION)));
      }
    }
    if (sh.holdMs > 0 && now - sh.lastInput > sh.holdMs) snapRef.current(null);
    // Idle auto-rotation eases back in ~2 s after the last input; the tilt levels out with it.
    const resting = sh.hovered === null && !sh.target && !r.dragging && !sh.coasting;
    lo.idle = resting ? idleEase((now - sh.lastInput) / 1000) : lerp(lo.idle, 0, dt * 8);
    r.y += dt * AUTO_SPIN * wave.spin * live * lo.idle;
    r.x += (nearestAngle(r.x, 0) - r.x) * (1 - Math.exp(-dt * 0.8)) * lo.idle * live;
    const settled = sh.target !== null && Math.hypot(sh.target.ry - r.y, sh.target.rx - r.x) < 0.02;
    const speed = settled || reduced ? 0 : Math.hypot(r.vy, r.vx);

    // AI state -> dot motion, plus mic level, keystroke pulse, spin energy and the snap kick.
    lo.intro = reduced ? ENTRANCE_S * 2 : lo.intro + dt;
    lo.errT = st === "error" ? lo.errT + dt : 0;
    sig.pulse *= Math.exp(-dt * 5);
    sh.kick *= Math.exp(-dt * 2.6);
    const energy = Math.min(speed, 8) * 0.008;
    u.uLevel.value = lerp(u.uLevel.value, sig.level, ease(12));
    u.uAmp.value = lerp(u.uAmp.value, wave.amp + sig.pulse * 0.03 + energy, ease(4));
    u.uGlow.value = lerp(u.uGlow.value, wave.glow + u.uLevel.value * 0.6 + (sig.pulse + sh.kick) * 0.3 + energy * 4, ease(4));
    lo.ripple = lerp(lo.ripple, wave.ripple * live, ease(3));
    u.uRipple.value = lo.ripple + sh.kick * live;
    u.uContract.value = lerp(u.uContract.value, wave.contract, ease(3));
    u.uSwirl.value = lerp(u.uSwirl.value, wave.swirl * live, ease(2.5));
    u.uJitter.value = lerp(u.uJitter.value, wave.jitter * live, ease(5));
    u.uScatter.value = scatterEnvelope(lo.errT) * live;
    u.uErr.value = lerp(u.uErr.value, st === "error" ? 1 : 0, ease(6));
    u.uTime.value += dt * wave.speed * live;
    u.uClock.value += dt * live;
    u.uRipplePhase.value += dt * 5 * live;
    u.uIntro.value = lo.intro / ENTRANCE_S;
    u.uRot.value.setFromMatrix4(m4[0].makeRotationX(r.x).multiply(m4[1].makeRotationY(r.y)));
    // View-space spin axis (direction only; uStretch carries the amount).
    u.uOmega.value.set(r.vx, r.vy * Math.cos(r.x), r.vy * Math.sin(r.x));
    if (u.uOmega.value.lengthSq() > 1e-8) u.uOmega.value.normalize();
    u.uStretch.value = spinStretch(speed) * 4;

    // Hovered app dot: springy bulge on A; the previous one eases back on B.
    const a = u.uHotA.value;
    const b = u.uHotB.value;
    if (lo.hot !== sh.hovered) {
      if (lo.hot !== null && a.w > b.w) b.copy(a);
      lo.hot = sh.hovered;
      const n = lo.hot !== null ? field.apps[lo.hot] : undefined;
      a.set(n?.[0] ?? 0, n?.[1] ?? 0, n?.[2] ?? 0, 0);
      lo.hotV = 0;
    }
    if (reduced) {
      a.w = lo.hot !== null ? 1 : 0;
      b.w = 0;
    } else {
      const s = springStep(a.w, lo.hotV, lo.hot !== null ? 1 : 0, dt);
      a.w = Math.max(0, s.x);
      lo.hotV = s.v;
      b.w = lerp(b.w, 0, dt * 9);
    }

    const pxPerUnit = pxPerWorldUnit(H);
    const Rpx = RADIUS_SHARE * Math.min(W, H);
    const R = worldRadius(W, H);
    // Small spheres (phone, transcript open): finer filler dots, app dots kept findable.
    const dotScale = Math.min(1.3, Math.max(0.45, Rpx / 250));
    u.uPx.value = DOT_PX * dpr * dotScale;
    u.uAppSize.value = APP_DOT_SIZE / Math.sqrt(dotScale);
    if (glow.current) glow.current.style.opacity = String(Math.min(1, 0.45 + u.uGlow.value * 0.6));

    // App dots on the CPU (same radial terms as the shader) for hit-testing and the label.
    const ready = lo.intro >= ENTRANCE_S;
    for (let i = 0; i < field.apps.length; i++) {
      const n: Vec3 = rotateYX(field.apps[i], r.y, r.x);
      const hot = i === lo.hot ? a.w : 0;
      const radial =
        (1 + hot * HOT_PUSH + u.uRipple.value * RIPPLE_PUSH * rippleHeight(n[2], u.uRipplePhase.value) + u.uLevel.value * LEVEL_PUSH) *
          (1 - u.uContract.value * CONTRACT) +
        u.uScatter.value * SCATTER_PUSH;
      const rr = R * radial;
      const persp = CAMERA_Z / (CAMERA_Z - n[2] * rr);
      const px = W / 2 + n[0] * rr * pxPerUnit * persp;
      const py = H / 2 - n[1] * rr * pxPerUnit * persp;
      sh.screen[i * 3] = px;
      sh.screen[i * 3 + 1] = py;
      // Not pickable until the sphere has assembled.
      sh.screen[i * 3 + 2] = ready ? n[2] : -1;
      const el = label.current;
      if (el && i === lo.hot) {
        // Label sits beside the dot, on the side with more room.
        const left = px > W * 0.58;
        el.dataset.side = left ? "left" : "right";
        el.style.transform = `translate(${px}px, ${py}px) translate(${left ? "calc(-100% + 1.25rem)" : "-1.25rem"}, -50%)`;
        el.style.opacity = String(Math.min(1, a.w * 1.4));
      }
    }
  });

  return <points geometry={geo} material={mat} scale={worldRadius(size.width, size.height)} frustumCulled={false} />;
}
