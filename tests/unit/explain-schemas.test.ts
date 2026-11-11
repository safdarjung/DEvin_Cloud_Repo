import { describe, expect, it } from "vitest";
import { explodedLayout } from "@/modules/ai/explain/diagram";
import {
  AnatomyRequestSchema,
  AnatomySchema,
  InfographicRequestSchema,
  InfographicSchema,
  blockedTopic,
  toAnatomy,
  toInfographic,
  type AnatomyGeneration,
  type InfographicGeneration,
} from "@/modules/ai/explain/schemas";

const SLUG = "st-josephs-demo";

function anatomyGen(over: Partial<AnatomyGeneration> = {}): AnatomyGeneration {
  return {
    refusal: "",
    title: "Ceiling fan",
    summary: "A motor spins blades that push air down.",
    parts: [
      { name: "Motor", role: "Turns electricity into spin", madeOf: "Copper coils", connectsTo: ["Blades", "Capacitor", "Motor", "Ghost"] },
      { name: "Blades", role: "Push air", madeOf: "", connectsTo: [] },
      { name: "Capacitor", role: "Starts the motor", madeOf: "", connectsTo: ["motor"] },
    ],
    howItWorks: ["Current reaches the motor.", "The rotor spins.", "Blades push air."],
    failurePoints: [{ what: "Capacitor", why: "Wears out", sign: "Fan hums but turns slowly" }],
    tryThis: ["Feel the airflow at each speed setting."],
    misconceptions: ["Fans cool the air."],
    gradeLevelNote: "Fits Class 7 science.",
    ...over,
  };
}

describe("explain request schemas", () => {
  it("accepts a teardown request with defaults", () => {
    const r = AnatomyRequestSchema.parse({ institutionSlug: SLUG, subject: "a ceiling fan", mode: "teardown", depth: "standard" });
    expect(r.language).toBe("en");
  });

  it("needs a subject or a documentId", () => {
    expect(AnatomyRequestSchema.safeParse({ institutionSlug: SLUG, subject: " ", mode: "anatomy", depth: "simple" }).success).toBe(false);
    expect(
      AnatomyRequestSchema.safeParse({ institutionSlug: SLUG, subject: "", mode: "anatomy", depth: "simple", documentId: "8d7c2b8e-6f1a-4d55-9a3e-2f1b0c9d4e11" }).success,
    ).toBe(true);
  });

  it("rejects unknown keys and modes", () => {
    expect(AnatomyRequestSchema.safeParse({ institutionSlug: SLUG, subject: "x", mode: "dissect", depth: "simple" }).success).toBe(false);
    expect(AnatomyRequestSchema.safeParse({ institutionSlug: SLUG, subject: "x", mode: "anatomy", depth: "simple", studentId: "1" }).success).toBe(false);
  });

  it("infographic takes an anatomy result as its source", () => {
    const anatomy = toAnatomy(anatomyGen());
    expect(anatomy).not.toBeNull();
    const r = InfographicRequestSchema.safeParse({ institutionSlug: SLUG, topic: "ceiling fan", audience: "student", fromAnatomy: anatomy });
    expect(r.success).toBe(true);
  });
});

describe("toAnatomy", () => {
  it("drops self, unknown and duplicate links, matching names case-insensitively", () => {
    const a = toAnatomy(anatomyGen())!;
    expect(a.parts[0].connectsTo).toEqual(["Blades", "Capacitor"]);
    expect(a.parts[2].connectsTo).toEqual(["Motor"]);
    expect(a.parts[1].madeOf).toBeUndefined();
    expect(AnatomySchema.safeParse(a).success).toBe(true);
  });

  it("caps long lists instead of failing", () => {
    const parts = Array.from({ length: 14 }, (_, i) => ({ name: `Part ${i}`, role: "r", madeOf: "", connectsTo: [] }));
    const a = toAnatomy(anatomyGen({ parts, howItWorks: Array.from({ length: 12 }, (_, i) => `Step ${i}`) }))!;
    expect(a.parts).toHaveLength(10);
    expect(a.howItWorks).toHaveLength(8);
  });

  it("returns null when too thin to draw", () => {
    expect(toAnatomy(anatomyGen({ parts: [{ name: "Only", role: "r", madeOf: "", connectsTo: [] }] }))).toBeNull();
    expect(toAnatomy(anatomyGen({ howItWorks: ["one"] }))).toBeNull();
  });
});

