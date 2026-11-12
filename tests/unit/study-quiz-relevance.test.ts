import { describe, expect, it } from "vitest";
import { FORMAT_RULES } from "@/modules/study/formats";
import { StudyGenerateRequestSchema } from "@/modules/study/schemas";
import { buildStudyPrompt } from "@/modules/ai/prompts/study";

const base = { format: "quiz" as const, gradeLabel: "Class 9", subjectName: "Science", sourceLabel: "a curriculum unit", sourceLines: ["Unit: Motion", "Outline: speed, velocity, graphs"] };
const quiz = { count: 5, difficulty: "medium", types: ["mcq"] as const };

describe("quiz relevance", () => {
  it("the quiz rule asks for source-bound, varied, well-distracted questions", () => {
    const r = FORMAT_RULES.quiz;
    expect(r).toMatch(/Relevance comes first/);
    expect(r).toMatch(/never ask the same thing twice/);
    expect(r).toMatch(/mistakes students really make/);
    expect(r).toMatch(/no 'all of the above'/);
    expect(r).toMatch(/exactly 4 different options/);
  });

  it("a typed focus goes in the data block with the source, not in the instructions", () => {
    const p = buildStudyPrompt({ ...base, quiz: { ...quiz, focus: "distance-time graphs" } });
    const [before, after] = p.split(/Unit: Motion/);
    expect(after).toContain("distance-time graphs");
    expect(before).not.toContain("distance-time graphs");
    expect(buildStudyPrompt({ ...base, quiz })).not.toMatch(/Focus the questions/);
  });

  it("accepts an optional focus, trims it and caps it", () => {
    const req = (focus?: string) => StudyGenerateRequestSchema.safeParse({ institutionSlug: "s", format: "quiz", source: { kind: "paste", text: "Notes about motion and speed. ".repeat(20) }, quiz: { count: 5, difficulty: "easy", types: ["mcq"], ...(focus === undefined ? {} : { focus }) } });
    expect(req().success).toBe(true);
    expect(req("  graphs ").success && req("  graphs ").data?.quiz?.focus).toBe("graphs");
    expect(req("x".repeat(201)).success).toBe(false);
  });
});
