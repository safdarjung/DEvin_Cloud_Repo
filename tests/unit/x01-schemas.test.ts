// X01-T3: Zod schemas for student leave and diary. TDD: schema validations.
import { describe, it, expect } from "vitest";
import {
  STUDENT_LEAVE_STATUSES,
  StudentLeaveRequestSchema,
  StudentLeaveDecisionSchema,
  StudentLeaveCancelSchema,
  StudentLeaveListSchema,
} from "@/modules/student-leave/schemas";
import {
  DiaryPostSchema,
  DiaryDeleteSchema,
  DiaryAcknowledgeSchema,
  DiaryForSectionSchema,
  DiaryForStudentSchema,
  DiaryAckStatusSchema,
} from "@/modules/diary/schemas";

const testUuid = "550e8400-e29b-41d4-a716-446655440000";
const testUuidAlt = "660e8400-e29b-41d4-a716-446655440000";
const today = "2026-11-04";
const tomorrow = "2026-11-05";
const yesterday = "2026-11-03";

describe("Student leave schemas", () => {
  describe("STUDENT_LEAVE_STATUSES", () => {
    it("exports the status enum", () => {
      expect(STUDENT_LEAVE_STATUSES).toContain("pending");
      expect(STUDENT_LEAVE_STATUSES).toContain("approved");
      expect(STUDENT_LEAVE_STATUSES).toContain("rejected");
      expect(STUDENT_LEAVE_STATUSES).toContain("cancelled");
      expect(STUDENT_LEAVE_STATUSES).toHaveLength(4);
    });
  });

  describe("StudentLeaveRequestSchema", () => {
    it("accepts valid request", () => {
      const input = {
        studentId: testUuid,
        startDate: today,
        endDate: tomorrow,
        reason: "Family function",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("trims and validates reason 1-500 chars", () => {
      const valid = {
        studentId: testUuid,
        startDate: today,
        endDate: today,
        reason: "  valid reason  ",
      };
      const result = StudentLeaveRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
      expect(result.data?.reason).toBe("valid reason");
    });

    it("rejects empty reason", () => {
      const input = {
        studentId: testUuid,
        startDate: today,
        endDate: today,
        reason: "   ",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects 501-char reason", () => {
      const input = {
        studentId: testUuid,
        startDate: today,
        endDate: today,
        reason: "a".repeat(501),
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts 500-char reason", () => {
      const input = {
        studentId: testUuid,
        startDate: today,
        endDate: today,
        reason: "a".repeat(500),
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects endDate before startDate", () => {
      const input = {
        studentId: testUuid,
        startDate: tomorrow,
        endDate: today,
        reason: "Reason",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts 31-day leave (inclusive)", () => {
      const start = "2026-11-04";
      const end = "2026-12-04"; // 31 days inclusive
      const input = {
        studentId: testUuid,
        startDate: start,
        endDate: end,
        reason: "Long leave",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects 32-day leave", () => {
      const start = "2026-11-04";
      const end = "2026-12-05"; // 32 days inclusive
      const input = {
        studentId: testUuid,
        startDate: start,
        endDate: end,
        reason: "Too long",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        studentId: testUuid,
        startDate: today,
        endDate: tomorrow,
        reason: "Reason",
        extraKey: "should not be here",
      };
      const result = StudentLeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("StudentLeaveDecisionSchema", () => {
    it("accepts valid decision", () => {
      const input = { leaveId: testUuid };
      const result = StudentLeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts decision with note", () => {
      const input = { leaveId: testUuid, note: "Approved as discussed" };
      const result = StudentLeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects 501-char note", () => {
      const input = {
        leaveId: testUuid,
        note: "a".repeat(501),
      };
      const result = StudentLeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts 500-char note", () => {
      const input = {
        leaveId: testUuid,
        note: "a".repeat(500),
      };
      const result = StudentLeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        leaveId: testUuid,
        note: "Note",
        extraKey: "bad",
      };
      const result = StudentLeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("StudentLeaveCancelSchema", () => {
    it("accepts valid cancel", () => {
      const input = { leaveId: testUuid };
      const result = StudentLeaveCancelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { leaveId: testUuid, extraKey: "bad" };
      const result = StudentLeaveCancelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("StudentLeaveListSchema", () => {
    it("accepts empty filters", () => {
      const input = {};
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts valid filters", () => {
      const input = {
        status: "pending",
        studentId: testUuid,
        classSectionId: testUuidAlt,
        from: yesterday,
        to: tomorrow,
        limit: 50,
      };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects limit > 200", () => {
      const input = { limit: 201 };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts limit 200", () => {
      const input = { limit: 200 };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects limit < 1", () => {
      const input = { limit: 0 };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown status", () => {
      const input = { status: "unknown" };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = { extraKey: "bad" };
      const result = StudentLeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

describe("Diary schemas", () => {
  describe("DiaryPostSchema", () => {
    it("accepts valid entry", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "Homework: chapter 5",
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts entry with optional fields", () => {
      const input = {
        classSectionId: testUuid,
        subjectId: testUuidAlt,
        entryDate: today,
        body: "Homework",
        dueDate: tomorrow,
        requiresAck: true,
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("defaults requiresAck to false", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "Homework",
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.requiresAck).toBe(false);
    });

    it("trims body", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "  Homework  ",
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data?.body).toBe("Homework");
    });

    it("rejects empty body", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "   ",
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects 2001-char body", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "a".repeat(2001),
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts 2000-char body", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "a".repeat(2000),
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects dueDate before entryDate", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: tomorrow,
        body: "Homework",
        dueDate: today,
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts dueDate equal to entryDate", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "Homework",
        dueDate: today,
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        classSectionId: testUuid,
        entryDate: today,
        body: "Homework",
        extraKey: "bad",
      };
      const result = DiaryPostSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DiaryDeleteSchema", () => {
    it("accepts valid delete", () => {
      const input = { entryId: testUuid };
      const result = DiaryDeleteSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { entryId: testUuid, extraKey: "bad" };
      const result = DiaryDeleteSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DiaryAcknowledgeSchema", () => {
    it("accepts valid acknowledge", () => {
      const input = {
        entryId: testUuid,
        studentId: testUuidAlt,
      };
      const result = DiaryAcknowledgeSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        entryId: testUuid,
        studentId: testUuidAlt,
        extraKey: "bad",
      };
      const result = DiaryAcknowledgeSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DiaryForSectionSchema", () => {
    it("accepts valid filters", () => {
      const input = {
        classSectionId: testUuid,
        from: yesterday,
        to: tomorrow,
      };
      const result = DiaryForSectionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts with optional dates", () => {
      const input = {
        classSectionId: testUuid,
      };
      const result = DiaryForSectionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        classSectionId: testUuid,
        extraKey: "bad",
      };
      const result = DiaryForSectionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DiaryForStudentSchema", () => {
    it("accepts valid filters", () => {
      const input = {
        studentId: testUuid,
        from: yesterday,
        to: tomorrow,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts with optional dates", () => {
      const input = {
        studentId: testUuid,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects from > to", () => {
      const input = {
        studentId: testUuid,
        from: tomorrow,
        to: today,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts from == to", () => {
      const input = {
        studentId: testUuid,
        from: today,
        to: today,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts 62-day window (inclusive)", () => {
      const from = "2026-11-04";
      const to = "2027-01-04"; // 62 days inclusive
      const input = {
        studentId: testUuid,
        from,
        to,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects 63-day window", () => {
      const from = "2026-11-04";
      const to = "2027-01-05"; // 63 days inclusive
      const input = {
        studentId: testUuid,
        from,
        to,
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        studentId: testUuid,
        extraKey: "bad",
      };
      const result = DiaryForStudentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("DiaryAckStatusSchema", () => {
    it("accepts valid query", () => {
      const input = { entryId: testUuid };
      const result = DiaryAckStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { entryId: testUuid, extraKey: "bad" };
      const result = DiaryAckStatusSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
