import { describe, it, expect } from "vitest";
import {
  REPORT_SOURCE_KEYS,
  CRON_SUBSET_PATTERN,
  CronSchema,
  AttendanceDailyParamsSchema,
  FeeDefaultersParamsSchema,
  ReportExportSchema,
  ScheduleSaveSchema,
  ScheduleStatusSchema,
  ReportRunsSchema,
  ReportListSchema,
} from "../../src/modules/reports/schemas";

describe("Report schemas", () => {
  describe("REPORT_SOURCE_KEYS", () => {
    it("exports attendance.daily and finance.defaulters", () => {
      expect(REPORT_SOURCE_KEYS).toEqual(["attendance.daily", "finance.defaulters"]);
    });
  });

  describe("CRON_SUBSET_PATTERN", () => {
    it("matches valid cron patterns", () => {
      const validPatterns = [
        "0 20 * * *",
        "30 7 * * 1",
        "0 18 * * 1-6",
        "0 8 1,15 * *",
      ];
      validPatterns.forEach((pattern) => {
        expect(pattern).toMatch(new RegExp(CRON_SUBSET_PATTERN));
      });
    });

    it("rejects invalid cron patterns (regex level)", () => {
      const invalidPatterns = [
        "*/5 * * * *",       // steps not allowed
        "0 20 * * MON",      // names not allowed
        "60 20 * * *",       // minute 60 invalid
        "0 24 * * *",        // hour 24 invalid
      ];
      invalidPatterns.forEach((pattern) => {
        expect(pattern).not.toMatch(new RegExp(CRON_SUBSET_PATTERN));
      });
    });
  });

  describe("CronSchema", () => {
    it("parses valid cron strings", () => {
      expect(CronSchema.parse("0 20 * * *")).toBe("0 20 * * *");
      expect(CronSchema.parse("30 7 * * 1")).toBe("30 7 * * 1");
      expect(CronSchema.parse("0 18 * * 1-6")).toBe("0 18 * * 1-6");
      expect(CronSchema.parse("0 8 1,15 * *")).toBe("0 8 1,15 * *");
    });

    it("trims whitespace", () => {
      expect(CronSchema.parse("  0 20 * * *  ")).toBe("0 20 * * *");
    });

    it("rejects patterns with steps", () => {
      expect(() => CronSchema.parse("*/5 * * * *")).toThrow();
    });

    it("rejects patterns with names", () => {
      expect(() => CronSchema.parse("0 20 * * MON")).toThrow();
    });

    it("rejects invalid minutes", () => {
      expect(() => CronSchema.parse("60 20 * * *")).toThrow();
    });

    it("rejects invalid hours", () => {
      expect(() => CronSchema.parse("0 24 * * *")).toThrow();
    });

    it("rejects when both DOM and DOW are restricted", () => {
      expect(() => CronSchema.parse("0 8 1 * 1")).toThrow();
    });

    it("rejects strings longer than 100 chars", () => {
      const longString = "0 20 " + "1,".repeat(50) + "1 * *";
      expect(() => CronSchema.parse(longString)).toThrow();
    });
  });

  describe("AttendanceDailyParamsSchema", () => {
    it("parses valid params with dayOffset 0", () => {
      const result = AttendanceDailyParamsSchema.parse({ dayOffset: 0 });
      expect(result.dayOffset).toBe(0);
    });

    it("parses valid params with dayOffset -1", () => {
      const result = AttendanceDailyParamsSchema.parse({ dayOffset: -1 });
      expect(result.dayOffset).toBe(-1);
    });

    it("defaults dayOffset to 0 when omitted", () => {
      const result = AttendanceDailyParamsSchema.parse({});
      expect(result).toEqual({ dayOffset: 0 });
    });

    it("rejects dayOffset -2", () => {
      expect(() => AttendanceDailyParamsSchema.parse({ dayOffset: -2 })).toThrow();
    });

    it("rejects dayOffset 1", () => {
      expect(() => AttendanceDailyParamsSchema.parse({ dayOffset: 1 })).toThrow();
    });
  });

  describe("FeeDefaultersParamsSchema", () => {
    it("parses valid params", () => {
      const result = FeeDefaultersParamsSchema.parse({ minDaysOverdue: 0 });
      expect(result.minDaysOverdue).toBe(0);
    });

    it("parses minDaysOverdue 365", () => {
      const result = FeeDefaultersParamsSchema.parse({ minDaysOverdue: 365 });
      expect(result.minDaysOverdue).toBe(365);
    });

    it("defaults minDaysOverdue to 0 when omitted", () => {
      const result = FeeDefaultersParamsSchema.parse({});
      expect(result).toEqual({ minDaysOverdue: 0 });
    });

    it("rejects negative minDaysOverdue", () => {
      expect(() => FeeDefaultersParamsSchema.parse({ minDaysOverdue: -1 })).toThrow();
    });

    it("rejects minDaysOverdue > 365", () => {
      expect(() => FeeDefaultersParamsSchema.parse({ minDaysOverdue: 366 })).toThrow();
    });
  });

  describe("ReportExportSchema", () => {
    it("parses attendance.daily with valid params", () => {
      const result = ReportExportSchema.parse({
        source: "attendance.daily",
        params: { dayOffset: 0 },
      });
      expect(result.source).toBe("attendance.daily");
    });

    it("parses finance.defaulters with valid params", () => {
      const result = ReportExportSchema.parse({
        source: "finance.defaulters",
        params: { minDaysOverdue: 30 },
      });
      expect(result.source).toBe("finance.defaulters");
    });

    it("defaults params to empty object when not provided", () => {
      const result = ReportExportSchema.parse({
        source: "attendance.daily",
      });
      expect(result.params).toBeUndefined();
    });

    it("rejects minDaysOverdue on attendance.daily", () => {
      expect(() =>
        ReportExportSchema.parse({
          source: "attendance.daily",
          params: { minDaysOverdue: 30 },
        })
      ).toThrow();
    });

    it("rejects dayOffset on finance.defaulters", () => {
      expect(() =>
        ReportExportSchema.parse({
          source: "finance.defaulters",
          params: { dayOffset: -1 },
        })
      ).toThrow();
    });

    it("rejects unknown source", () => {
      expect(() =>
        ReportExportSchema.parse({
          source: "unknown.report",
        })
      ).toThrow();
    });
  });

  describe("ScheduleSaveSchema", () => {
    it("parses valid attendance.daily schedule", () => {
      const result = ScheduleSaveSchema.parse({
        name: "Nightly attendance",
        source: "attendance.daily",
        params: { dayOffset: 0 },
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(result.name).toBe("Nightly attendance");
      expect(result.source).toBe("attendance.daily");
    });

    it("allows optional id for update", () => {
      const result = ScheduleSaveSchema.parse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Test schedule",
        source: "attendance.daily",
        params: {},
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("trims name", () => {
      const result = ScheduleSaveSchema.parse({
        name: "  Nightly  ",
        source: "attendance.daily",
        params: {},
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(result.name).toBe("Nightly");
    });

    it("rejects name shorter than 1 char", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "",
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: ["principal"],
        })
      ).toThrow();
    });

    it("rejects name longer than 80 chars", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "a".repeat(81),
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: ["principal"],
        })
      ).toThrow();
    });

    it("rejects duplicate recipient roles", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "Test",
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: ["principal", "principal"],
        })
      ).toThrow();
    });

    it("rejects fewer than 1 recipient role", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "Test",
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: [],
        })
      ).toThrow();
    });

    it("rejects more than 5 recipient roles", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "Test",
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: ["owner", "principal", "admin", "accountant", "teacher", "guardian"],
        })
      ).toThrow();
    });

    it("rejects teacher as recipient for attendance.daily", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "Test",
          source: "attendance.daily",
          params: {},
          cron: "0 20 * * *",
          recipientRoles: ["teacher"],
        })
      ).toThrow();
    });

    it("accepts accountant as recipient for finance.defaulters", () => {
      const result = ScheduleSaveSchema.parse({
        name: "Test",
        source: "finance.defaulters",
        params: {},
        cron: "0 20 * * *",
        recipientRoles: ["accountant"],
      });
      expect(result.recipientRoles).toContain("accountant");
    });

    it("rejects invalid cron", () => {
      expect(() =>
        ScheduleSaveSchema.parse({
          name: "Test",
          source: "attendance.daily",
          params: {},
          cron: "*/5 * * * *",
          recipientRoles: ["principal"],
        })
      ).toThrow();
    });

    it("allows params to be undefined when not provided", () => {
      const result = ScheduleSaveSchema.parse({
        name: "Test",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipientRoles: ["principal"],
      });
      expect(result.params).toBeUndefined();
    });
  });

  describe("ScheduleStatusSchema", () => {
    it("parses active status", () => {
      const result = ScheduleStatusSchema.parse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        status: "active",
      });
      expect(result.status).toBe("active");
    });

    it("parses paused status", () => {
      const result = ScheduleStatusSchema.parse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        status: "paused",
      });
      expect(result.status).toBe("paused");
    });

    it("rejects invalid status", () => {
      expect(() =>
        ScheduleStatusSchema.parse({
          id: "123e4567-e89b-12d3-a456-426614174000",
          status: "stopped",
        })
      ).toThrow();
    });
  });

  describe("ReportRunsSchema", () => {
    it("parses with reportId only", () => {
      const result = ReportRunsSchema.parse({
        reportId: "123e4567-e89b-12d3-a456-426614174000",
      });
      expect(result.reportId).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(result.limit).toBe(30);
    });

    it("parses with custom limit", () => {
      const result = ReportRunsSchema.parse({
        reportId: "123e4567-e89b-12d3-a456-426614174000",
        limit: 50,
      });
      expect(result.limit).toBe(50);
    });

    it("defaults limit to 30", () => {
      const result = ReportRunsSchema.parse({
        reportId: "123e4567-e89b-12d3-a456-426614174000",
      });
      expect(result.limit).toBe(30);
    });

    it("rejects limit < 1", () => {
      expect(() =>
        ReportRunsSchema.parse({
          reportId: "123e4567-e89b-12d3-a456-426614174000",
          limit: 0,
        })
      ).toThrow();
    });

    it("rejects limit > 100", () => {
      expect(() =>
        ReportRunsSchema.parse({
          reportId: "123e4567-e89b-12d3-a456-426614174000",
          limit: 101,
        })
      ).toThrow();
    });
  });

  describe("ReportListSchema", () => {
    it("parses empty object", () => {
      const result = ReportListSchema.parse({});
      expect(result).toEqual({});
    });
  });
});
