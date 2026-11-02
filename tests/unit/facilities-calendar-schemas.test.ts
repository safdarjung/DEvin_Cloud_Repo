// M13-T3 — Zod schemas for facilities.* and calendar.* actions.
import { describe, it, expect } from "vitest";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  AssetUpsertSchema,
  MaintenanceRequestSchema,
  MaintenanceAssignSchema,
  MaintenanceCloseSchema,
  AssetListSchema,
  MaintenanceListSchema,
} from "../../src/modules/facilities/schemas";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_AUDIENCES,
  CalendarEventUpsertSchema,
  CalendarEventDeleteSchema,
  CalendarForRoleSchema,
} from "../../src/modules/calendar/schemas";

describe("Facilities Schemas", () => {
  describe("AssetUpsertSchema", () => {
    it("parses valid asset with all fields", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Projector",
        category: "electrical" as const,
        assetTag: "PROJ-001",
        roomId: "550e8400-e29b-41d4-a716-446655440001",
        location: "Room 101",
        status: "in_use" as const,
      };
      const result = AssetUpsertSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid asset with minimal fields", () => {
      const input = {
        name: "Lab Kit",
        category: "lab" as const,
      };
      const result = AssetUpsertSchema.parse(input);
      expect(result.name).toBe("Lab Kit");
      expect(result.category).toBe("lab");
    });

    it("trims and validates name (1-80 chars)", () => {
      const input = {
        name: "  Valid Name  ",
        category: "furniture" as const,
      };
      const result = AssetUpsertSchema.parse(input);
      expect(result.name).toBe("Valid Name");
    });

    it("rejects name too long (>80 chars)", () => {
      const input = {
        name: "x".repeat(81),
        category: "furniture" as const,
      };
      expect(() => AssetUpsertSchema.parse(input)).toThrow();
    });

    it("validates assetTag (1-40 chars)", () => {
      const input = {
        name: "Asset",
        category: "it" as const,
        assetTag: "TAG-001",
      };
      const result = AssetUpsertSchema.parse(input);
      expect(result.assetTag).toBe("TAG-001");
    });

    it("rejects assetTag too long (>40 chars)", () => {
      const input = {
        name: "Asset",
        category: "it" as const,
        assetTag: "x".repeat(41),
      };
      expect(() => AssetUpsertSchema.parse(input)).toThrow();
    });

    it("validates location (1-80 chars)", () => {
      const input = {
        name: "Asset",
        category: "sports" as const,
        location: "Gym Storage",
      };
      const result = AssetUpsertSchema.parse(input);
      expect(result.location).toBe("Gym Storage");
    });

    it("rejects unknown status value", () => {
      const input = {
        name: "Asset",
        category: "other" as const,
        status: "unknown" as unknown,
      };
      expect(() => AssetUpsertSchema.parse(input)).toThrow();
    });

    it("rejects unknown category value", () => {
      const input = {
        name: "Asset",
        category: "unknown" as unknown,
      };
      expect(() => AssetUpsertSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        name: "Asset",
        category: "electrical" as const,
        unknownField: "should fail",
      };
      expect(() => AssetUpsertSchema.parse(input)).toThrow();
    });
  });

  describe("MaintenanceRequestSchema", () => {
    it("parses valid request with asset", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "Projector not turning on",
        priority: "high" as const,
      };
      const result = MaintenanceRequestSchema.parse(input);
      expect(result.assetId).toBe(input.assetId);
      expect(result.issue).toBe(input.issue);
      expect(result.priority).toBe("high");
    });

    it("parses valid request with location (no asset)", () => {
      const input = {
        location: "Room 101",
        issue: "Broken window",
        priority: "medium" as const,
      };
      const result = MaintenanceRequestSchema.parse(input);
      expect(result.location).toBe("Room 101");
    });

    it("sets default priority to 'medium'", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "Minor issue",
      };
      const result = MaintenanceRequestSchema.parse(input);
      expect(result.priority).toBe("medium");
    });

    it("validates issue length (1-500 chars)", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "Valid issue description",
      };
      const result = MaintenanceRequestSchema.parse(input);
      expect(result.issue).toBe("Valid issue description");
    });

    it("rejects issue longer than 500 chars", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "x".repeat(501),
      };
      expect(() => MaintenanceRequestSchema.parse(input)).toThrow();
    });

    it("rejects request with neither assetId nor location", () => {
      const input = {
        issue: "Issue without asset or location",
      };
      expect(() => MaintenanceRequestSchema.parse(input)).toThrow();
    });

    it("rejects unknown priority value", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "Issue",
        priority: "critical" as unknown,
      };
      expect(() => MaintenanceRequestSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        assetId: "550e8400-e29b-41d4-a716-446655440000",
        issue: "Issue",
        unknownField: "should fail",
      };
      expect(() => MaintenanceRequestSchema.parse(input)).toThrow();
    });
  });

  describe("MaintenanceAssignSchema", () => {
    it("parses valid assignment", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        assigneeStaffId: "550e8400-e29b-41d4-a716-446655440001",
      };
      const result = MaintenanceAssignSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects invalid UUID", () => {
      const input = {
        requestId: "not-a-uuid",
        assigneeStaffId: "550e8400-e29b-41d4-a716-446655440001",
      };
      expect(() => MaintenanceAssignSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        assigneeStaffId: "550e8400-e29b-41d4-a716-446655440001",
        unknownField: "should fail",
      };
      expect(() => MaintenanceAssignSchema.parse(input)).toThrow();
    });
  });

  describe("MaintenanceCloseSchema", () => {
    it("parses valid close with note", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        resolutionNote: "Issue fixed",
      };
      const result = MaintenanceCloseSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid close without note", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = MaintenanceCloseSchema.parse(input);
      expect(result.requestId).toBe(input.requestId);
      expect(result.resolutionNote).toBeUndefined();
    });

    it("validates resolution note max 500 chars", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        resolutionNote: "x".repeat(500),
      };
      const result = MaintenanceCloseSchema.parse(input);
      expect(result.resolutionNote).toHaveLength(500);
    });

    it("rejects resolution note longer than 500 chars", () => {
      const input = {
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        resolutionNote: "x".repeat(501),
      };
      expect(() => MaintenanceCloseSchema.parse(input)).toThrow();
    });
  });

  describe("AssetListSchema", () => {
    it("parses with roomId filter", () => {
      const input = {
        roomId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = AssetListSchema.parse(input);
      expect(result.roomId).toBe(input.roomId);
    });

    it("parses with status filter", () => {
      const input = {
        status: "in_use" as const,
      };
      const result = AssetListSchema.parse(input);
      expect(result.status).toBe("in_use");
    });

    it("parses with both filters", () => {
      const input = {
        roomId: "550e8400-e29b-41d4-a716-446655440000",
        status: "under_repair" as const,
      };
      const result = AssetListSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses empty object", () => {
      const result = AssetListSchema.parse({});
      expect(result).toEqual({});
    });
  });

  describe("MaintenanceListSchema", () => {
    it("parses with status filter", () => {
      const input = {
        status: "open" as const,
      };
      const result = MaintenanceListSchema.parse(input);
      expect(result.status).toBe("open");
    });

    it("parses with limit", () => {
      const input = {
        limit: 50,
      };
      const result = MaintenanceListSchema.parse(input);
      expect(result.limit).toBe(50);
    });

    it("validates limit between 1 and 200", () => {
      expect(() =>
        MaintenanceListSchema.parse({ limit: 0 })
      ).toThrow();
      expect(() =>
        MaintenanceListSchema.parse({ limit: 201 })
      ).toThrow();
    });

    it("parses valid limit at boundaries", () => {
      const result1 = MaintenanceListSchema.parse({ limit: 1 });
      expect(result1.limit).toBe(1);
      const result200 = MaintenanceListSchema.parse({ limit: 200 });
      expect(result200.limit).toBe(200);
    });
  });

  describe("Constants", () => {
    it("exports asset categories", () => {
      expect(ASSET_CATEGORIES).toBeDefined();
      expect(ASSET_CATEGORIES).toContain("furniture");
      expect(ASSET_CATEGORIES).toContain("electrical");
      expect(ASSET_CATEGORIES).toContain("it");
      expect(ASSET_CATEGORIES).toContain("lab");
      expect(ASSET_CATEGORIES).toContain("sports");
      expect(ASSET_CATEGORIES).toContain("plumbing");
      expect(ASSET_CATEGORIES).toContain("vehicle");
      expect(ASSET_CATEGORIES).toContain("other");
    });

    it("exports asset statuses", () => {
      expect(ASSET_STATUSES).toBeDefined();
      expect(ASSET_STATUSES).toContain("in_use");
      expect(ASSET_STATUSES).toContain("under_repair");
      expect(ASSET_STATUSES).toContain("retired");
    });

    it("exports maintenance priorities", () => {
      expect(MAINTENANCE_PRIORITIES).toBeDefined();
      expect(MAINTENANCE_PRIORITIES).toContain("low");
      expect(MAINTENANCE_PRIORITIES).toContain("medium");
      expect(MAINTENANCE_PRIORITIES).toContain("high");
    });

    it("exports maintenance statuses", () => {
      expect(MAINTENANCE_STATUSES).toBeDefined();
      expect(MAINTENANCE_STATUSES).toContain("open");
      expect(MAINTENANCE_STATUSES).toContain("in_progress");
      expect(MAINTENANCE_STATUSES).toContain("done");
    });
  });
});

