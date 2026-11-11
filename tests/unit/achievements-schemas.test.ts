import { describe, expect, it } from "vitest";
import { AchievementListSchema, AchievementRecordSchema, AchievementVoidSchema } from "@/modules/achievements/schemas";

const U = "11111111-1111-4111-8111-111111111111";
const ok = { studentId: U, title: "Inter-school chess winner", category: "sports", level: "district", eventDate: "2026-10-10" };

describe("achievement schemas", () => {
  it("accepts a minimal record and trims text", () => {
    const r = AchievementRecordSchema.parse({ ...ok, title: "  Chess  ", position: " 1st " });
    expect(r.title).toBe("Chess");
    expect(r.position).toBe("1st");
  });

  it("rejects unknown category, level, bad date and unknown keys", () => {
    expect(AchievementRecordSchema.safeParse({ ...ok, category: "music" }).success).toBe(false);
    expect(AchievementRecordSchema.safeParse({ ...ok, level: "planet" }).success).toBe(false);
    expect(AchievementRecordSchema.safeParse({ ...ok, eventDate: "10/10/2026" }).success).toBe(false);
    expect(AchievementRecordSchema.safeParse({ ...ok, verifiedBy: U }).success).toBe(false);
  });

  it("enforces column length limits", () => {
    expect(AchievementRecordSchema.safeParse({ ...ok, title: "x".repeat(201) }).success).toBe(false);
    expect(AchievementRecordSchema.safeParse({ ...ok, position: "x".repeat(61) }).success).toBe(false);
    expect(AchievementRecordSchema.safeParse({ ...ok, description: "x".repeat(1001) }).success).toBe(false);
  });

  it("void needs a non-blank reason up to 200 chars", () => {
    expect(AchievementVoidSchema.safeParse({ achievementId: U, reason: "  " }).success).toBe(false);
    expect(AchievementVoidSchema.safeParse({ achievementId: U, reason: "x".repeat(201) }).success).toBe(false);
    expect(AchievementVoidSchema.safeParse({ achievementId: U, reason: "Wrong student" }).success).toBe(true);
  });

  it("list filters are optional and validated", () => {
    expect(AchievementListSchema.safeParse({}).success).toBe(true);
    expect(AchievementListSchema.safeParse({ verified: "maybe" }).success).toBe(false);
  });
});
