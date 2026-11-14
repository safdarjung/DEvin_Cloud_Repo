"use client";

/* eslint-disable react-hooks/immutability -- useFrame mutates three.js uniforms by design (imperative per-frame loop) */

// The living orb: a hollow net (a honeycomb of links with a bead at every joint, two
// draw calls) that you can see through, with a few motes in orbit round it. Its motion
// follows the AI state (idle / listening / thinking / answering / proposing / waiting /
// done / error) and the hand: the net lifts toward the pointer, dents under a press and
// springs back past flat, lags and flattens under a hard spin, and a ring of light
// crosses it on a send, a mode change, an approval and a release.
// Decoration only: the page works without it (no WebGL, reduced motion), so nothing
// here takes input. It renders inside motion's frame loop (frameloop "never" +
// advance), so the page runs one requestAnimationFrame loop, paused when the tab is
// hidden or the orb is off-screen.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, advance, useFrame, useThree } from "@react-three/fiber";
import { cancelFrame, frame, type FrameData } from "motion/react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix3, Matrix4, NormalBlending, ShaderMaterial, Vector2, Vector3, Vector4 } from "three";
import { fibonacciSphere, orbNet, pointerDir, scatterEnvelope, shockAt, waveFor, type OrbState, type Vec3 } from "./orb-layout";
import { BEAD_FRAGMENT, BEAD_VERTEX, LINK_FRAGMENT, LINK_VERTEX } from "./orb-shaders";
import { ORB_ERROR } from "./orb-theme";

/**
 * Live inputs written outside React: mic loudness (0..1), a keystroke/hover pulse, the sphere's spin and tilt (radians, OrbBody),
 * the hovered section (view-space x, y, z and 0..1 strength), `shock` (set to 1 to send one ring of light across the net),
 * the mouse over the orb (x, y in the ball's own -1..1 square with y up, then 1 while it is there) and a press on it
 * (the same square, then 1 while the button or finger is down).
 */
export interface OrbSignals {
  level: number;
  pulse: number;
  spin: number;
  tilt: number;
  hot: [number, number, number, number];
  shock: number;
  ptr: [number, number, number];
  press: [number, number, number];
}

const CAMERA_Z = 7.5;
const FOV = 45;
/** Sparse dots in orbit outside the net. */
const MOTES = 40;
/** The net's radius as a share of the canvas (the canvas is 1.4x the stage, so the motes have room). */
const RADIUS_SHARE = 0.275;
/** The entrance ring fires as the net closes. */
const FIRST_SHOCK_S = -0.85;
const AUTO_SPIN = 0.12;
const ENTRANCE_S = 1.1;
/** A front bead's diameter and a front link's width (CSS px, before the size factor). */
const BEAD_PX = 3.4;
const LINK_PX = 1.25;
const MAX_DPR = 2;
/** A press: the dent follows it on a loose spring, so letting go swings past flat (a bulge) before it settles. */
const POKE = { stiffness: 190, damping: 9 };
/** A hard spin: the net's middle lags by `gain` radians per rad/s, on its own spring, so it wobbles when the spin stops. */
const WHIRL = { gain: 0.07, stiffness: 90, damping: 7, max: 0.9 };
const FRONT: Vec3 = [0, 0, 1];

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const pxPerWorldUnit = (h: number) => h / (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360));
/** A stable pseudo-random 0..1 per index. */
const seedOf = (i: number) => (i * 0.61803398875) % 1;

interface Props {
  state: OrbState;
  dark: boolean;
  accent: readonly [string, string];
  signals: React.RefObject<OrbSignals>;
  /** How fine the net is (orbNet): fewer, larger cells on the small orb. */
  freq: number;
  /** Sphere radius as a share of the canvas's short side. The default leaves room for the feature dots around it. */
  share?: number;
}

