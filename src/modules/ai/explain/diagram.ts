// Exploded-view layout for AnatomyCard: parts on a ring around the core, each
// numbered in reading order, links drawn once per connected pair. Pure.
import type { AnatomyPart } from "./schemas";

export interface DiagramNode {
  n: number;
  name: string;
  x: number;
  y: number;
  /** Which side the label sits on, so it never runs over the core. */
  anchor: "start" | "end" | "middle";
}

/** Parts on an ellipse inside a `width` x `height` box; the side margins hold the labels. */
export function explodedLayout(parts: readonly AnatomyPart[], width: number, height: number): { nodes: DiagramNode[]; links: { from: number; to: number }[] } {
  const cx = width / 2;
  const cy = height / 2;
  const nodes = parts.map((p, i): DiagramNode => {
    // Start at 12 o'clock, clockwise.
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / parts.length;
    const x = cx + width * 0.25 * Math.cos(a);
    const y = cy + height * 0.36 * Math.sin(a);
    const anchor = Math.abs(x - cx) < width * 0.04 ? "middle" : x > cx ? "start" : "end";
    return { n: i + 1, name: p.name, x, y, anchor };
  });
  const index = new Map(parts.map((p, i) => [p.name, i]));
  const seen = new Set<string>();
  const links: { from: number; to: number }[] = [];
  parts.forEach((p, i) => {
    for (const name of p.connectsTo) {
      const j = index.get(name);
      if (j === undefined || j === i) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from: Math.min(i, j), to: Math.max(i, j) });
    }
  });
  return { nodes, links };
}
