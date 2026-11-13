"use client";

// FabricOS hero scene (lazy-loaded, client only). One canvas for the hero and
// the scroll story: a faceted core inside orbit rings, a node cluster per part
// of the institution, curved pathways carrying data pulses. Everything is built
// once in `useSystem` and animated imperatively in a single useFrame, so React
// only re-renders when the stage, selection or hover changes.
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { NODES, type NodeKind } from "./content";
import {
  EDGES,
  HERO_STAGE,
  KIND_COLOR,
  LAST_STEP,
  POS,
  controlPoint,
  isEdgeDormant,
  isEdgeOn,
  isNodeOn,
  stageZoom,
} from "./scene/layout";

export interface HeroSceneProps {
  stage: number;
  selected: string | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  wide: boolean;
  lite: boolean;
  /** False when off-screen or the tab is hidden: rendering stops entirely. */
  running: boolean;
  onReady: () => void;
  onLost: () => void;
}

const OUTER = NODES.filter((n) => n.id !== "core");
const SAMPLES = 64;
const CYAN = new THREE.Color("#67d7ea");
const INDIGO = new THREE.Color("#8b93ff");
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Seeded PRNG so the dust field is identical on every mount (and render-pure). */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glyphGeometry(id: string, kind: NodeKind): THREE.BufferGeometry {
  if (id === "departments") return new THREE.DodecahedronGeometry(0.17, 0);
  switch (kind) {
    case "people":
      return new THREE.SphereGeometry(0.16, 24, 16);
    case "agent":
      return new THREE.OctahedronGeometry(0.21, 0);
    case "information":
      return new THREE.BoxGeometry(0.3, 0.07, 0.22);
    case "workflow":
      return new THREE.TorusGeometry(0.15, 0.035, 10, 36);
    case "automation":
      return new THREE.TorusKnotGeometry(0.11, 0.028, 72, 8);
    default:
      return new THREE.IcosahedronGeometry(0.19, 0);
  }
}

function sprite(tex: THREE.Texture, color: THREE.ColorRepresentation, scale: number, opacity: number) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  s.scale.setScalar(scale);
  return s;
}

