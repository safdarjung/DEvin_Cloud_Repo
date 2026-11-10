import * as THREE from "three";

/**
 * Procedural surfaces, painted once on small canvases (≤512px) and cached: colour + height (bump), and for
 * floors a roughness map. Textures repeat in metres: RoundedBox UVs are already in object units.
 */
export type SurfaceKind = "brick" | "plaster" | "roof" | "planks" | "tiles" | "paving" | "asphalt" | "grass" | "grain" | "fabric";
export interface Surface {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
}
type G = CanvasRenderingContext2D;
type Painter = (g: G, h: G, rand: () => number, s: number, r?: G) => void;

/** Small seeded PRNG so every visit paints the same school. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grey = (v: number) => `rgb(${v},${v},${v})`;
const pick = <T>(list: readonly T[], rand: () => number) => list[Math.floor(rand() * list.length)];

function speckle(g: G, rand: () => number, s: number, n: number, colours: readonly string[], max = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(colours, rand);
    const d = 0.5 + rand() * max;
    g.fillRect(rand() * s, rand() * s, d, d);
  }
}

/** Rows of offset blocks (bricks, pavers, roof tiles): calls `cell` for each, wrapping at the edge. */
function courses(s: number, rows: number, cols: number, rand: () => number, cell: (x: number, y: number, w: number, h: number) => void) {
  const h = s / rows;
  const w = s / cols;
  for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) cell(c * w + (r % 2 ? w / 2 : 0), r * h, w, h);
}

