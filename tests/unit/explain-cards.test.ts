import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnatomyCard } from "@/modules/ai/components/explain/AnatomyCard";
import { InfographicCard, packSpans } from "@/modules/ai/components/explain/InfographicCard";
import { SOURCES_NOTE, type Anatomy, type Infographic } from "@/modules/ai/explain/schemas";

const anatomy: Anatomy = {
  title: "Ceiling fan",
  summary: "An electric motor spins three blades that push air down.",
  parts: [
    { name: "Motor", role: "Turns electricity into spin.", madeOf: "Copper coils", connectsTo: ["Blades", "Capacitor"] },
    { name: "Blades", role: "Push air down.", connectsTo: [] },
    { name: "Capacitor", role: "Gives the motor its starting kick.", connectsTo: ["Motor"] },
  ],
  howItWorks: ["Current reaches the capacitor.", "The motor's rotor turns.", "The blades push air down."],
  failurePoints: [{ what: "Capacitor wears out", why: "Heat ages it", sign: "Fan hums but turns slowly" }],
  tryThis: ["Feel the air at each speed."],
  misconceptions: ["Fans cool the air: they move it; sweat evaporates faster."],
  gradeLevelNote: "Class 7 Science",
};

const infographic: Infographic = {
  title: "The water cycle",
  subtitle: "How the same water keeps moving",
  palette: "ocean",
  blocks: [
    { type: "stat", value: "97%", label: "of Earth's water is salty ocean" },
    { type: "steps", heading: "The loop", items: ["Evaporation", "Condensation", "Precipitation"] },
    { type: "compare", heading: "Rain vs snow", left: "Rain", right: "Snow", rows: [{ aspect: "Temperature", left: "Above 0 °C", right: "Below 0 °C" }] },
    { type: "timeline", heading: "A drop's week", events: [{ when: "Day 1", what: "Evaporates" }, { when: "Day 9", what: "Falls as rain" }] },
    { type: "parts", heading: "Players", items: [{ name: "Sun", role: "Heats water" }, { name: "Clouds", role: "Carry vapour" }] },
    { type: "chart", heading: "Where water is", kind: "pie", series: [{ label: "Oceans", value: 97 }, { label: "Ice", value: 2 }] },
    { type: "callout", text: "You may be drinking water a dinosaur drank." },
  ],
  sources_note: SOURCES_NOTE,
};

describe("AnatomyCard", () => {
  const html = renderToStaticMarkup(
    createElement(AnatomyCard, {
      result: { refused: false, mode: "teardown", depth: "standard", language: "en", anatomy, provider: "cloud", model: "m" },
      onDepthChange: () => {},
      onMakeInfographic: () => {},
    }),
  );

  it("draws a numbered exploded diagram with one line per link", () => {
    expect(html).toContain("<svg");
    expect(html.match(/data-part-node="\d"/g)).toEqual(['data-part-node="1"', 'data-part-node="2"', 'data-part-node="3"']);
    expect(html.match(/data-link=/g)).toHaveLength(2);
  });

  it("shows title, steps in order, failure signs, and the honesty labels", () => {
    expect(html).toContain("Ceiling fan");
    expect(html.indexOf("Current reaches")).toBeLessThan(html.indexOf("blades push air"));
    expect(html).toContain("Fan hums but turns slowly");
    expect(html).toContain("AI-generated");
    expect(html).toContain("Generated in cloud (redacted)");
  });

  it("offers the depth switch and the infographic button", () => {
    expect(html).toContain('role="group" aria-label="Depth"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Standard</);
    expect(html).toContain("Make an infographic");
  });
});

describe("InfographicCard", () => {
  const html = renderToStaticMarkup(createElement(InfographicCard, { result: { refused: false, infographic, provider: "local", model: "m" } }));

  it("renders every block type in reading order with the palette", () => {
    expect(html).toContain('data-ig="ocean"');
    for (const t of ["stat", "steps", "compare", "timeline", "parts", "chart", "callout"]) expect(html).toContain(`data-block="${t}"`);
    expect(html.indexOf("97%")).toBeLessThan(html.indexOf("dinosaur"));
  });

  it("labels the poster as AI-generated and offers PDF, not a fake PNG", () => {
    expect(html).toContain(SOURCES_NOTE);
    expect(html).toContain("Generated locally");
    expect(html).toContain("Save as PDF");
    expect(html).not.toContain("PNG");
  });

  it("gives the chart a text summary for screen readers", () => {
    expect(html).toContain("Oceans: 97");
  });
});

describe("packSpans", () => {
  it("widens the block before a gap so every row is full, in reading order", () => {
    // stat, steps, pie, compare, bar, callout(full)
    expect(packSpans([1, 1, 1, 2, 2, 0], 2)).toEqual([1, 1, 2, 2, 2, 2]);
    expect(packSpans([1, 1, 1, 2, 2, 0], 3)).toEqual([1, 1, 1, 3, 3, 3]);
  });

  it("fills a half-empty last row", () => {
    expect(packSpans([2, 1], 2)).toEqual([2, 2]);
    expect(packSpans([1, 1, 2, 1], 3)).toEqual([1, 2, 2, 1]);
  });
});
