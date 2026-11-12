// Layouts for the /mindmap and /diagram cards: where every box goes, in px, so the
// cards only draw. Pure. Text is measured by character count (no DOM): good enough
// for boxes that wrap their text at a fixed number of characters.
import type { Flow, MindMap } from "./schemas";

/** Greedy word wrap to at most `maxLines` lines of `maxChars`; what does not fit ends in an ellipsis. */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  const fit = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  if (lines.length > maxLines) fit[maxLines - 1] = `${fit[maxLines - 1].slice(0, maxChars - 1).trimEnd()}…`;
  return fit;
}

// ── Mind map: the centre in the middle, branches to both sides ───────────

export interface MapNode {
  id: string;
  lines: string[];
  /** Centre of the box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 centre · 1 branch · 2 twig · 3 leaf. */
  level: 0 | 1 | 2 | 3;
  /** Which side of the centre (0 for the centre itself). */
  side: -1 | 0 | 1;
  /** Index of the branch it belongs to: its colour. */
  hue: number;
}

export interface MapLink {
  from: string;
  to: string;
  hue: number;
}

const MAP = {
  pad: 24,
  gapX: 46,
  /** [chars per line, lines, px per char, line height, padding x, padding y] per level. */
  text: [
    { chars: 16, lines: 3, cw: 8.6, lh: 19, px: 20, py: 14 },
    { chars: 18, lines: 2, cw: 7.4, lh: 17, px: 14, py: 9 },
    { chars: 24, lines: 2, cw: 6.5, lh: 15, px: 10, py: 7 },
    { chars: 26, lines: 1, cw: 6.2, lh: 15, px: 4, py: 5 },
  ],
  leafGap: 4,
  twigGap: 10,
  branchGap: 22,
} as const;

function box(text: string, level: 0 | 1 | 2 | 3) {
  const t = MAP.text[level];
  const lines = wrapLines(text, t.chars, t.lines);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { lines, w: Math.ceil(longest * t.cw + 2 * t.px), h: lines.length * t.lh + 2 * t.py };
}

/** Every node and link of the map, with the size of the drawing. Branches go to the lighter side in turn, so the two sides balance. */
export function mindMapLayout(map: MindMap): { nodes: MapNode[]; links: MapLink[]; width: number; height: number } {
  const root = box(map.title, 0);
  // Measure each branch: its twigs stack, and each twig is as tall as its own box or its leaves.
  const measured = map.branches.map((b, hue) => {
    const twigs = b.twigs.map((t) => {
      const leaves = t.leaves.map((l) => box(l, 3));
      const leavesH = leaves.reduce((s, l) => s + l.h, 0) + MAP.leafGap * Math.max(0, leaves.length - 1);
      const self = box(t.label, 2);
      return { self, leaves, h: Math.max(self.h, leavesH) };
    });
    const self = box(b.label, 1);
    const twigsH = twigs.reduce((s, t) => s + t.h, 0) + MAP.twigGap * Math.max(0, twigs.length - 1);
    return { hue, self, twigs, h: Math.max(self.h, twigsH) };
  });
  const sides: Record<1 | -1, typeof measured> = { 1: [], [-1]: [] };
  const height = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (const b of measured) {
    const side = height[1] <= height[-1] ? 1 : -1;
    sides[side].push(b);
    height[side] += b.h + MAP.branchGap;
  }
  const widest = (level: 1 | 2 | 3) =>
    Math.max(0, ...measured.flatMap((b) => (level === 1 ? [b.self.w] : b.twigs.flatMap((t) => (level === 2 ? [t.self.w] : t.leaves.map((l) => l.w))))));
  const col1 = root.w / 2 + MAP.gapX;
  const col2 = col1 + widest(1) + MAP.gapX;
  const col3 = col2 + widest(2) + MAP.gapX * 0.6;

  const nodes: MapNode[] = [{ id: "root", ...root, x: 0, y: 0, level: 0, side: 0, hue: 0 }];
  const links: MapLink[] = [];
  for (const side of [1, -1] as const) {
    let y = -(height[side] - MAP.branchGap) / 2;
    for (const b of sides[side]) {
      const bid = `b${b.hue}`;
      nodes.push({ id: bid, ...b.self, x: side * (col1 + b.self.w / 2), y: y + b.h / 2, level: 1, side, hue: b.hue });
      links.push({ from: "root", to: bid, hue: b.hue });
      const twigsH = b.twigs.reduce((s, t) => s + t.h, 0) + MAP.twigGap * Math.max(0, b.twigs.length - 1);
      let ty = y + (b.h - twigsH) / 2;
      b.twigs.forEach((t, ti) => {
        const tid = `${bid}t${ti}`;
        nodes.push({ id: tid, ...t.self, x: side * (col2 + t.self.w / 2), y: ty + t.h / 2, level: 2, side, hue: b.hue });
        links.push({ from: bid, to: tid, hue: b.hue });
        const leavesH = t.leaves.reduce((s, l) => s + l.h, 0) + MAP.leafGap * Math.max(0, t.leaves.length - 1);
        let ly = ty + (t.h - leavesH) / 2;
        t.leaves.forEach((l, li) => {
          const lid = `${tid}l${li}`;
          nodes.push({ id: lid, ...l, x: side * (col3 + l.w / 2), y: ly + l.h / 2, level: 3, side, hue: b.hue });
          links.push({ from: tid, to: lid, hue: b.hue });
          ly += l.h + MAP.leafGap;
        });
        ty += t.h + MAP.twigGap;
      });
      y += b.h + MAP.branchGap;
    }
  }
  // Shift everything so the drawing starts at the padding.
  const minX = Math.min(...nodes.map((n) => n.x - n.w / 2));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w / 2));
  const minY = Math.min(...nodes.map((n) => n.y - n.h / 2));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h / 2));
  for (const n of nodes) {
    n.x += MAP.pad - minX;
    n.y += MAP.pad - minY;
  }
  return { nodes, links, width: Math.ceil(maxX - minX + 2 * MAP.pad), height: Math.ceil(maxY - minY + 2 * MAP.pad) };
}

