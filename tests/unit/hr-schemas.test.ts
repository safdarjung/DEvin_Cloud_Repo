import { describe, it, expect } from "vitest";
import {
  StaffAttendanceMarkSchema,
  CheckInSchema,
  LeaveRequestSchema,
  LeaveDecisionSchema,
  LeaveCancelSchema,
  LeaveListSchema,
  StaffAttendanceForDateSchema,
} from "../../src/modules/people/hr.schemas.ts";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("HR Zod Schemas", () => {
  describe("StaffAttendanceMarkSchema", () => {
    it("parses valid attendance mark input", () => {
      const input = {
        date: "2026-11-02",
        records: [
          { staffId: validUuid, status: "present" },
          { staffId: validUuid, status: "absent", note: "Sick" },
          { staffId: validUuid, status: "late" },
          { staffId: validUuid, status: "half_day", note: "Leave in afternoon" },
        ],
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.records).toHaveLength(4);
        expect(result.data.records[0].note).toBeUndefined();
      }
    });

    it("rejects status 'on_leave'", () => {
      const input = {
        date: "2026-11-02",
        records: [{ staffId: validUuid, status: "on_leave" }],
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects note longer than 200 chars", () => {
      const input = {
        date: "2026-11-02",
        records: [
          {
            staffId: validUuid,
            status: "present",
            note: "a".repeat(201),
          },
        ],
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects 301 records", () => {
      const records = Array(301)
        .fill(null)
        .map(() => ({ staffId: validUuid, status: "present" as const }));

      const input = {
        date: "2026-11-02",
        records,
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts 300 records", () => {
      const records = Array(300)
        .fill(null)
        .map(() => ({ staffId: validUuid, status: "present" as const }));

      const input = {
        date: "2026-11-02",
        records,
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        date: "2026-11-02",
        records: [{ staffId: validUuid, status: "present" }],
        unknownKey: "value",
      };

      const result = StaffAttendanceMarkSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("CheckInSchema", () => {
    it("parses empty input", () => {
      const input = {};
      const result = CheckInSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { unknown: "value" };
      const result = CheckInSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("LeaveRequestSchema", () => {
    it("parses valid leave request", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-11-05",
        reason: "Personal reasons",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses leave request without staffId", () => {
      const input = {
        leaveType: "sick",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        reason: "Medical appointment",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects endDate before startDate", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-05",
        endDate: "2026-11-02",
        reason: "Personal reasons",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects leave longer than 31 days", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-12-04", // 33 days inclusive
        reason: "Personal reasons",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts leave of exactly 31 days", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-12-02", // exactly 31 days inclusive
        reason: "Personal reasons",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects reason longer than 500 chars", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-11-05",
        reason: "a".repeat(501),
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects reason shorter than 1 char", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-11-05",
        reason: "",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid leaveType", () => {
      const input = {
        staffId: validUuid,
        leaveType: "invalid",
        startDate: "2026-11-02",
        endDate: "2026-11-05",
        reason: "Personal reasons",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        staffId: validUuid,
        leaveType: "casual",
        startDate: "2026-11-02",
        endDate: "2026-11-05",
        reason: "Personal reasons",
        unknownKey: "value",
      };

      const result = LeaveRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("LeaveDecisionSchema", () => {
    it("parses valid leave decision", () => {
      const input = {
        leaveId: validUuid,
        note: "Approved",
      };

      const result = LeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses without note", () => {
      const input = { leaveId: validUuid };

      const result = LeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects note longer than 500 chars", () => {
      const input = {
        leaveId: validUuid,
        note: "a".repeat(501),
      };

      const result = LeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing leaveId", () => {
      const input = { note: "Approved" };

      const result = LeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        leaveId: validUuid,
        note: "Approved",
        unknownKey: "value",
      };

      const result = LeaveDecisionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("LeaveCancelSchema", () => {
    it("parses valid leave cancel", () => {
      const input = { leaveId: validUuid };

      const result = LeaveCancelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects missing leaveId", () => {
      const input = {};

      const result = LeaveCancelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        leaveId: validUuid,
        unknownKey: "value",
      };

      const result = LeaveCancelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("LeaveListSchema", () => {
    it("parses valid leave list query", () => {
      const input = {
        status: "approved",
        staffId: validUuid,
        from: "2026-11-01",
        to: "2026-12-01",
        limit: 50,
      };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses with only status", () => {
      const input = { status: "pending" };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses empty input", () => {
      const input = {};

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects limit > 200", () => {
      const input = { limit: 201 };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects limit < 1", () => {
      const input = { limit: 0 };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts limit 200", () => {
      const input = { limit: 200 };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const input = { status: "invalid" };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        status: "pending",
        unknownKey: "value",
      };

      const result = LeaveListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("StaffAttendanceForDateSchema", () => {
    it("parses with date", () => {
      const input = { date: "2026-11-02" };

      const result = StaffAttendanceForDateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses empty input", () => {
      const input = {};

      const result = StaffAttendanceForDateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const input = { date: "02-11-2026" };

      const result = StaffAttendanceForDateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const input = {
        date: "2026-11-02",
        unknownKey: "value",
      };

      const result = StaffAttendanceForDateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
