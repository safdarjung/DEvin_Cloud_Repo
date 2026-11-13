import { describe, expect, it } from "vitest";
import { TestCreateSchema, TestUpdateSchema } from "@/modules/online-tests/schemas";

const base = {
  questionPaperId: "00000000-0000-4000-8000-000000000001",
  title: "Unit test",
  sectionIds: ["00000000-0000-4000-8000-000000000002"],
  opensAt: "2026-11-13T09:00:00+05:30",
  closesAt: "2026-11-13T10:00:00+05:30",
  durationMinutes: 30,
};

describe("online test release policy", () => {
  it("rejects results at close for an exam test; allows it for practice", () => {
    expect(TestCreateSchema.safeParse({ ...base, showResults: "after_close" }).success).toBe(false);
    expect(TestCreateSchema.safeParse({ ...base, practice: true, showResults: "after_close" }).success).toBe(true);
    expect(TestCreateSchema.safeParse({ ...base, showResults: "never" }).success).toBe(true);
  });

  it("rejects an update that sets results at close on an exam test", () => {
    const id = base.questionPaperId;
    expect(TestUpdateSchema.safeParse({ id, practice: false, showResults: "after_close" }).success).toBe(false);
    expect(TestUpdateSchema.safeParse({ id, practice: true, showResults: "after_close" }).success).toBe(true);
  });
});