const PAINT: Record<SurfaceKind, { size: number; metres: number; rough?: boolean; paint: Painter }> = {
  brick: {
    size: 512,
    metres: 2,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#cdbfa9";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(70);
      h.fillRect(0, 0, s, s);
      courses(s, 16, 6, rand, (x, y, w, bh) => {
        g.fillStyle = pick(["#b4553b", "#a94c35", "#bd6347", "#9d4833", "#b96a4d", "#a8563f"], rand);
        g.fillRect(x + 2, y + 2, w - 4, bh - 4);
        g.fillStyle = `rgba(255,220,190,${rand() * 0.12})`;
        g.fillRect(x + 2, y + 2, w - 4, 3);
        g.fillStyle = `rgba(40,10,0,${rand() * 0.14})`;
        g.fillRect(x + 2, y + bh - 6, w - 4, 4);
        h.fillStyle = grey(190 + Math.floor(rand() * 50));
        h.fillRect(x + 3, y + 3, w - 6, bh - 6);
      });
      speckle(g, rand, s, 1400, ["rgba(60,20,10,0.16)", "rgba(255,225,200,0.12)"]);
      speckle(h, rand, s, 900, ["rgba(0,0,0,0.15)"]);
    },
  },
  plaster: {
    size: 256,
    metres: 3,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(128);
      h.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const r = 18 + rand() * 46;
        for (const dx of [0, s, -s]) {
          const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
          grad.addColorStop(0, rand() > 0.5 ? "rgba(120,95,70,0.07)" : "rgba(255,255,255,0.1)");
          grad.addColorStop(1, "rgba(128,128,128,0)");
          g.fillStyle = grad;
          g.fillRect(x + dx - r, y - r, r * 2, r * 2);
        }
      }
      speckle(g, rand, s, 1600, ["rgba(110,90,70,0.07)"], 1.5);
      speckle(h, rand, s, 5000, ["rgba(255,255,255,0.14)", "rgba(0,0,0,0.14)"], 2.5);
    },
  },
  roof: {
    size: 256,
    metres: 1.6,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#6f2f22";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(40);
      h.fillRect(0, 0, s, s);
      courses(s, 8, 8, rand, (x, y, w, th) => {
        const shade = g.createLinearGradient(0, y, 0, y + th);
        const base = pick(["#b9553a", "#a94a33", "#c46246", "#b35a3f"], rand);
        shade.addColorStop(0, "#7c3324");
        shade.addColorStop(0.35, base);
        shade.addColorStop(1, "#d0755a");
        g.fillStyle = shade;
        g.beginPath();
        g.roundRect(x + 1, y, w - 2, th - 1, [0, 0, w * 0.45, w * 0.45]);
        g.fill();
        const lift = h.createLinearGradient(0, y, 0, y + th);
        lift.addColorStop(0, grey(90));
        lift.addColorStop(1, grey(240));
        h.fillStyle = lift;
        h.beginPath();
        h.roundRect(x + 2, y, w - 4, th - 2, [0, 0, w * 0.45, w * 0.45]);
        h.fill();
      });
    },
  },
  planks: {
    size: 512,
    metres: 2.4,
    rough: true,
    paint: (g, h, rand, s, r) => {
      const rows = 16;
      const ph = s / rows;
      r!.fillStyle = grey(120);
      r!.fillRect(0, 0, s, s);
      for (let i = 0; i < rows; i++) {
        const y = i * ph;
        const joint = rand() * s;
        for (const [x0, x1] of [
          [0, joint],
          [joint, s],
        ]) {
          g.fillStyle = pick(["#c99a68", "#be8d5c", "#d0a474", "#b88655", "#c69565"], rand);
          g.fillRect(x0, y, x1 - x0, ph);
        }
        for (let k = 0; k < 9; k++) {
          g.fillStyle = `rgba(90,50,20,${0.04 + rand() * 0.07})`;
          g.fillRect(0, y + rand() * ph, s, 0.6 + rand());
        }
        g.fillStyle = "rgba(60,32,14,0.55)";
        g.fillRect(0, y, s, 1.5);
        g.fillRect(joint, y, 1.5, ph);
        h.fillStyle = grey(200 + Math.floor(rand() * 30));
        h.fillRect(0, y, s, ph);
        h.fillStyle = grey(70);
        h.fillRect(0, y, s, 2);
        h.fillRect(joint, y, 2, ph);
        r!.fillStyle = grey(235);
        r!.fillRect(0, y, s, 2);
      }
      speckle(r!, rand, s, 2500, ["rgba(255,255,255,0.12)", "rgba(0,0,0,0.12)"], 3);
    },
  },
  tiles: {
    size: 512,
    metres: 2.4,
    rough: true,
    paint: (g, h, rand, s, r) => {
      const n = 4;
      const t = s / n;
      g.fillStyle = "#b3a58d";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(110);
      h.fillRect(0, 0, s, s);
      r!.fillStyle = grey(235);
      r!.fillRect(0, 0, s, s);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = (i + j) % 2 ? "#eadfc9" : "#d8c6a6";
          g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
          h.fillStyle = grey(210);
          h.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
          r!.fillStyle = grey(70 + Math.floor(rand() * 25));
          r!.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        }
      speckle(g, rand, s, 2600, ["rgba(120,95,70,0.22)", "rgba(255,255,255,0.3)", "rgba(170,110,80,0.2)"], 2.5);
    },
  },
  paving: {
    size: 256,
    metres: 2,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#8d8474";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(70);
      h.fillRect(0, 0, s, s);
      courses(s, 8, 4, rand, (x, y, w, ph) => {
        g.fillStyle = pick(["#d9cbb0", "#cfc0a4", "#e1d4bb", "#c8b999", "#d4c2a2"], rand);
        g.fillRect(x + 1.5, y + 1.5, w - 3, ph - 3);
        h.fillStyle = grey(190 + Math.floor(rand() * 45));
        h.fillRect(x + 2, y + 2, w - 4, ph - 4);
      });
      speckle(g, rand, s, 1200, ["rgba(90,75,55,0.14)", "rgba(255,250,235,0.14)"]);
      speckle(h, rand, s, 1200, ["rgba(0,0,0,0.12)"]);
    },
  },
  asphalt: {
    size: 256,
    metres: 4,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#565960";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(128);
      h.fillRect(0, 0, s, s);
      speckle(g, rand, s, 5000, ["rgba(255,255,255,0.07)", "rgba(0,0,0,0.12)", "rgba(190,180,160,0.08)"], 2);
      speckle(h, rand, s, 5000, ["rgba(255,255,255,0.2)", "rgba(0,0,0,0.2)"], 2);
    },
  },
  grass: {
    size: 256,
    metres: 5,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#6aa84a";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(128);
      h.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const rr = 20 + rand() * 40;
        for (const dx of [0, s, -s])
          for (const dy of [0, s, -s]) {
            const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
            grad.addColorStop(0, rand() > 0.5 ? "rgba(140,190,80,0.25)" : "rgba(50,110,45,0.22)");
            grad.addColorStop(1, "rgba(100,160,70,0)");
            g.fillStyle = grad;
            g.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
          }
      }
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = pick(["rgba(150,200,90,0.35)", "rgba(60,120,50,0.35)", "rgba(110,170,70,0.3)"], rand);
        const x = rand() * s;
        const y = rand() * s;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
        g.stroke();
      }
      speckle(h, rand, s, 4000, ["rgba(255,255,255,0.2)", "rgba(0,0,0,0.2)"], 2);
    },
  },
  /* Near-white, tinted by the material colour: works for any wood. */
  grain: {
    size: 256,
    metres: 1.2,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(160);
      h.fillRect(0, 0, s, s);
      for (let i = 0; i < 150; i++) {
        const y = rand() * s;
        const w = 0.5 + rand() * 1.6;
        g.fillStyle = `rgba(70,40,15,${0.05 + rand() * 0.13})`;
        g.fillRect(0, y, s, w);
        h.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.15})`;
        h.fillRect(0, y, s, w);
      }
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = "rgba(70,40,15,0.16)";
        g.beginPath();
        g.ellipse(rand() * s, rand() * s, 18 + rand() * 20, 4 + rand() * 4, 0, 0, Math.PI * 2);
        g.stroke();
      }
    },
  },
  fabric: {
    size: 128,
    metres: 0.3,
    paint: (g, h, rand, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      h.fillStyle = grey(128);
      h.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 4) {
        g.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.05})`;
        g.fillRect(i, 0, 1.5, s);
        g.fillRect(0, i, s, 1.5);
        h.fillStyle = grey(70);
        h.fillRect(i, 0, 2, s);
        h.fillRect(0, i, s, 2);
      }
    },
  },
};

