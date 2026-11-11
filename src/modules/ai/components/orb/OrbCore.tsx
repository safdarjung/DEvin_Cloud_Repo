"use client";

/* eslint-disable react-hooks/immutability -- useFrame mutates three.js uniforms by design (imperative per-frame loop) */

// The living orb: a glass ball with an aurora inside and dust points round it (two
// draw calls) whose motion follows the AI state (idle / listening / thinking /
// answering / proposing / waiting / done / error). The highlight follows the pointer
// and a ring of light crosses the ball on a send, a mode change and an approval.
// Decoration only: the page works without it (no WebGL, reduced motion), so nothing
// here takes input. It renders inside motion's frame loop (frameloop "never" +
// advance), so the page runs one requestAnimationFrame loop, paused when the tab is
// hidden or the orb is off-screen.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, advance, useFrame, useThree } from "@react-three/fiber";
import { cancelFrame, frame, type FrameData } from "motion/react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, NormalBlending, ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4 } from "three";
import { fibonacciSphere, pointerDir, scatterEnvelope, shockAt, waveFor, type OrbState } from "./orb-layout";
import { DOTS_FRAGMENT, DOTS_VERTEX, GLASS_FRAGMENT, GLASS_VERTEX } from "./orb-shaders";
import { ORB_ERROR } from "./orb-theme";

/**
 * Live inputs written outside React: mic loudness (0..1), a keystroke/hover pulse, the sphere's spin (radians, OrbBody),
 * the hovered section (view-space x, y, z and 0..1 strength), `shock` (set to 1 to send one ring of light across the ball)
 * and the mouse over the orb (x, y in the ball's own -1..1 square with y up, then 1 while it is there).
 */
export interface OrbSignals {
  level: number;
  pulse: number;
  spin: number;
  hot: [number, number, number, number];
  shock: number;
  ptr: [number, number, number];
}

const CAMERA_Z = 7.5;
const FOV = 45;
const DOTS = 760;
/** Sparse dots in orbit outside the dust. */
const MOTES = 70;
/** Dust radius as a share of the canvas (the canvas is 1.4x the stage, so the motes have room). */
const RADIUS_SHARE = 0.32;
/** The glass ball's radius as a share of the dust's. */
const GLASS_SHARE = 0.86;
/** Light from the top left; it leans toward the pointer. */
const LIGHT: readonly [number, number, number] = [-0.5, 0.6, 0.65];
/** The entrance ring fires as the dust lands. */
const FIRST_SHOCK_S = -0.85;
const AUTO_SPIN = 0.12;
const ENTRANCE_S = 1.1;
const DOT_PX = 2.4;
const MAX_DPR = 1.5;

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const pxPerWorldUnit = (h: number) => h / (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360));

interface Props {
  state: OrbState;
  dark: boolean;
  accent: readonly [string, string];
  signals: React.RefObject<OrbSignals>;
}

