import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { buildOrbFeatures, groupIdFor } from "@/modules/ai/components/orb/orb-groups";
import { groupsFor, pushRecent } from "@/modules/ai/components/orb/orb-modes";

const chipsFor = (keys: readonly CapabilityKey[], appHrefs: string[] = [], chatOn = true) => orbChips(keys, { slug: "demo", appHrefs, chatOn });
const build = (keys: readonly CapabilityKey[], role: Parameters<typeof buildOrbFeatures>[2], appHrefs: string[] = [], chatOn = true) =>
  buildOrbFeatures(chipsFor(keys, appHrefs, chatOn), [], role, chatOn);

describe("buildOrbFeatures (Ask and Create from capabilities)", () => {
  it("one Ask section per section the role has a capability in, in a fixed order", () => {
    const groups = groupsFor(build(["finance_overview", "attendance_overview", "exam_overview"], "principal"), "ask");
    expect(groups.map((g) => g.id)).toEqual(["attendance", "exams", "finance"]);
  });

  it("a role without a capability gets no such section (nothing is invented client-side)", () => {
    const groups = groupsFor(build(["child_attendance", "child_results"], "guardian"), "ask");
    expect(groups.map((g) => g.id)).toEqual(["attendance", "exams"]);
    expect(build([], "teacher")).toEqual([]);
  });

  it("with chat off only linked tools remain, so a section with no link disappears", () => {
    const f = build(["question_paper_builder", "attendance_overview"], "teacher", ["/demo/question-bank"], false);
    expect(f).toEqual([
      { key: "question_paper_builder", label: expect.any(String), mode: "create", groupId: "teaching", kind: "open", href: "/demo/question-bank" },
    ]);
  });

  it("drafting tools sit in Create: a page task links to its page, a chat draft starts a prompt", () => {
    const [g] = groupsFor(build(["lesson_plan_writer", "lesson_plan_draft"], "teacher", ["/demo/lesson-plans"]), "create");
    expect(g.features.find((t) => t.key === "lesson_plan_writer")).toMatchObject({ kind: "open", href: "/demo/lesson-plans" });
    const draft = g.features.find((t) => t.key === "lesson_plan_draft");
    expect(draft).toMatchObject({ kind: "ask", mode: "create" });
    expect(draft?.prompt).toMatch(/lesson plan/i);
  });

  it("tops a thin section up to four prompts from vetted page starters, never above six, without repeats", () => {
    const [g] = groupsFor(build(["attendance_overview"], "principal"), "ask");
    const prompts = g.features.map((f) => f.prompt);
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(prompts.length).toBeLessThanOrEqual(6);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("student-only capabilities land in Study; every catalog capability lands in some section", () => {
    expect(groupIdFor("hints_first")).toBe("study");
    expect(groupIdFor("exam_prep")).toBe("study");
    const all = chipsFor(CAPABILITY_KEYS);
    const ids = new Set(buildOrbFeatures(all, [], "owner").map((f) => f.groupId));
    expect(ids.size).toBeGreaterThan(5);
    expect(all.every((c) => groupIdFor(c.key))).toBe(true);
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
