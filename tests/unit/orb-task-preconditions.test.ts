import { describe, expect, it } from "vitest";
import { statusAllows, statusBlock } from "@/modules/ai/tasks/preconditions";

const pt3 = { label: "Periodic Test 3 (Grade X)", status: "marks_entry" };

describe("orb task preconditions (exam workflow)", () => {
  it("reopen marks entry only offers exams in verification", () => {
    expect(statusAllows("exam.marks_entry.reopen", "exam", pt3)).toBe(false);
    expect(statusAllows("exam.marks_entry.reopen", "exam", { status: "verification" })).toBe(true);
  });

  it("open needs a draft, close needs open marks entry, publish needs verification", () => {
    expect(statusAllows("exam.marks_entry.open", "exam", { status: "draft" })).toBe(true);
    expect(statusAllows("exam.marks_entry.open", "exam", pt3)).toBe(false);
    expect(statusAllows("exam.marks_entry.close", "exam", pt3)).toBe(true);
    expect(statusAllows("exam.result.publish", "exam", pt3)).toBe(false);
  });

  it("says why in plain words", () => {
    expect(statusBlock("exam.marks_entry.reopen", "exam", pt3)).toBe(
      "Periodic Test 3 (Grade X) is open for marks entry, so this cannot run on it now. It needs an exam that is in verification.",
    );
    expect(statusBlock("exam.marks_entry.close", "exam", pt3)).toBeNull();
  });

  it("other actions, other entities and records without a status are not filtered", () => {
    expect(statusAllows("exam.marks.enter", "exam", pt3)).toBe(true);
    expect(statusAllows("exam.marks_entry.reopen", "student", { status: "active" })).toBe(true);
    expect(statusAllows("exam.marks_entry.reopen", "exam", {})).toBe(true);
  });
});
