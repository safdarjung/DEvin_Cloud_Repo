"use client";

/* eslint-disable react-hooks/immutability -- useFrame mutates three.js objects, refs and DOM styles by design (imperative per-frame loop) */

// R3F core (rippling sphere) plus ONE absolutely-positioned DOM layer of real
// links whose positions are projected each frame from the same layout maths.
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { IcosahedronGeometry, type Mesh } from "three";
import { ORB_ICONS, type OrbIconKey } from "./orb-icons";
import { bulgeTargets, fibonacciSphere, rotateYX, tileWidth, waveFor, type Bulge, type OrbState } from "./orb-layout";

export interface OrbApp {
  href: string;
  label: string;
  icon: OrbIconKey;
}

const CAMERA_Z = 7.5;
const FOV = 45;
/** Sphere radius as a share of the smaller canvas side. */
const RADIUS_SHARE = 0.4;
const CORE_SHARE = 0.62;
const AUTO_SPIN = 0.15;
const DRAG_PX_TO_RAD = 0.006;
const CLICK_SLOP_PX = 6;
const MAX_TILT = 1.1;

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Shared {
  rot: { y: number; x: number; dragging: boolean };
  hovered: number | null;
  targets: Bulge[];
}

function Stage({ apps, state, shared, tiles }: {
  apps: OrbApp[];
  state: OrbState;
  shared: React.RefObject<Shared>;
  tiles: React.RefObject<Array<HTMLElement | null>>;
}) {
  const mesh = useRef<Mesh>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const normals = useMemo(() => fibonacciSphere(apps.length), [apps.length]);
  const geo = useMemo(() => new IcosahedronGeometry(1, 3), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  const cur = useRef({ amp: 0.08, speed: 0.5, phase: 0, bulge: normals.map(() => ({ push: 0, scale: 1 })) });
  const size = useThree((s) => s.size);

  useFrame((_, dt) => {
    const { width: W, height: H } = size;
    const pxPerUnit = H / (2 * CAMERA_Z * Math.tan((FOV * Math.PI) / 360));
    const Rpx = RADIUS_SHARE * Math.min(W, H);
    const R = Rpx / pxPerUnit;
    const sh = shared.current;
    if (!sh.rot.dragging && sh.hovered === null) sh.rot.y += dt * AUTO_SPIN;

    // Core: displaced icosphere; amplitude/speed follow the chat state.
    const target = waveFor(stateRef.current);
    const c = cur.current;
    c.amp = lerp(c.amp, target.amp, dt * 3);
    c.speed = lerp(c.speed, target.speed, dt * 3);
    c.phase += dt * c.speed;
    const t = c.phase;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const n = (Math.sin(x * 3.2 + t) + Math.sin(y * 4.1 - t * 1.3) + Math.sin(z * 5.3 + t * 0.7)) / 3;
      const k = 1 + c.amp * n;
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    if (mesh.current) {
      mesh.current.scale.setScalar(R * CORE_SHARE);
      mesh.current.rotation.y = sh.rot.y;
      mesh.current.position.x = Math.sin(performance.now() / 22) * target.shake * R;
    }

    // Tiles: spring toward bulge targets, rotate, project, write DOM styles.
    const w = tileWidth(apps.length, Rpx);
    for (let i = 0; i < normals.length; i++) {
      const el = tiles.current[i];
      if (!el) continue;
      const b = c.bulge[i];
      const tg = sh.targets[i] ?? { push: 0, scale: 1 };
      b.push = lerp(b.push, tg.push, dt * 10);
      b.scale = lerp(b.scale, tg.scale, dt * 10);
      const n = rotateYX(normals[i], sh.rot.y, sh.rot.x);
      const r = R * (1 + b.push);
      const k = CAMERA_Z / (CAMERA_Z - n[2] * r);
      const px = W / 2 + n[0] * r * pxPerUnit * k;
      const py = H / 2 - n[1] * r * pxPerUnit * k;
      const depth = (n[2] + 1) / 2;
      el.style.width = `${w}px`;
      el.style.opacity = String(clamp((n[2] + 0.1) * 2.2, 0.05, 1));
      el.style.pointerEvents = n[2] > 0.15 ? "auto" : "none";
      el.style.zIndex = String(Math.round(depth * 100));
      el.style.transform = `translate(${px - w / 2}px, ${py}px) translateY(-50%) scale(${(0.7 + 0.3 * depth) * b.scale})`;
    }
  });

  return (
    <mesh ref={mesh} geometry={geo}>
      <meshStandardMaterial color="#9a9aa6" roughness={0.4} metalness={0.2} flatShading />
    </mesh>
  );
}

export default function OrbScene({ apps, state }: { apps: OrbApp[]; state: OrbState }) {
  const normals = useMemo(() => fibonacciSphere(apps.length), [apps.length]);
  const shared = useRef<Shared>({ rot: { y: 0, x: 0, dragging: false }, hovered: null, targets: bulgeTargets(normals, null) });
  const tiles = useRef<Array<HTMLElement | null>>([]);
  const moved = useRef(0);

  function hover(i: number | null) {
    shared.current.hovered = i;
    shared.current.targets = bulgeTargets(normals, i);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const r = shared.current.rot;
    r.dragging = true;
    moved.current = 0;
    let lx = e.clientX, ly = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lx, dy = ev.clientY - ly;
      lx = ev.clientX; ly = ev.clientY;
      moved.current += Math.abs(dx) + Math.abs(dy);
      r.y += dx * DRAG_PX_TO_RAD;
      r.x = clamp(r.x + dy * DRAG_PX_TO_RAD, -MAX_TILT, MAX_TILT);
    };
    const up = () => {
      r.dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className="relative size-full cursor-grab touch-pan-y select-none overflow-hidden active:cursor-grabbing"
      onPointerDown={onPointerDown}
      // A drag that ends over a tile must not open it.
      onClickCapture={(e) => {
        if (moved.current > CLICK_SLOP_PX) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: FOV }} dpr={[1, 2]} className="!absolute inset-0">
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 4, 5]} intensity={1.6} />
        <Stage apps={apps} state={state} shared={shared} tiles={tiles} />
      </Canvas>
      <ul className="absolute inset-0 m-0 list-none p-0">
        {apps.map((app, i) => {
          const Icon = ORB_ICONS[app.icon];
          return (
            <li key={app.href} ref={(el) => { tiles.current[i] = el; }} className="absolute left-0 top-0 origin-center">
              <Link
                href={app.href}
                onPointerEnter={() => hover(i)}
                onPointerLeave={() => hover(null)}
                onFocus={() => hover(i)}
                onBlur={() => hover(null)}
                className="flex flex-col items-center gap-1 rounded-xl border bg-card/95 px-1.5 py-2 text-center text-xs font-medium text-foreground shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-5" aria-hidden />
                <span className="line-clamp-2 leading-tight">{app.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
