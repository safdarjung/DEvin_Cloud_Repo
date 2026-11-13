// Shared geometry for the FabricOS hero: the 3D scene and the static SVG
// fallback both read these positions, edges and stage rules, so the two
// renderings always show the same system at the same story stage.
import { NODES, STORY, type NodeKind } from "../content";

export type Vec3 = readonly [number, number, number];

/** Hero (first viewport) shows the whole system; story steps are 0..STORY.length-1. */
export const HERO_STAGE = -1;
export const LAST_STEP = STORY.length - 1;

/** Positions in scene units, core at the origin. Spread in x/y, depth in z. */
export const POS: Record<string, Vec3> = {
  core: [0, 0, 0],
  people: [-3.0, 1.05, 0.8],
  departments: [-2.75, -1.25, -0.6],
  workflows: [-0.95, -2.3, 1.0],
  automation: [1.55, -2.0, -0.8],
  agents: [3.0, -0.3, 0.7],
  information: [2.3, 1.7, -0.9],
  insights: [0.15, 2.4, 0.4],
};

export const KIND_COLOR: Record<NodeKind, string> = {
  core: "#8b93ff",
  people: "#c7cbff",
  agent: "#67d7ea",
  information: "#8b93ff",
  workflow: "#a9b0ff",
  automation: "#67d7ea",
  insight: "#eef0f6",
};

const KIND_BY_ID = new Map(NODES.map((n) => [n.id, n.kind]));

/** First story step whose `reveal` includes this kind. */
export function kindStep(kind: NodeKind): number {
  const i = STORY.findIndex((s) => s.reveal.includes(kind));
  return i < 0 ? 0 : i;
}

export function nodeStep(id: string): number {
  const kind = KIND_BY_ID.get(id);
  return kind ? kindStep(kind) : 0;
}

export interface Edge {
  a: string;
  b: string;
  /** Story step from which the pathway carries traffic. */
  step: number;
}

// Peripheral pathways: how work moves between parts of the institution.
const CROSS: readonly [string, string, number][] = [
  ["people", "workflows", 2],
  ["departments", "workflows", 2],
  ["workflows", "automation", 2],
  ["agents", "workflows", 3],
  ["agents", "information", 4],
  ["information", "insights", 4],
  ["insights", "people", 5],
  ["departments", "information", 5],
  ["automation", "agents", 5],
];

/** Spokes from the core connect from step 2 ("work flows between them"). */
export const EDGES: readonly Edge[] = [
  ...NODES.filter((n) => n.id !== "core").map((n) => ({ a: "core", b: n.id, step: Math.max(2, kindStep(n.kind)) })),
  ...CROSS.map(([a, b, s]) => ({ a, b, step: Math.max(s, nodeStep(a), nodeStep(b)) })),
];

export const isNodeOn = (id: string, stage: number) => stage === HERO_STAGE || nodeStep(id) <= stage;
export const isEdgeOn = (e: Edge, stage: number) => stage === HERO_STAGE || e.step <= stage;
/** Both ends are visible but the pathway is not active yet: drawn faint, no traffic. */
export const isEdgeDormant = (e: Edge, stage: number) =>
  !isEdgeOn(e, stage) && isNodeOn(e.a, stage) && isNodeOn(e.b, stage);

/** Control point for a quadratic pathway: bowed sideways and lifted toward the viewer. */
export function controlPoint(a: Vec3, b: Vec3): Vec3 {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const mz = (a[2] + b[2]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const r = Math.hypot(mx, my) || 1;
  const outward = r > 0.5 ? 0.22 : 0;
  const bow = 0.16;
  return [mx - dy * bow + (mx / r) * outward, my + dx * bow + (my / r) * outward, mz + 0.55];
}

/** Stage-specific framing multiplier: the core alone is shown larger. */
export function stageZoom(stage: number): number {
  if (stage === HERO_STAGE) return 1;
  return [1.6, 1.2, 1.05, 1.04, 1, 0.95][stage] ?? 1;
}