/** The beads (every joint, then the motes) and the links (four corners each: end 0 or 1, side -1 or 1). */
function netGeometry(freq: number) {
  const net = orbNet(freq);
  const pts = [...net.points, ...fibonacciSphere(MOTES)];
  const beads = new BufferGeometry();
  beads.setAttribute("position", new BufferAttribute(new Float32Array(pts.flat()), 3));
  beads.setAttribute("aSeed", new BufferAttribute(new Float32Array(pts.map((_, i) => seedOf(i))), 1));
  beads.setAttribute("aShell", new BufferAttribute(new Float32Array(pts.map((_, i) => (i < net.points.length ? 0 : 1))), 1));

  const corners = net.links.length * 4;
  const own = new Float32Array(corners * 3);
  const other = new Float32Array(corners * 3);
  const one = () => new Float32Array(corners);
  const [seed, otherSeed, end, side, link] = [one(), one(), one(), one(), one()];
  const index: number[] = [];
  net.links.forEach(([a, b], l) => {
    for (let c = 0; c < 4; c++) {
      const at = l * 4 + c;
      const [me, it] = c < 2 ? [a, b] : [b, a];
      own.set(net.points[me], at * 3);
      other.set(net.points[it], at * 3);
      seed[at] = seedOf(me);
      otherSeed[at] = seedOf(it);
      end[at] = c < 2 ? 0 : 1;
      side[at] = c % 2 ? 1 : -1;
      link[at] = seedOf(l);
    }
    index.push(l * 4, l * 4 + 1, l * 4 + 2, l * 4 + 2, l * 4 + 1, l * 4 + 3);
  });
  const links = new BufferGeometry();
  links.setIndex(index);
  links.setAttribute("position", new BufferAttribute(own, 3));
  links.setAttribute("aOther", new BufferAttribute(other, 3));
  for (const [name, data] of [["aSeed", seed], ["aOtherSeed", otherSeed], ["aEnd", end], ["aSide", side], ["aLink", link]] as const) {
    links.setAttribute(name, new BufferAttribute(data, 1));
  }
  return { beads, links };
}

