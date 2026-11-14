"use client";

/* eslint-disable react-hooks/immutability -- useFrame moves DOM tags and reuses scratch vectors by design (imperative per-frame loop), as in OrbCore.tsx */
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { ACTS, CLOTH, LANES, RADIUS, SPACING, TANGLE_R, buildThreads, tangleAt, threadPoint, threadWeave, type Vec3, type YarnThread } from "./weave";
import { INK_FRAGMENT, YARN_FRAGMENT, YARN_VERTEX } from "./yarn-shader";

const TAU = Math.PI * 2;
const INK = "#1f2937";
/** The sheen's position runs across the cloth (-1.3..1.3 in its diagonal coordinate); this value is far outside it. */
const SHEEN_OFF = -9;
const SHEEN_LOOP_S = 4.5;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One merged tube mesh for every thread: `segments` rings along each, `radial` sides around. */
function buildGeometry(threads: readonly YarnThread[], segments: number, radial: number) {
  const ring = radial + 1; // the seam vertex is doubled so the ply stripe interpolates cleanly
  const perThread = (segments + 1) * ring;
  const n = threads.length * perThread;
  const aT = new Float32Array(n);
  const aAngle = new Float32Array(n);
  const aKind = new Float32Array(n);
  const aLane = new Float32Array(n);
  const aSeed = new Float32Array(n * 4);
  const aWindow = new Float32Array(n * 2);
  const aColor = new Float32Array(n * 3);
  const index = new Uint32Array(threads.length * segments * radial * 6);
  const color = new THREE.Color();
  let v = 0;
  let k = 0;
  threads.forEach((th, ti) => {
    color.set(th.color);
    for (let s = 0; s <= segments; s++) {
      for (let r = 0; r < ring; r++, v++) {
        aT[v] = s / segments;
        aAngle[v] = (r / radial) * TAU;
        aKind[v] = th.kind;
        aLane[v] = th.lane;
        aSeed.set(th.seed, v * 4);
        aWindow[v * 2] = th.start;
        aWindow[v * 2 + 1] = th.dur;
        aColor[v * 3] = color.r;
        aColor[v * 3 + 1] = color.g;
        aColor[v * 3 + 2] = color.b;
      }
    }
    const base = ti * perThread;
    for (let s = 0; s < segments; s++) {
      for (let r = 0; r < radial; r++) {
        const a = base + s * ring + r;
        const c = a + ring;
        index[k++] = a;
        index[k++] = a + 1;
        index[k++] = c;
        index[k++] = a + 1;
        index[k++] = c + 1;
        index[k++] = c;
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // unused: the shader places every vertex
  g.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  g.setAttribute("aAngle", new THREE.BufferAttribute(aAngle, 1));
  g.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1));
  g.setAttribute("aLane", new THREE.BufferAttribute(aLane, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 4));
  g.setAttribute("aWindow", new THREE.BufferAttribute(aWindow, 2));
  g.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

interface YarnProps {
  progress: RefObject<number>;
  /** DOM tags, one per problem thread; this component moves them every frame. */
  tags: RefObject<(HTMLElement | null)[]>;
  lite: boolean;
  onReady: () => void;
}

function Yarn({ progress, tags, lite, onReady }: YarnProps) {
  const group = useRef<THREE.Group>(null);
  const threads = useMemo(() => buildThreads(), []);
  const problemThreads = useMemo(() => threads.filter((t) => t.problem >= 0).sort((a, b) => a.problem - b.problem), [threads]);
  const geometry = useMemo(() => buildGeometry(threads, lite ? 110 : 200, lite ? 6 : 10), [threads, lite]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uP: { value: 0 },
      uRadius: { value: RADIUS },
      uOutline: { value: 0 },
      uSpacing: { value: SPACING },
      uLanes: { value: LANES },
      uCloth: { value: CLOTH },
      uTangleR: { value: TANGLE_R },
      uTangleC: { value: new THREE.Vector2() },
      uWave: { value: 0 },
      uPointer: { value: new THREE.Vector2(99, 99) },
      uPush: { value: 0 },
      uSheen: { value: SHEEN_OFF },
      uLight: { value: new THREE.Vector3(0.45, 0.75, 0.6) },
      uInk: { value: new THREE.Color(INK) },
    }),
    [],
  );
  const inkUniforms = useMemo(() => ({ ...uniforms, uOutline: { value: RADIUS * 0.36 } }), [uniforms]);
  // R3F gives each material its own copy of the uniforms it is handed, so the frame loop writes to the materials.
  const fill = useRef<THREE.ShaderMaterial>(null);
  const ink = useRef<THREE.ShaderMaterial>(null);
  const push = useRef(0);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const pointer = useRef({ x: 0, y: 0, at: -10 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1, at: performance.now() / 1000 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const scratch = useMemo(() => ({ v: new THREE.Vector3(), ray: new THREE.Vector3(), point: [0, 0, 0] as Vec3, tangle: [0, 0, 0] as Vec3, woven: [] as boolean[] }), []);
  const ready = useRef(false);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const p = progress.current;
    const t = state.clock.elapsedTime;
    const { width: vw, height: vh } = state.viewport;
    const portrait = vw < vh * 1.05;
    const weave = smoothstep(ACTS.weave[0], ACTS.weave[1], p);
    const hold = smoothstep(ACTS.hold[0], 1, p);

    // Yarn sits beside the copy on wide screens and above it on tall ones.
    const scale = (portrait ? Math.min(vw * 0.9, vh * 0.36) : Math.min(vw * 0.46, vh * 0.8)) / CLOTH;
    // The finished cloth is turned to a diamond, which is wider corner to corner: draw it smaller.
    g.scale.setScalar(scale * (1 - weave * 0.27));
    g.position.set(portrait ? 0 : vw * (0.245 - weave * 0.012), portrait ? vh * 0.28 : vh * (-0.02 + weave * 0.03), 0);
    const px = pointer.current.x;
    const py = pointer.current.y;
    // Tangle: slow drift plus pointer parallax. Cloth: tips back onto the table and turns to a diamond.
    g.rotation.set(
      (1 - weave) * py * -0.12 + weave * -0.62 + hold * 0.05,
      (1 - weave) * (Math.sin(t * 0.27) * 0.14 + px * 0.16),
      weave * 0.52 + hold * 0.1 + Math.sin(t * 0.2) * 0.02 * weave,
    );
    g.updateMatrixWorld();

    // Pointer in the yarn's own xy plane (the tangle barely rotates, so the z = 0 world plane is close enough).
    const cam = state.camera;
    scratch.ray.set(px, py, 0.5).unproject(cam).sub(cam.position).normalize();
    const d = -cam.position.z / scratch.ray.z;
    const lx = (cam.position.x + scratch.ray.x * d - g.position.x) / g.scale.x;
    const ly = (cam.position.y + scratch.ray.y * d - g.position.y) / g.scale.y;
    const fresh = performance.now() / 1000 - pointer.current.at < 1.2 ? 1 : 0;
    push.current += (fresh - push.current) * 0.08;
    const tangle = tangleAt(p, scratch.tangle);
    for (const m of [fill.current, ink.current]) {
      if (!m) continue;
      m.uniforms.uTime.value = t;
      m.uniforms.uP.value = p;
      m.uniforms.uWave.value = weave;
      m.uniforms.uTangleR.value = tangle[0];
      m.uniforms.uTangleC.value.set(tangle[1], tangle[2]);
      m.uniforms.uPointer.value.set(lx, ly);
      m.uniforms.uPush.value = push.current;
      // Once the cloth is finished a band of light crosses it, then rests, on a loop.
      m.uniforms.uSheen.value = weave > 0.985 ? -1.3 + ((t % SHEEN_LOOP_S) / SHEEN_LOOP_S) * 6 : SHEEN_OFF;
    }

    // Pin each problem's paper tag to its thread: mid-thread in the tangle, the left end once woven.
    const els = tags.current;
    for (let i = 0; i < problemThreads.length; i++) {
      const el = els[i];
      if (!el) continue;
      const th = problemThreads[i];
      const w = threadWeave(th, p);
      threadPoint(th, 0.5 + (0.035 - 0.5) * w, p, t, scratch.point);
      scratch.v.set(scratch.point[0], scratch.point[1], scratch.point[2]).applyMatrix4(g.matrixWorld).project(cam);
      const x = (scratch.v.x * 0.5 + 0.5) * state.size.width;
      const y = (-scratch.v.y * 0.5 + 0.5) * state.size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const woven = w > 0.6;
      if (scratch.woven[i] !== woven) {
        scratch.woven[i] = woven;
        el.dataset.woven = String(woven);
      }
    }

    if (!ready.current) {
      ready.current = true;
      onReady();
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={geometry} frustumCulled={false} renderOrder={1}>
        <shaderMaterial ref={ink} vertexShader={YARN_VERTEX} fragmentShader={INK_FRAGMENT} uniforms={inkUniforms} side={THREE.BackSide} />
      </mesh>
      <mesh geometry={geometry} frustumCulled={false} renderOrder={2}>
        <shaderMaterial ref={fill} vertexShader={YARN_VERTEX} fragmentShader={YARN_FRAGMENT} uniforms={uniforms} />
      </mesh>
    </group>
  );
}

export interface LoomCanvasProps extends YarnProps {
  /** False while the film is scrolled off screen: the render loop stops. */
  active: boolean;
}

export default function LoomCanvas({ active, lite, ...yarn }: LoomCanvasProps) {
  return (
    <Canvas
      flat
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 10], fov: 32, near: 1, far: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Yarn lite={lite} {...yarn} />
    </Canvas>
  );
}
