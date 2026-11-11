import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { buildOrbGroups, groupIdFor, pushRecent, searchPrompts } from "@/modules/ai/components/orb/orb-groups";

const chipsFor = (keys: readonly CapabilityKey[], appHrefs: string[] = [], chatOn = true) => orbChips(keys, { slug: "demo", appHrefs, chatOn });

describe("buildOrbGroups", () => {
  it("one group per section the role has a capability in, in a fixed order, with a count", () => {
    const groups = buildOrbGroups(chipsFor(["finance_overview", "attendance_overview", "exam_overview"]), "principal");
    expect(groups.map((g) => g.id)).toEqual(["attendance", "exams", "finance"]);
    for (const g of groups) expect(g.count).toBe(g.prompts.length + g.tools.length);
  });

  it("a role without a capability gets no such group (nothing is invented client-side)", () => {
    const groups = buildOrbGroups(chipsFor(["child_attendance", "child_results"]), "guardian");
    expect(groups.map((g) => g.id)).toEqual(["attendance", "exams"]);
    expect(groups.some((g) => g.id === "finance")).toBe(false);
    expect(buildOrbGroups([], "teacher")).toEqual([]);
  });

  it("with chat off only linked tools remain, so a group with no link disappears", () => {
    const apps = ["/demo/question-bank"];
    const groups = buildOrbGroups(chipsFor(["question_paper_builder", "attendance_overview"], apps, false), "teacher", false);
    expect(groups.map((g) => g.id)).toEqual(["teaching"]);
    expect(groups[0].prompts).toEqual([]);
    expect(groups[0].tools[0]).toMatchObject({ key: "question_paper_builder", href: "/demo/question-bank" });
  });

  it("drafting tools are tools: a page task links to its page, a chat draft starts a prompt", () => {
    const [g] = buildOrbGroups(chipsFor(["lesson_plan_writer", "lesson_plan_draft"], ["/demo/lesson-plans"]), "teacher");
    expect(g.tools.find((t) => t.key === "lesson_plan_writer")?.href).toBe("/demo/lesson-plans");
    const draft = g.tools.find((t) => t.key === "lesson_plan_draft");
    expect(draft?.href).toBeUndefined();
    expect(draft?.prompt).toMatch(/lesson plan/i);
  });

  it("tops a thin section up to four prompts from vetted page starters, never above six, without repeats", () => {
    const [g] = buildOrbGroups(chipsFor(["attendance_overview"]), "principal");
    expect(g.prompts.length).toBeGreaterThanOrEqual(4);
    expect(g.prompts.length).toBeLessThanOrEqual(6);
    expect(new Set(g.prompts).size).toBe(g.prompts.length);
  });

  it("student-only capabilities land in Study; every catalog capability lands in some group", () => {
    expect(groupIdFor("hints_first")).toBe("study");
    expect(groupIdFor("exam_prep")).toBe("study");
    const all = chipsFor(CAPABILITY_KEYS);
    const ids = new Set(buildOrbGroups(all, "owner").flatMap((g) => [...g.prompts.map(() => g.id), ...g.tools.map(() => g.id)]));
    expect(ids.size).toBeGreaterThan(5);
    expect(all.every((c) => groupIdFor(c.key))).toBe(true);
  });
});

describe("searchPrompts", () => {
  const groups = [
    { id: "attendance" as const, label: "Attendance", prompts: ["Which sections are below the attendance threshold today?", "Show this term's attendance pattern."] },
    { id: "finance" as const, label: "Finance", prompts: ["Summarise term fee collection.", "List attendance-linked fee waivers."] },
  ];

  it("needs every word, ranks a prompt that starts with the query first, and keeps group labels", () => {
    const hits = searchPrompts(groups, "show");
    expect(hits[0]).toMatchObject({ groupId: "attendance", text: "Show this term's attendance pattern." });
    expect(searchPrompts(groups, "term fee").map((h) => h.text)).toEqual(["Summarise term fee collection."]);
  });

  it("matches the group name, ignores case, dedupes, and is empty for a blank or unknown query", () => {
    expect(searchPrompts(groups, "FINANCE").map((h) => h.groupId)).toEqual(["finance", "finance"]);
    expect(searchPrompts(groups, "   ")).toEqual([]);
    expect(searchPrompts(groups, "zzz")).toEqual([]);
    expect(searchPrompts([...groups, groups[0]], "attendance").length).toBe(3);
  });

  it("limits the result count", () => {
    expect(searchPrompts(groups, "a", 2)).toHaveLength(2);
  });
});

describe("pushRecent", () => {
  it("puts the newest first, drops repeats, caps at five and ignores blanks", () => {
    let list: string[] = [];
    for (const p of ["a", "b", "c", "d", "e", "f"]) list = pushRecent(list, p);
    expect(list).toEqual(["f", "e", "d", "c", "b"]);
    expect(pushRecent(list, "d")).toEqual(["d", "f", "e", "c", "b"]);
    expect(pushRecent(list, "  ")).toEqual(list);
  });
});
