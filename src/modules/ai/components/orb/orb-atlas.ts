// Bakes the orb's lucide icons into ONE texture atlas (a canvas grid), so every
// icon on the sphere is drawn in a single draw call by sampling its cell.
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

/** Cells per atlas row/column (8 x 8 = 64 icons; the orb needs ~45 unique ones at most). */
export const ATLAS_GRID = 8;
const CELL_PX = 96;
const PAD_PX = 8;

/** `svgs[i]` (white stroke) lands in cell i, row-major from the top-left. */
export async function bakeAtlas(svgs: readonly SVGElement[]): Promise<CanvasTexture> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_GRID * CELL_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const xml = new XMLSerializer();
  await Promise.all(
    svgs.slice(0, ATLAS_GRID * ATLAS_GRID).map(async (svg, i) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml.serializeToString(svg))}`;
      await img.decode();
      const size = CELL_PX - PAD_PX * 2;
      ctx.drawImage(img, (i % ATLAS_GRID) * CELL_PX + PAD_PX, Math.floor(i / ATLAS_GRID) * CELL_PX + PAD_PX, size, size);
    }),
  );
  const tex = new CanvasTexture(canvas);
  // Point sprites address the canvas top-left first, like gl_PointCoord.
  tex.flipY = false;
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Resolve any CSS colour (e.g. `var(--card)`, oklch) to "rgb(r, g, b)", which three.js can parse. */
export function cssColor(value: string, scope: Element): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  scope.appendChild(probe);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
  }
  probe.remove();
  const [r, g, b] = ctx?.getImageData(0, 0, 1, 1).data ?? [128, 128, 128];
  return `rgb(${r}, ${g}, ${b})`;
}
