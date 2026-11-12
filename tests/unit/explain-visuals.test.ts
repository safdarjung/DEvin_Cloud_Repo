import { describe, expect, it } from "vitest";
import { ORB_COMMANDS, parseOrbCommand } from "@/modules/ai/explain/commands";
import {
  FlowSchema, MindMapSchema, VisualRequestSchema, toFlow, toMindMap,
  type Flow, type FlowGeneration, type MindMap, type MindMapGeneration,
} from "@/modules/ai/explain/schemas";
import { flowLayout, mindMapLayout, wrapLines } from "@/modules/ai/explain/visuals";

const mapGen = (over: Partial<MindMapGeneration> = {}): MindMapGeneration => ({
  refusal: "",
  title: "  Photosynthesis ",
  branches: [
    { label: "Inputs", twigs: [{ label: "Sunlight", leaves: ["Absorbed by chlorophyll", "", "Red and blue light", "extra", "extra 2"] }, { label: "", leaves: [] }, { label: "Water", leaves: [] }] },
    { label: "Outputs", twigs: [{ label: "Glucose", leaves: ["Stored as starch"] }, { label: "Oxygen", leaves: [] }] },
    { label: "inputs", twigs: [] },
    { label: "Where", twigs: [{ label: "Chloroplasts", leaves: [] }] },
    { label: "Why it matters", twigs: [] },
  ],
  ...over,
});

const flowGen = (over: Partial<FlowGeneration> = {}): FlowGeneration => ({
  refusal: "",
  title: "Admission",
  steps: [
    { id: "S1", label: "Parent sends an enquiry", kind: "start", next: [{ to: "s2", label: "" }] },
    { id: "s2", label: "Is a seat free?", kind: "decision", next: [{ to: "s3", label: "Yes" }, { to: "s4", label: "No" }, { to: "ghost", label: "" }, { to: "s2", label: "" }] },
    { id: "s3", label: "Offer the seat", kind: "step", next: [{ to: "s5", label: "" }, { to: "s5", label: "again" }] },
    { id: "s4", label: "Add to the waiting list", kind: "step", next: [{ to: "s2", label: "A seat opens" }] },
    { id: "s5", label: "Enrol the student", kind: "end", next: [] },
    { id: "s2", label: "A repeated id", kind: "step", next: [] },
    { id: "s9", label: "Nothing leads here or away", kind: "step", next: [] },
  ],
  ...over,
});

describe("wrapLines", () => {
  it("wraps on words and marks what did not fit", () => {
    expect(wrapLines("How light becomes food", 12, 3)).toEqual(["How light", "becomes food"]);
    expect(wrapLines("one two three four five six", 9, 2)).toEqual(["one two", "three…"]);
    expect(wrapLines("Supercalifragilistic", 8, 2)).toEqual(["Superca…"]);
    expect(wrapLines("   ", 8, 2)).toEqual([]);
  });
});

describe("toMindMap", () => {
  it("clips, drops blanks and repeated branches, and caps the leaves", () => {
    const m = toMindMap(mapGen()) as MindMap;
    expect(m.title).toBe("Photosynthesis");
    expect(m.branches.map((b) => b.label)).toEqual(["Inputs", "Outputs", "Where", "Why it matters"]);
    expect(m.branches[0].twigs.map((t) => t.label)).toEqual(["Sunlight", "Water"]);
    expect(m.branches[0].twigs[0].leaves).toHaveLength(3);
    expect(MindMapSchema.safeParse(m).success).toBe(true);
  });

  it("is null with too few branches or no title", () => {
    expect(toMindMap(mapGen({ branches: mapGen().branches.slice(0, 2) }))).toBeNull();
    expect(toMindMap(mapGen({ title: " " }))).toBeNull();
  });
});