// ── Flowchart: steps in layers from top to bottom ────────────────────────

export interface FlowBox {
  id: string;
  lines: string[];
  kind: Flow["nodes"][number]["kind"];
  /** Centre of the box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  /** Points back up the chart (a cycle): drawn round the right-hand side. */
  back: boolean;
}

const FLOW = { pad: 28, w: 200, chars: 24, lines: 3, lh: 16, py: 13, gapX: 34, gapY: 54, backLane: 46 } as const;

/** Boxes in layers (a step sits under the last step that leads to it) and the arrows between them, with the size of the drawing. */
export function flowLayout(flow: Flow): { boxes: FlowBox[]; edges: FlowEdge[]; width: number; height: number } {
  const ids = flow.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of flow.edges) out.get(e.from)?.push(e.to);

  // Depth-first from the start steps (then anything not reached): an arrow to a step still being walked closes a cycle.
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const walk = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.get(to)) walk(to);
    }
    state.set(id, 2);
  };
  const starts = flow.nodes.filter((n) => n.kind === "start").map((n) => n.id);
  for (const id of [...starts, ...ids]) if (!state.get(id)) walk(id);

  // Longest path over the forward arrows: every step lands below all that lead to it.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of flow.edges) {
      if (back.has(`${e.from}>${e.to}`)) continue;
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const rows: string[][] = [];
  for (const id of ids) (rows[layer.get(id) ?? 0] ??= []).push(id);
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const boxes: FlowBox[] = [];
  const placed = new Map<string, FlowBox>();
  let y = 0;
  rows.forEach((row, r) => {
    // Under its parents: order a row by where the steps that lead into it sit.
    const parentX = (id: string) => {
      const xs = flow.edges.filter((e) => e.to === id && placed.has(e.from)).map((e) => (placed.get(e.from) as FlowBox).x);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const order = r === 0 ? row : [...row].sort((a, b) => parentX(a) - parentX(b));
    const sized = order.map((id) => {
      const n = byId.get(id) as Flow["nodes"][number];
      const lines = wrapLines(n.label, FLOW.chars, FLOW.lines);
      return { id, lines, kind: n.kind, w: FLOW.w, h: lines.length * FLOW.lh + 2 * FLOW.py + (n.kind === "decision" ? 12 : 0) };
    });
    const rowH = Math.max(...sized.map((b) => b.h));
    sized.forEach((b, i) => {
      const placedBox: FlowBox = { ...b, x: (i - (sized.length - 1) / 2) * (FLOW.w + FLOW.gapX), y: y + rowH / 2 };
      boxes.push(placedBox);
      placed.set(b.id, placedBox);
    });
    y += rowH + FLOW.gapY;
  });

  const edges: FlowEdge[] = flow.edges.map((e) => ({ ...e, back: back.has(`${e.from}>${e.to}`) || (placed.get(e.to)?.y ?? 0) <= (placed.get(e.from)?.y ?? 0) }));
  const minX = Math.min(...boxes.map((b) => b.x - b.w / 2));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w / 2));
  for (const b of boxes) {
    b.x += FLOW.pad - minX;
    b.y += FLOW.pad;
  }
  const lane = edges.some((e) => e.back) ? FLOW.backLane : 0;
  return { boxes, edges, width: Math.ceil(maxX - minX + 2 * FLOW.pad + lane), height: Math.ceil(y - FLOW.gapY + 2 * FLOW.pad) };
}