/** Builds every object once. Returned `dispose` frees GPU resources on unmount. */
function useSystem(lite: boolean) {
  return useMemo(() => {
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
    const tex = keep(glowTexture());
    const system = new THREE.Group();

    // Core: faceted body, wire cage, inner light and three orbit rings.
    const core = new THREE.Group();
    const body = new THREE.Mesh(
      keep(new THREE.IcosahedronGeometry(0.55, 1)),
      keep(new THREE.MeshStandardMaterial({ color: "#1d2456", emissive: "#4b52c8", emissiveIntensity: 0.12, metalness: 0.25, roughness: 0.42, flatShading: true, transparent: true, opacity: 0.92 })),
    );
    const cage = new THREE.LineSegments(
      keep(new THREE.EdgesGeometry(keep(new THREE.IcosahedronGeometry(0.82, 1)))),
      keep(new THREE.LineBasicMaterial({ color: "#8b93ff", transparent: true, opacity: 0.32, depthWrite: false })),
    );
    const innerGlow = sprite(tex, "#67d7ea", 1.9, 0.5);
    innerGlow.material.depthTest = false; // light seen through the facets
    innerGlow.renderOrder = 2;
    const outerGlow = sprite(tex, "#4b52c8", 6, 0.35);
    keep(innerGlow.material);
    keep(outerGlow.material);
    const rings = [1.15, 1.5, 1.95].map((r, i) => {
      const m = new THREE.Mesh(
        keep(new THREE.TorusGeometry(r, 0.006, 6, 180)),
        keep(new THREE.MeshBasicMaterial({ color: i === 1 ? "#67d7ea" : "#8b93ff", transparent: true, opacity: [0.55, 0.32, 0.2][i], depthWrite: false })),
      );
      m.rotation.set(Math.PI / 2 + [0.32, -0.22, 0.12][i], [0.1, 0.4, -0.3][i], 0);
      return m;
    });
    const tickGeo = keep(new THREE.BufferGeometry());
    const ticks: number[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      ticks.push(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0);
    }
    tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    const tickRing = new THREE.Points(tickGeo, keep(new THREE.PointsMaterial({ color: "#c7cbff", size: 0.035, transparent: true, opacity: 0.55, depthWrite: false })));
    tickRing.rotation.copy(rings[1].rotation);
    const light = new THREE.PointLight("#8b93ff", 14, 9, 2);
    core.add(outerGlow, body, cage, innerGlow, tickRing, light, ...rings);
    system.add(core);

    // Hit target for the core (bigger than the body, invisible).
    const hitGeo = keep(new THREE.SphereGeometry(0.42, 12, 8));
    const hitMat = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    const coreHit = new THREE.Mesh(keep(new THREE.SphereGeometry(0.9, 16, 12)), hitMat);
    coreHit.userData.id = "core";
    core.add(coreHit);

    // Nodes.
    const nodes = OUTER.map((n) => {
      const g = new THREE.Group();
      g.position.set(...POS[n.id]);
      const mat = keep(new THREE.MeshStandardMaterial({ color: "#1a2044", emissive: KIND_COLOR[n.kind], emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.35, flatShading: true }));
      const glyph = new THREE.Mesh(keep(glyphGeometry(n.id, n.kind)), mat);
      if (n.kind === "information") {
        for (const dy of [-0.11, 0.11]) {
          const layer = glyph.clone();
          layer.position.y = dy;
          g.add(layer);
        }
      }
      const glow = sprite(tex, KIND_COLOR[n.kind], 1.15, 0.5);
      keep(glow.material);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.id = n.id;
      g.add(glow, glyph, hit);
      g.scale.setScalar(0.0001);
      system.add(g);
      return { id: n.id, kind: n.kind, group: g, glyph, mat, glow, vis: 0, focus: 0, base: new THREE.Vector3(...POS[n.id]) };
    });

    // Satellites: small instanced bodies orbiting each node.
    const satPer = lite ? 3 : 5;
    const sats = new THREE.InstancedMesh(
      keep(new THREE.SphereGeometry(0.028, 8, 6)),
      keep(new THREE.MeshBasicMaterial({ color: "#d5d8ff", transparent: true, opacity: 0.8 })),
      OUTER.length * satPer,
    );
    sats.frustumCulled = false;
    system.add(sats);

    // Pathways + pulses.
    const pulsesPer = lite ? 1 : 2;
    const edges = EDGES.map((e, i) => {
      const a = new THREE.Vector3(...POS[e.a]);
      const b = new THREE.Vector3(...POS[e.b]);
      const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(...controlPoint(POS[e.a], POS[e.b])), b);
      const mat = keep(new THREE.MeshBasicMaterial({ color: INDIGO.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      const tube = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, lite ? 40 : 64, e.a === "core" ? 0.009 : 0.006, 4, false)), mat);
      system.add(tube);
      return { e, mat, op: 0, pts: curve.getSpacedPoints(SAMPLES), speed: 0.1 + ((i * 37) % 10) / 100, phase: (i * 0.37) % 1 };
    });
    const pulseGeo = keep(new THREE.SphereGeometry(0.032, 10, 8));
    const pulses = new THREE.InstancedMesh(
      pulseGeo,
      keep(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
      edges.length * pulsesPer,
    );
    const halos = new THREE.InstancedMesh(
      pulseGeo,
      keep(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })),
      edges.length * pulsesPer,
    );
    for (let i = 0; i < edges.length * pulsesPer; i++) {
      const c = i % 3 === 0 ? INDIGO : CYAN;
      pulses.setColorAt(i, c);
      halos.setColorAt(i, c);
    }
    pulses.frustumCulled = halos.frustumCulled = false;
    system.add(pulses, halos);

    // Dust: depth cue far behind the system.
    const dustCount = lite ? 180 : 480;
    const dustPos = new Float32Array(dustCount * 3);
    const rand = prng(7);
    for (let i = 0; i < dustCount; i++) {
      const r = 6 + rand() * 9;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      dustPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th) - 4], i * 3);
    }
    const dustGeo = keep(new THREE.BufferGeometry());
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, keep(new THREE.PointsMaterial({ color: "#9aa1b4", size: 0.03, transparent: true, opacity: 0.45, depthWrite: false })));

    // Only hit targets take part in raycasting; everything else is decoration.
    system.traverse((o) => {
      if (!o.userData.id) o.raycast = () => {};
    });

    return {
      system, core, body, cage, innerGlow, outerGlow, rings, tickRing, coreHit, nodes, sats, satPer, edges, pulses, halos, pulsesPer, dust,
      coreVis: 1,
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }, [lite]);
}