function igGen(blocks: InfographicGeneration["blocks"]): InfographicGeneration {
  return { refusal: "", title: "Water cycle", subtitle: "How water moves", palette: "ocean", blocks };
}
const blank = { heading: "", value: "", label: "", items: [], parts: [], events: [], left: "", right: "", rows: [], text: "", chartKind: "bar" as const, series: [] };

describe("toInfographic", () => {
  it("maps the flat frame onto typed blocks and drops malformed ones", () => {
    const ig = toInfographic(
      igGen([
        { ...blank, type: "stat", value: "97%", label: "of Earth's water is in the oceans" },
        { ...blank, type: "steps", heading: "The loop", items: ["Evaporation", "Condensation", "Precipitation"] },
        { ...blank, type: "chart", heading: "Where water is", chartKind: "pie", series: [{ label: "Oceans", value: 97 }, { label: "Ice", value: 2 }, { label: "Bad", value: -1 }] },
        { ...blank, type: "compare", heading: "", left: "", right: "", rows: [] },
        { ...blank, type: "callout", text: "The same water has cycled for billions of years." },
      ]),
    )!;
    expect(ig.blocks.map((b) => b.type)).toEqual(["stat", "steps", "chart", "callout"]);
    const chart = ig.blocks[2];
    expect(chart.type === "chart" && chart.series).toEqual([{ label: "Oceans", value: 97 }, { label: "Ice", value: 2 }]);
    expect(ig.sources_note).toMatch(/AI-generated/);
    expect(InfographicSchema.safeParse(ig).success).toBe(true);
  });

  it("keeps at most 7 blocks and 8 chart bars", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({ label: `s${i}`, value: i + 1 }));
    const blocks = Array.from({ length: 9 }, () => ({ ...blank, type: "chart" as const, series }));
    const ig = toInfographic(igGen(blocks))!;
    expect(ig.blocks).toHaveLength(7);
    const first = ig.blocks[0];
    expect(first.type === "chart" && first.series.length).toBe(8);
  });

  it("returns null with fewer than 3 usable blocks", () => {
    expect(toInfographic(igGen([{ ...blank, type: "callout", text: "x" }, { ...blank, type: "steps", items: [] }]))).toBeNull();
  });
});

describe("blockedTopic", () => {
  it("blocks weapons, drugs, self-harm and lock bypassing", () => {
    for (const s of ["teardown a pistol", "how to make a bomb", "anatomy of cocaine", "ways to self-harm", "pick a padlock", "bypass the school wifi password"]) {
      expect(blockedTopic(s), s).not.toBeNull();
    }
  });

  it("allows ordinary school topics", () => {
    for (const s of ["human heart", "a ceiling fan", "water cycle", "how a lock works", "a sonnet's structure", "long division", "drug resistance in bacteria"]) {
      expect(blockedTopic(s), s).toBeNull();
    }
  });
});

describe("explodedLayout", () => {
  it("places every part around the core and draws each link once", () => {
    const a = toAnatomy(anatomyGen())!;
    const d = explodedLayout(a.parts, 600, 400);
    expect(d.nodes).toHaveLength(3);
    expect(d.nodes.map((n) => n.n)).toEqual([1, 2, 3]);
    expect(d.nodes[0].anchor).toBe("middle");
    for (const n of d.nodes) {
      expect(Math.hypot(n.x - 300, n.y - 200)).toBeGreaterThan(80);
      expect(n.x).toBeGreaterThan(100);
      expect(n.x).toBeLessThan(500);
    }
    // Motor-Blades, Motor-Capacitor (Capacitor->Motor is the same link).
    expect(d.links).toEqual([
      { from: 0, to: 1 },
      { from: 0, to: 2 },
    ]);
  });
});