function Dust({ state, dark, accent, signals }: Props) {
  const stateRef = useRef(state);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    stateRef.current = state;
  });
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    const pts = [...fibonacciSphere(DOTS), ...fibonacciSphere(MOTES)];
    g.setAttribute("position", new BufferAttribute(new Float32Array(pts.flat()), 3));
    g.setAttribute("aSeed", new BufferAttribute(new Float32Array(pts.map((_, i) => (i * 0.61803398875) % 1)), 1));
    g.setAttribute("aShell", new BufferAttribute(new Float32Array(pts.map((_, i) => (i < DOTS ? 0 : 1))), 1));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ball = useMemo(() => new SphereGeometry(1, 64, 48), []);
  useEffect(() => () => ball.dispose(), [ball]);
  const u = useMemo(
    () => ({
      uRot: { value: new Matrix3() }, uTime: { value: 0 }, uClock: { value: 0 }, uAmp: { value: 0.035 }, uRipple: { value: 0 },
      uRipplePhase: { value: 0 }, uLevel: { value: 0 }, uContract: { value: 0 }, uSwirl: { value: 0 }, uJitter: { value: 0 },
      uScatter: { value: 0 }, uIntro: { value: 0 }, uPx: { value: 1 }, uGlow: { value: 0.35 }, uErr: { value: 0 }, uFill: { value: 1 }, uHot: { value: new Vector4(0, 0, 1, 0) },
      uColorA: { value: new Color() }, uColorB: { value: new Color() }, uErrColor: { value: new Color(ORB_ERROR) },
      uPtr: { value: new Vector4(0, 0, 1, 0) }, uShock: { value: new Vector2() }, uOrbit: { value: 0 }, uCore: { value: 0.7 },
      uGlassA: { value: new Color() }, uGlassB: { value: new Color() }, uLight: { value: new Vector3(...LIGHT) },
    }),
    [],
  );
  // Both materials read the same uniform objects: one write per frame moves the ball and the dust together.
  const mat = useMemo(
    () => new ShaderMaterial({ vertexShader: DOTS_VERTEX, fragmentShader: DOTS_FRAGMENT, uniforms: u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    [u],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const glass = useMemo(
    () => new ShaderMaterial({ vertexShader: GLASS_VERTEX, fragmentShader: GLASS_FRAGMENT, uniforms: u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    [u],
  );
  useEffect(() => () => glass.dispose(), [glass]);
  // Mode/theme changes ease the colours over in the frame loop instead of snapping.
  const target = useMemo(() => ({ a: new Color(), b: new Color(), ga: new Color(), gb: new Color(), first: true }), []);
  useEffect(() => {
    target.a.set(accent[0]).lerp(new Color(accent[1]), dark ? 0.5 : 0);
    target.b.set(accent[1]).lerp(new Color(accent[0]), dark ? 0 : 0.45);
    target.ga.set(accent[0]);
    target.gb.set(accent[1]);
    if (target.first) {
      u.uColorA.value.copy(target.a);
      u.uColorB.value.copy(target.b);
      u.uGlassA.value.copy(target.ga);
      u.uGlassB.value.copy(target.gb);
      target.first = false;
    }
    u.uFill.value = dark ? 1.4 : 2.2;
    u.uCore.value = dark ? 0.72 : 0.8;
    // Dark: the dust adds light, so it glows over the ball.
    mat.blending = dark ? AdditiveBlending : NormalBlending;
  }, [accent, dark, u, target, mat]);

  const local = useRef({ intro: 0, errT: 0, ripple: 0, ry: 0, shockT: FIRST_SHOCK_S, ptrK: 0, light: [...LIGHT] as [number, number, number] });
  const m4 = useMemo(() => [new Matrix4(), new Matrix4()] as const, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const lo = local.current;
    const sig = signals.current;
    const st = stateRef.current;
    const wave = waveFor(st);
    lo.intro += dt;
    lo.errT = st === "error" ? lo.errT + dt : 0;
    sig.pulse *= Math.exp(-dt * 5);
    u.uLevel.value = lerp(u.uLevel.value, sig.level, dt * 12);
    u.uAmp.value = lerp(u.uAmp.value, wave.amp + sig.pulse * 0.03, dt * 4);
    u.uGlow.value = lerp(u.uGlow.value, wave.glow + u.uLevel.value * 0.6 + sig.pulse * 0.3, dt * 4);
    lo.ripple = lerp(lo.ripple, wave.ripple, dt * 3);
    u.uRipple.value = lo.ripple;
    u.uContract.value = lerp(u.uContract.value, wave.contract, dt * 3);
    u.uSwirl.value = lerp(u.uSwirl.value, wave.swirl, dt * 2.5);
    u.uJitter.value = lerp(u.uJitter.value, wave.jitter, dt * 5);
    u.uScatter.value = scatterEnvelope(lo.errT);
    u.uErr.value = lerp(u.uErr.value, st === "error" ? 1 : 0, dt * 6);
    u.uTime.value += dt * wave.speed;
    u.uClock.value += dt;
    u.uRipplePhase.value += dt * 5;
    u.uIntro.value = lo.intro / ENTRANCE_S;
    u.uColorA.value.lerp(target.a, Math.min(1, dt * 4));
    u.uColorB.value.lerp(target.b, Math.min(1, dt * 4));
    u.uGlassA.value.lerp(target.ga, Math.min(1, dt * 4));
    u.uGlassB.value.lerp(target.gb, Math.min(1, dt * 4));
    // A ring of light: taken once from the signal, then it runs its course.
    if (sig.shock > 0) {
      lo.shockT = 0;
      sig.shock = 0;
    }
    lo.shockT += dt;
    const ring = shockAt(lo.shockT);
    u.uShock.value.set(ring.front, ring.strength);
    u.uOrbit.value += dt * (0.5 + 2.5 * u.uSwirl.value);
    // The pointer: dust near it lifts, and the highlight leans its way.
    lo.ptrK = lerp(lo.ptrK, sig.ptr[2], dt * 8);
    const at = pointerDir(sig.ptr[0], sig.ptr[1]);
    u.uPtr.value.set(at[0], at[1], at[2], lo.ptrK);
    const k = 0.75 * sig.ptr[2];
    lo.light[0] = lerp(lo.light[0], LIGHT[0] + (sig.ptr[0] - LIGHT[0]) * k, dt * 5);
    lo.light[1] = lerp(lo.light[1], LIGHT[1] + (sig.ptr[1] - LIGHT[1]) * k, dt * 5);
    u.uLight.value.set(lo.light[0], lo.light[1], LIGHT[2]);
    lo.ry += dt * AUTO_SPIN * wave.spin;
    u.uRot.value.setFromMatrix4(m4[0].makeRotationX(0.3).multiply(m4[1].makeRotationY(lo.ry + sig.spin)));
    u.uHot.value.set(sig.hot[0], sig.hot[1], sig.hot[2], sig.hot[3]);
    u.uPx.value = DOT_PX * dpr * Math.min(1.3, Math.max(0.6, (RADIUS_SHARE * Math.min(size.width, size.height)) / 90));
  });

  const scale = (RADIUS_SHARE * Math.min(size.width, size.height)) / pxPerWorldUnit(size.height);
  return (
    <>
      <mesh geometry={ball} material={glass} scale={scale * GLASS_SHARE} renderOrder={0} />
      <points geometry={geo} material={mat} scale={scale} frustumCulled={false} renderOrder={1} />
    </>
  );
}

const tick = ({ timestamp }: FrameData) => advance(timestamp / 1000);

export default function OrbCore(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let onScreen = true;
    let running = false;
    const sync = () => {
      const want = onScreen && !document.hidden;
      if (want && !running) frame.update(tick, true);
      else if (!want && running) cancelFrame(tick);
      running = want;
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e?.isIntersecting ?? true;
      sync();
    });
    if (host.current) io.observe(host.current);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cancelFrame(tick);
    };
  }, []);
  return (
    <div ref={host} className="size-full">
      <Canvas frameloop="never" camera={{ position: [0, 0, CAMERA_Z], fov: FOV }} dpr={[1, MAX_DPR]} gl={{ antialias: true, alpha: true }}>
        <Dust {...props} />
      </Canvas>
    </div>
  );
}
