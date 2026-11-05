import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/actions/result";
import { throwMappedSchedule } from "@/modules/exams/schedule-conflicts";

// M11 security review fix round 1 — schedulePapers's exam_papers
// select/update calls must map raw PostgREST codes (42501, 23514, 23503,
// 22P02) to forbidden/validation_failed instead of falling through to a
// generic "internal" error (M11-tasks.md "ErrorCode mapping" ruling).
describe("exams/actions throwMappedSchedule", () => {
  it("maps 42501 (RLS violation) to forbidden", () => {
    expect(() => throwMappedSchedule({ code: "42501", message: "permission denied" })).toThrowError(
      expect.objectContaining({ code: "forbidden" } satisfies Partial<AppError>),
    );
  });

  it.each(["23514", "23503", "22P02"])("maps %s to validation_failed", (code) => {
    expect(() => throwMappedSchedule({ code, message: "constraint violated" })).toThrowError(
      expect.objectContaining({ code: "validation_failed" } satisfies Partial<AppError>),
    );
  });

  it("falls through unmapped codes to internal (mapSqlError default)", () => {
    expect(() => throwMappedSchedule({ code: "99999", message: "something else" })).toThrowError(
      expect.objectContaining({ code: "internal" } satisfies Partial<AppError>),
    );
  });
});