describe("Calendar Schemas", () => {
  describe("CalendarEventUpsertSchema", () => {
    it("parses valid event with all fields", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Annual Day",
        description: "School annual day celebration",
        startsOn: "2026-11-15",
        endsOn: "2026-11-16",
        audience: "all" as const,
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid holiday with default audience 'all'", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "holiday" as const,
        title: "Winter Break",
        startsOn: "2026-12-20",
        endsOn: "2026-12-31",
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result.kind).toBe("holiday");
      expect(result.audience).toBe("all");
    });

    it("parses exam_week event", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "exam_week" as const,
        title: "Final Exams",
        startsOn: "2027-03-01",
        endsOn: "2027-03-15",
        audience: "staff" as const,
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result.kind).toBe("exam_week");
    });

    it("validates title length (1-120 chars)", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "x".repeat(120),
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result.title).toHaveLength(120);
    });

    it("rejects title longer than 120 chars", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "x".repeat(121),
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("validates description max 1000 chars", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        description: "x".repeat(1000),
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result.description).toHaveLength(1000);
    });

    it("rejects description longer than 1000 chars", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        description: "x".repeat(1001),
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("rejects endsOn before startsOn", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-20",
        endsOn: "2026-11-15",
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("allows endsOn equal to startsOn", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result.startsOn).toBe(result.endsOn);
    });

    it("validates span max 92 days", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-01",
        endsOn: "2027-01-31", // 92 days
      };
      const result = CalendarEventUpsertSchema.parse(input);
      expect(result).toBeDefined();
    });

    it("rejects span longer than 92 days", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-01",
        endsOn: "2027-02-02", // 94 days
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("rejects holiday with audience staff", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "holiday" as const,
        title: "Holiday",
        startsOn: "2026-12-20",
        endsOn: "2026-12-31",
        audience: "staff" as const,
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("rejects unknown kind value", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "unknown" as unknown,
        title: "Event",
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("rejects unknown audience value", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
        audience: "unknown" as unknown,
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440001",
        kind: "event" as const,
        title: "Event",
        startsOn: "2026-11-15",
        endsOn: "2026-11-15",
        unknownField: "should fail",
      };
      expect(() => CalendarEventUpsertSchema.parse(input)).toThrow();
    });
  });

  describe("CalendarEventDeleteSchema", () => {
    it("parses valid delete request", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = CalendarEventDeleteSchema.parse(input);
      expect(result.id).toBe(input.id);
    });

    it("rejects invalid UUID", () => {
      const input = {
        id: "not-a-uuid",
      };
      expect(() => CalendarEventDeleteSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        unknownField: "should fail",
      };
      expect(() => CalendarEventDeleteSchema.parse(input)).toThrow();
    });
  });

  describe("CalendarForRoleSchema", () => {
    it("parses query with date range and kinds", () => {
      const input = {
        from: "2026-11-01",
        to: "2027-01-31",
        kinds: ["holiday", "event"],
      };
      const result = CalendarForRoleSchema.parse(input);
      expect(result.from).toBe("2026-11-01");
      expect(result.to).toBe("2027-01-31");
      expect(result.kinds).toEqual(["holiday", "event"]);
    });

    it("parses empty query", () => {
      const result = CalendarForRoleSchema.parse({});
      expect(result).toEqual({});
    });

    it("validates kinds max 4 items", () => {
      const input = {
        kinds: ["holiday", "event", "exam_week", "ptm"],
      };
      const result = CalendarForRoleSchema.parse(input);
      expect(result.kinds).toHaveLength(4);
    });

    it("rejects kinds with more than 4 items", () => {
      const input = {
        kinds: ["holiday", "event", "exam_week", "ptm", "extra"],
      };
      expect(() => CalendarForRoleSchema.parse(input)).toThrow();
    });

    it("rejects from after to", () => {
      const input = {
        from: "2027-01-31",
        to: "2026-11-01",
      };
      expect(() => CalendarForRoleSchema.parse(input)).toThrow();
    });

    it("allows from equal to to", () => {
      const input = {
        from: "2026-11-01",
        to: "2026-11-01",
      };
      const result = CalendarForRoleSchema.parse(input);
      expect(result.from).toBe(result.to);
    });

    it("validates span max 366 days", () => {
      const input = {
        from: "2026-11-01",
        to: "2027-11-01", // exactly 365 days + 1
      };
      const result = CalendarForRoleSchema.parse(input);
      expect(result).toBeDefined();
    });

    it("rejects span longer than 366 days", () => {
      const input = {
        from: "2026-11-01",
        to: "2027-11-03", // 367 days
      };
      expect(() => CalendarForRoleSchema.parse(input)).toThrow();
    });

    it("rejects unknown kind in kinds", () => {
      const input = {
        kinds: ["holiday", "unknown" as unknown],
      };
      expect(() => CalendarForRoleSchema.parse(input)).toThrow();
    });

    it("rejects unknown keys (strict mode)", () => {
      const input = {
        from: "2026-11-01",
        unknownField: "should fail",
      };
      expect(() => CalendarForRoleSchema.parse(input)).toThrow();
    });
  });

  describe("Constants", () => {
    it("exports calendar event kinds", () => {
      expect(CALENDAR_EVENT_KINDS).toBeDefined();
      expect(CALENDAR_EVENT_KINDS).toContain("holiday");
      expect(CALENDAR_EVENT_KINDS).toContain("exam_week");
      expect(CALENDAR_EVENT_KINDS).toContain("ptm");
      expect(CALENDAR_EVENT_KINDS).toContain("event");
    });

    it("exports calendar audiences", () => {
      expect(CALENDAR_AUDIENCES).toBeDefined();
      expect(CALENDAR_AUDIENCES).toContain("all");
      expect(CALENDAR_AUDIENCES).toContain("staff");
    });
  });
});