function Net({ state, dark, accent, signals, freq, share = RADIUS_SHARE }: Props) {
  const stateRef = useRef(state);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    stateRef.current = state;
  });
  const geo = useMemo(() => netGeometry(freq), [freq]);
  useEffect(
    () => () => {
      geo.beads.dispose();
      geo.links.dispose();
    },
    [geo],
  );
  const u = useMemo(
    () => ({
      uRot: { value: new Matrix3() }, uTime: { value: 0 }, uClock: { value: 0 }, uAmp: { value: 0.035 }, uRipple: { value: 0 },
      uRipplePhase: { value: 0 }, uLevel: { value: 0 }, uContract: { value: 0 }, uSwirl: { value: 0 }, uJitter: { value: 0 },
      uScatter: { value: 0 }, uIntro: { value: 0 }, uPx: { value: 1 }, uGlow: { value: 0.35 }, uErr: { value: 0 }, uFill: { value: 1 }, uHot: { value: new Vector4(0, 0, 1, 0) },
      uColorA: { value: new Color() }, uColorB: { value: new Color() }, uErrColor: { value: new Color(ORB_ERROR) },
      uPtr: { value: new Vector4(0, 0, 1, 0) }, uShock: { value: new Vector2() }, uShockDir: { value: new Vector3(...FRONT) }, uOrbit: { value: 0 },
      uPoke: { value: new Vector4(0, 0, 1, 0) }, uWhirl: { value: 0 }, uView: { value: new Vector2(1, 1) }, uWidth: { value: 1 },
      uFlow: { value: 0 }, uFlowT: { value: 0 },
    }),
    [],
  );
  // Both materials read the same uniform objects: one write per frame moves the links and the beads together.
  const beadMat = useMemo(
    () => new ShaderMaterial({ vertexShader: BEAD_VERTEX, fragmentShader: BEAD_FRAGMENT, uniforms: u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    [u],
  );
  useEffect(() => () => beadMat.dispose(), [beadMat]);
  const linkMat = useMemo(
    () => new ShaderMaterial({ vertexShader: LINK_VERTEX, fragmentShader: LINK_FRAGMENT, uniforms: u, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide }),
    [u],
  );
  useEffect(() => () => linkMat.dispose(), [linkMat]);
  // Mode/theme changes ease the colours over in the frame loop instead of snapping.
  const target = useMemo(() => ({ a: new Color(), b: new Color(), first: true }), []);
  useEffect(() => {
    target.a.set(accent[0]).lerp(new Color(accent[1]), dark ? 0.5 : 0);
    target.b.set(accent[1]).lerp(new Color(accent[0]), dark ? 0 : 0.45);
    if (target.first) {
      u.uColorA.value.copy(target.a);
      u.uColorB.value.copy(target.b);
      target.first = false;
    }
    u.uFill.value = dark ? 0.9 : 1.2;
    // Dark: the net adds light, so crossing links glow.
    beadMat.blending = linkMat.blending = dark ? AdditiveBlending : NormalBlending;
  }, [accent, dark, u, target, beadMat, linkMat]);

  const local = useRef({
    intro: 0, errT: 0, ripple: 0, ry: 0, shockT: FIRST_SHOCK_S, ptrK: 0,
    pressed: false, pokeAt: FRONT, poke: 0, pokeV: 0, turn: null as number | null, whirl: 0, whirlV: 0,
  });
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
    // Packets of light along the links: a few at rest, a stream while the AI works.
    u.uFlow.value = lerp(u.uFlow.value, wave.flow, dt * 3);
    u.uFlowT.value += dt * (0.2 + 1.3 * u.uFlow.value);
    // A press dents the net under the finger and follows it; letting go sends a ring of light from that spot.
    const pressed = sig.press[2] > 0;
    if (pressed) lo.pokeAt = pointerDir(sig.press[0], sig.press[1]);
    const released = lo.pressed && !pressed;
    lo.pressed = pressed;
    lo.pokeV += (POKE.stiffness * ((pressed ? 1 : 0) - lo.poke) - POKE.damping * lo.pokeV) * dt;
    lo.poke += lo.pokeV * dt;
    u.uPoke.value.set(lo.pokeAt[0], lo.pokeAt[1], lo.pokeAt[2], lo.poke);
    // A ring of light: taken once from the signal (it starts at the front) or from a release, then it runs its course.
    if (sig.shock > 0 || released) {
      u.uShockDir.value.set(...(sig.shock > 0 ? FRONT : lo.pokeAt));
      lo.shockT = 0;
      sig.shock = 0;
    }
    lo.shockT += dt;
    const ring = shockAt(lo.shockT);
    u.uShock.value.set(ring.front, ring.strength);
    u.uOrbit.value += dt * (0.5 + 2.5 * u.uSwirl.value);
    // The pointer: the net near it lifts and brightens.
    lo.ptrK = lerp(lo.ptrK, sig.ptr[2], dt * 8);
    const at = pointerDir(sig.ptr[0], sig.ptr[1]);
    u.uPtr.value.set(at[0], at[1], at[2], lo.ptrK);
    lo.ry += dt * AUTO_SPIN * wave.spin;
    // The net's middle lags behind a hard spin and swings back when the spin stops.
    const turn = lo.ry + sig.spin;
    const speed = lo.turn !== null && dt > 1e-4 ? (turn - lo.turn) / dt : 0;
    lo.turn = turn;
    lo.whirlV += (WHIRL.stiffness * (speed * WHIRL.gain - lo.whirl) - WHIRL.damping * lo.whirlV) * dt;
    lo.whirl += lo.whirlV * dt;
    u.uWhirl.value = Math.max(-WHIRL.max, Math.min(WHIRL.max, lo.whirl));
    u.uRot.value.setFromMatrix4(m4[0].makeRotationX(sig.tilt).multiply(m4[1].makeRotationY(turn)));
    u.uHot.value.set(sig.hot[0], sig.hot[1], sig.hot[2], sig.hot[3]);
    const k = dpr * Math.min(1.3, Math.max(0.6, (share * Math.min(size.width, size.height)) / 90));
    u.uPx.value = BEAD_PX * k;
    u.uWidth.value = LINK_PX * k;
    u.uView.value.set(size.width * dpr, size.height * dpr);
  });

  const scale = (share * Math.min(size.width, size.height)) / pxPerWorldUnit(size.height);
  return (
    <>
      <mesh geometry={geo.links} material={linkMat} scale={scale} frustumCulled={false} renderOrder={0} />
      <points geometry={geo.beads} material={beadMat} scale={scale} frustumCulled={false} renderOrder={1} />
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
        <Net {...props} />
      </Canvas>
    </div>
  );
}