type System = ReturnType<typeof useSystem>;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function FabricSystem(props: HeroSceneProps) {
  const sys: System = useSystem(props.lite);
  const { gl } = useThree();
  const offset = useRef<THREE.Group>(null);
  const framed = useRef(false);
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });

  // Pointer parallax + drag-to-rotate state (no React re-renders).
  const input = useRef({ px: 0, py: 0, yaw: 0, pitch: 0, dragging: false, axis: "" as "" | "x" | "y", sx: 0, sy: 0, lx: 0, ly: 0, moved: 0 });

  useEffect(() => sys.dispose, [sys]);

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "pan-y";
    const st = input.current;
    const onMove = (ev: PointerEvent) => {
      st.px = (ev.clientX / window.innerWidth) * 2 - 1;
      st.py = (ev.clientY / window.innerHeight) * 2 - 1;
      if (!st.dragging) return;
      const dx = ev.clientX - st.lx;
      const dy = ev.clientY - st.ly;
      st.lx = ev.clientX;
      st.ly = ev.clientY;
      st.moved += Math.abs(dx) + Math.abs(dy);
      if (!st.axis && Math.hypot(ev.clientX - st.sx, ev.clientY - st.sy) > 8) {
        st.axis = Math.abs(ev.clientX - st.sx) > Math.abs(ev.clientY - st.sy) ? "x" : "y";
        if (ev.pointerType !== "mouse" && st.axis === "y") st.dragging = false; // let the page scroll
      }
      if (!st.dragging) return;
      st.yaw = THREE.MathUtils.clamp(st.yaw + dx * 0.006, -1.1, 1.1);
      if (ev.pointerType === "mouse") st.pitch = THREE.MathUtils.clamp(st.pitch + dy * 0.004, -0.35, 0.35);
    };
    const onDown = (ev: PointerEvent) => {
      Object.assign(st, { dragging: true, axis: "", sx: ev.clientX, sy: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: 0 });
      if (ev.pointerType === "mouse") el.style.cursor = "grabbing";
    };
    const onUp = () => {
      st.dragging = false;
      el.style.cursor = "";
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const { stage, selected, hovered, wide } = live.current;
    const st = input.current;
    const focus = hovered ?? selected;
    const full = stage === HERO_STAGE || stage === LAST_STEP;

    // Framing: wide = right half; narrow = upper band of the viewport.
    const vp = state.viewport;
    const zoom = stageZoom(stage);
    let fit: number, ox: number, oy: number;
    if (wide) {
      const hero = stage === HERO_STAGE; // leave room for the explorer strip below
      fit = Math.min((vp.width * 0.5) / 7.6, (vp.height * (hero ? 0.66 : 0.8)) / 6);
      ox = vp.width * 0.225;
      oy = hero ? vp.height * 0.09 : -vp.height * 0.02;
    } else {
      const band = vp.height * 0.4;
      fit = Math.min((vp.width * 0.9) / 7.8, band / 5.6);
      ox = 0;
      oy = vp.height / 2 - vp.height * 0.08 - band / 2;
    }
    const o = offset.current!;
    if (!framed.current) {
      // First frame: start in place at near-final size, then settle.
      framed.current = true;
      o.position.set(ox, oy, 0);
      o.scale.setScalar(fit * zoom * 0.82);
    }
    const k = damp(3, dt);
    o.position.x += (ox - o.position.x) * k;
    o.position.y += (oy - o.position.y) * k;
    const sc = o.scale.x + (fit * zoom - o.scale.x) * damp(2.2, dt);
    o.scale.setScalar(sc);

    // Orientation: drift + parallax + drag, damped.
    const drift = Math.sin(t * 0.11) * (full ? 0.32 : 0.12);
    const yaw = drift + st.yaw + st.px * 0.16;
    const pitch = 0.14 + st.pitch + st.py * 0.07;
    sys.system.rotation.y += (yaw - sys.system.rotation.y) * damp(3.5, dt);
    sys.system.rotation.x += (pitch - sys.system.rotation.x) * damp(3.5, dt);

    // Core.
    const coreFocus = focus === "core" ? 1 : 0;
    sys.cage.rotation.y += dt * 0.12;
    sys.cage.rotation.x += dt * 0.05;
    sys.body.rotation.y -= dt * 0.08;
    sys.rings.forEach((r, i) => (r.rotation.z += dt * [0.1, -0.07, 0.05][i]));
    sys.tickRing.rotation.z = sys.rings[1].rotation.z;
    const breathe = 0.9 + 0.1 * Math.sin(t * 1.6);
    sys.innerGlow.material.opacity = (0.42 + coreFocus * 0.25) * breathe;
    sys.core.scale.setScalar(1 + coreFocus * 0.08);

    // Nodes: reveal per stage, emphasis on focus, dim the unrelated.
    const neighbours = new Set<string>();
    if (focus) for (const { e } of sys.edges) if ((e.a === focus || e.b === focus) && isEdgeOn(e, stage)) neighbours.add(e.a === focus ? e.b : e.a);
    for (const [i, n] of sys.nodes.entries()) {
      const on = isNodeOn(n.id, stage);
      n.vis += ((on ? 1 : 0) - n.vis) * damp(on ? 3 : 4.5, dt);
      const f = focus === n.id ? 1 : 0;
      n.focus += (f - n.focus) * damp(6, dt);
      const dim = focus && focus !== n.id && !neighbours.has(n.id) ? 0.45 : 1;
      n.group.scale.setScalar(Math.max(0.0001, n.vis * (1 + n.focus * 0.35)));
      n.group.position.y = n.base.y + Math.sin(t * 0.6 + i * 1.7) * 0.05;
      n.glyph.rotation.y += dt * (n.kind === "agent" ? 0.9 : 0.35);
      n.glyph.rotation.x += dt * 0.15;
      const agentPulse = n.kind === "agent" ? 0.35 * Math.sin(t * 2.2) ** 2 : 0;
      n.mat.emissiveIntensity = (0.5 + agentPulse + n.focus * 0.9) * dim;
      n.glow.material.opacity = (0.42 + n.focus * 0.45 + agentPulse * 0.6) * dim;
    }

    // Satellites.
    for (const [ni, n] of sys.nodes.entries()) {
      for (let s = 0; s < sys.satPer; s++) {
        const a = t * (0.5 + s * 0.13) + s * 2.1 + ni;
        const r = 0.3 + (s % 3) * 0.07;
        tmpP.set(Math.cos(a) * r, Math.sin(a * 0.7 + s) * 0.12, Math.sin(a) * r).multiplyScalar(n.group.scale.x).add(n.group.position);
        tmpS.setScalar(n.vis);
        sys.sats.setMatrixAt(ni * sys.satPer + s, tmpM.compose(tmpP, tmpQ, tmpS));
      }
    }
    sys.sats.instanceMatrix.needsUpdate = true;

    // Pathways and their traffic.
    const speedUp = full ? 1.5 : 1;
    let p = 0;
    for (const ed of sys.edges) {
      const on = isEdgeOn(ed.e, stage);
      const hot = focus != null && (ed.e.a === focus || ed.e.b === focus);
      const target = on ? (focus ? (hot ? 0.95 : 0.14) : 0.42) : isEdgeDormant(ed.e, stage) ? 0.1 : 0;
      ed.op += (target - ed.op) * damp(3, dt);
      ed.mat.opacity = ed.op;
      ed.mat.color.lerp(hot ? CYAN : INDIGO, damp(5, dt));
      for (let q = 0; q < sys.pulsesPer; q++, p++) {
        let u = (t * ed.speed * speedUp + ed.phase + q / sys.pulsesPer) % 1;
        if (q % 2 === 1) u = 1 - u;
        const fi = u * SAMPLES;
        const i0 = Math.floor(fi);
        tmpP.copy(ed.pts[i0]).lerp(ed.pts[Math.min(i0 + 1, SAMPLES)], fi - i0);
        const size = on ? Math.sin(Math.PI * u) * Math.min(1, ed.op * 2.2) * (hot ? 1.5 : 1) : 0;
        tmpS.setScalar(Math.max(size, 0.0001));
        sys.pulses.setMatrixAt(p, tmpM.compose(tmpP, tmpQ, tmpS));
        tmpS.multiplyScalar(3.2);
        sys.halos.setMatrixAt(p, tmpM.compose(tmpP, tmpQ, tmpS));
      }
    }
    sys.pulses.instanceMatrix.needsUpdate = true;
    sys.halos.instanceMatrix.needsUpdate = true;

    sys.dust.rotation.y += dt * 0.012;
  });

  const nodeFromEvent = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.object.userData.id as string | undefined) ?? null;
  const labelId = props.hovered ?? props.selected;
  const labelNode = labelId ? NODES.find((n) => n.id === labelId) : undefined;
  const labelTarget =
    labelNode && isNodeOn(labelNode.id, props.stage)
      ? labelNode.id === "core"
        ? sys.core
        : sys.nodes.find((n) => n.id === labelNode.id)?.group
      : undefined;

  return (
    <>
      <primitive object={sys.dust} />
      <group ref={offset} scale={0.0001}>
        <primitive
          object={sys.system}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            const id = nodeFromEvent(e);
            if (!id || !isNodeOn(id, live.current.stage)) return;
            e.stopPropagation();
            gl.domElement.style.cursor = "pointer";
            props.onHover(id);
          }}
          onPointerOut={(e: ThreeEvent<PointerEvent>) => {
            if (!nodeFromEvent(e)) return;
            gl.domElement.style.cursor = "";
            props.onHover(null);
          }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            const id = nodeFromEvent(e);
            if (!id || !isNodeOn(id, live.current.stage) || input.current.moved > 8) return;
            e.stopPropagation();
            props.onSelect(live.current.selected === id ? null : id);
          }}
        />
        {labelTarget && labelNode
          ? createPortal(
              <Html position={[0, labelNode.id === "core" ? 1.05 : 0.42, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
                <span className="fos-scene-label">{labelNode.label}</span>
              </Html>,
              labelTarget,
            )
          : null}
      </group>
    </>
  );
}

function Ready({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current || ++frames.current < 3) return;
    done.current = true;
    onReady();
  });
  return null;
}

export default function HeroScene(props: HeroSceneProps) {
  const { lite, running, onLost, onSelect } = props;
  const down = useRef({ x: 0, y: 0 });
  return (
    <Canvas
      className="fos-hs__canvas"
      frameloop={running ? "always" : "never"}
      dpr={lite ? [1, 1.25] : [1, 1.75]}
      camera={{ fov: 35, near: 0.1, far: 40, position: [0, 0.6, 10] }}
      gl={{ antialias: !lite, alpha: true, powerPreference: lite ? "low-power" : "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.domElement.addEventListener("webglcontextlost", (ev) => {
          ev.preventDefault();
          onLost();
        });
      }}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMissed={(e) => {
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 8) onSelect(null);
      }}
    >
      <fog attach="fog" args={["#05060a", 10, 24]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 5, 6]} intensity={1.1} color="#d5d8ff" />
      <directionalLight position={[-5, -2, -4]} intensity={0.7} color="#67d7ea" />
      <FabricSystem {...props} />
      <Ready onReady={props.onReady} />
    </Canvas>
  );
}