const cache = new Map<SurfaceKind, Surface>();
const loose = new Set<THREE.Texture>();

function toTexture(canvas: HTMLCanvasElement, metres: number, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.setScalar(1 / metres);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function surface(kind: SurfaceKind): Surface {
  let out = cache.get(kind);
  if (out) return out;
  const { size, metres, rough, paint } = PAINT[kind];
  const layers = [0, 1, 2].slice(0, rough ? 3 : 2).map(() => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  });
  const [g, h, r] = layers.map((c) => c.getContext("2d")!);
  paint(g, h, mulberry(kind.length * 7919 + kind.charCodeAt(0)), size, r);
  out = { map: toTexture(layers[0], metres, true), bumpMap: toTexture(layers[1], metres, false), roughnessMap: rough ? toTexture(layers[2], metres, false) : undefined };
  cache.set(kind, out);
  return out;
}

/** Track a one-off texture (labels, posters) so it is freed with the rest. */
export function track<T extends THREE.Texture>(t: T): T {
  loose.add(t);
  return t;
}

/** Free GPU memory when the canvas unmounts. Textures re-upload by themselves if the scene mounts again. */
export function disposeTextures() {
  cache.forEach((s) => {
    s.map.dispose();
    s.bumpMap.dispose();
    s.roughnessMap?.dispose();
  });
  loose.forEach((t) => t.dispose());
}