describe("toFlow", () => {
  it("keeps only steps that are joined, and arrows between steps that exist", () => {
    const f = toFlow(flowGen()) as Flow;
    expect(f.nodes.map((n) => n.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(f.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["s1>s2", "s2>s3", "s2>s4", "s3>s5", "s4>s2"]);
    expect(f.edges.find((e) => e.from === "s2" && e.to === "s4")?.label).toBe("No");
    expect(FlowSchema.safeParse(f).success).toBe(true);
  });

  it("is null when nothing is joined", () => {
    expect(toFlow(flowGen({ steps: flowGen().steps.map((s) => ({ ...s, next: [] })) }))).toBeNull();
  });
});

describe("VisualRequestSchema", () => {
  it("needs a topic and takes nothing else", () => {
    expect(VisualRequestSchema.safeParse({ institutionSlug: "s", topic: "Water cycle" }).success).toBe(true);
    expect(VisualRequestSchema.safeParse({ institutionSlug: "s", topic: " " }).success).toBe(false);
    expect(VisualRequestSchema.safeParse({ institutionSlug: "s", topic: "x", studentId: "1" }).success).toBe(false);
  });
});

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe("mindMapLayout", () => {
  const layout = mindMapLayout(toMindMap(mapGen()) as MindMap);

  it("puts the centre between branches on both sides, inside the drawing", () => {
    const root = layout.nodes.find((n) => n.level === 0);
    expect(root).toBeDefined();
    expect(layout.nodes.some((n) => n.side === 1)).toBe(true);
    expect(layout.nodes.some((n) => n.side === -1)).toBe(true);
    for (const n of layout.nodes) {
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(layout.width);
      expect(n.y - n.h / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(layout.height);
      if (n.level > 0) expect(Math.sign(n.x - (root?.x ?? 0))).toBe(n.side);
    }
  });

  it("never lays one box over another, and links every box but the centre to its parent", () => {
    for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) expect(overlap(layout.nodes[i], layout.nodes[j])).toBe(false);
    expect(layout.links).toHaveLength(layout.nodes.length - 1);
    const ids = new Set(layout.nodes.map((n) => n.id));
    expect(ids.size).toBe(layout.nodes.length);
    for (const l of layout.links) expect(ids.has(l.from) && ids.has(l.to)).toBe(true);
  });
});

describe("flowLayout", () => {
  const flow = toFlow(flowGen()) as Flow;
  const layout = flowLayout(flow);
  const at = (id: string) => layout.boxes.find((b) => b.id === id) as (typeof layout.boxes)[number];

  it("puts each step below the steps that lead to it, without overlaps, inside the drawing", () => {
    for (const e of layout.edges.filter((x) => !x.back)) expect(at(e.to).y).toBeGreaterThan(at(e.from).y);
    for (let i = 0; i < layout.boxes.length; i++) for (let j = i + 1; j < layout.boxes.length; j++) expect(overlap(layout.boxes[i], layout.boxes[j])).toBe(false);
    for (const b of layout.boxes) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(layout.height);
    }
  });

  it("marks the arrow that closes a cycle, and only that one", () => {
    expect(layout.edges.filter((e) => e.back).map((e) => `${e.from}>${e.to}`)).toEqual(["s4>s2"]);
  });

  it("lays out a pure cycle (no end) without looping forever", () => {
    const cycle: Flow = {
      title: "Water cycle",
      nodes: [{ id: "a", label: "Evaporation", kind: "start" }, { id: "b", label: "Condensation", kind: "step" }, { id: "c", label: "Rain", kind: "step" }],
      edges: [{ from: "a", to: "b", label: "" }, { from: "b", to: "c", label: "" }, { from: "c", to: "a", label: "" }],
    };
    const l = flowLayout(cycle);
    expect(l.boxes).toHaveLength(3);
    expect(l.edges.filter((e) => e.back)).toHaveLength(1);
  });
});

describe("orb commands for visuals", () => {
  it("reads /mindmap and /diagram", () => {
    expect(parseOrbCommand("/mindmap French Revolution")).toEqual({ command: "mindmap", arg: "French Revolution" });
    expect(parseOrbCommand("/diagram how a bill becomes law")).toEqual({ command: "diagram", arg: "how a bill becomes law" });
    expect(ORB_COMMANDS.map((c) => c.name)).toContain("mindmap");
    expect(ORB_COMMANDS.map((c) => c.name)).toContain("diagram");
  });
});

describe("naturalVisualRequest", () => {
  it("turns a clear request with a topic into a mind map or flowchart", async () => {
    const { naturalVisualRequest } = await import("@/modules/ai/explain/commands");
    expect(naturalVisualRequest("make a mind map of the water cycle")).toEqual({ command: "mindmap", arg: "the water cycle" });
    expect(naturalVisualRequest("Draw a flowchart for how admission works.")).toEqual({ command: "diagram", arg: "how admission works" });
    expect(naturalVisualRequest("create mind map for Forces and Energy unit and flashcards")).toEqual({ command: "mindmap", arg: "Forces and Energy unit" });
    expect(naturalVisualRequest("make a mind map and flashcards for Forces and Energy unit")).toEqual({ command: "mindmap", arg: "Forces and Energy unit" });
    expect(naturalVisualRequest("make me a diagram of the human heart")).toEqual({ command: "diagram", arg: "the human heart" });
  });
  it("leaves questions, bare words and commands to the chat", async () => {
    const { naturalVisualRequest } = await import("@/modules/ai/explain/commands");
    expect(naturalVisualRequest("what is a mind map?")).toBeNull();
    expect(naturalVisualRequest("mind map")).toBeNull();
    expect(naturalVisualRequest("make a mind map")).toBeNull();
    expect(naturalVisualRequest("/mindmap the heart")).toBeNull();
    expect(naturalVisualRequest("explain the diagram on page 4 of my book")).toBeNull();
  });
});

describe("flashcards", () => {
  it("toFlashcards drops blanks and repeated fronts and caps the deck", async () => {
    const { toFlashcards } = await import("@/modules/ai/explain/schemas");
    const card = (n: number) => ({ front: `Q${n}?`, back: `A${n}` });
    const g = { refusal: "", title: " Force ", cards: [card(1), { front: "q1?", back: "dup" }, { front: "", back: "x" }, card(2), card(3), card(4), card(5), ...Array.from({ length: 20 }, (_, i) => card(i + 10))] };
    const d = toFlashcards(g);
    expect(d?.title).toBe("Force");
    expect(d?.cards.map((c) => c.front).slice(0, 5)).toEqual(["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]);
    expect(d?.cards).toHaveLength(16);
    expect(toFlashcards({ refusal: "", title: "T", cards: [card(1), card(2)] })).toBeNull();
  });
  it("reads /flashcards and 'make flashcards for X'", async () => {
    const { naturalVisualRequest, parseOrbCommand } = await import("@/modules/ai/explain/commands");
    expect(parseOrbCommand("/flashcards photosynthesis")).toEqual({ command: "flashcards", arg: "photosynthesis" });
    expect(naturalVisualRequest("make flashcards for photosynthesis")).toEqual({ command: "flashcards", arg: "photosynthesis" });
    expect(naturalVisualRequest("can you make flashcards for me?")).toBeNull();
  });
  it("every chat is told it cannot draw, unless the study-blocks tool is on", async () => {
    const { NO_DRAWING_RULE, VISUALS_ONLY_VIA_TOOL_RULE } = await import("@/modules/ai/prompts/honesty");
    expect(NO_DRAWING_RULE).toMatch(/never say or imply that you did/);
    expect(NO_DRAWING_RULE).toMatch(/\/mindmap/);
    expect(VISUALS_ONLY_VIA_TOOL_RULE).toMatch(/showStudyBlocks/);
  });
});
