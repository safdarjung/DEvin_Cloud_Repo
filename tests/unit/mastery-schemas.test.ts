import { describe, it, expect } from "vitest";
// Re-export types for consumers (suppress unused warnings in test file)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {
  HeatmapQueryInput,
  StudentGapsQueryInput,
  SuccessRowsQueryInput,
  InterventionsQueryInput,
  SetPaperUnitsInput,
  InterventionStepInput,
  UpdateInterventionInput,
} from "../../src/modules/mastery/schemas";
import {
  INTERVENTION_STATUSES,
  HeatmapQuerySchema,
  StudentGapsQuerySchema,
  SuccessRowsQuerySchema,
  InterventionsQuerySchema,
  SetPaperUnitsSchema,
  InterventionStepSchema,
  UpdateInterventionSchema,
} from "../../src/modules/mastery/schemas";

describe("mastery schemas", () => {
  // INTERVENTION_STATUSES constant
  describe("INTERVENTION_STATUSES", () => {
    it("exports the correct statuses", () => {
      expect(INTERVENTION_STATUSES).toEqual(["proposed", "active", "review", "closed"]);
    });
  });

  // HeatmapQuerySchema
  describe("HeatmapQuerySchema", () => {
    it("parses valid input with all fields", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        subjectId: "550e8400-e29b-41d4-a716-446655440001",
      };
      const result = HeatmapQuerySchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with no fields", () => {
      const result = HeatmapQuerySchema.parse({});
      expect(result).toEqual({});
    });

    it("parses valid input with only classSectionId", () => {
      const input = { classSectionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = HeatmapQuerySchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects unknown keys", () => {
      expect(() => {
        HeatmapQuerySchema.parse({
          classSectionId: "550e8400-e29b-41d4-a716-446655440000",
          unknownKey: "value",
        });
      }).toThrow();
    });

    it("rejects invalid UUID", () => {
      expect(() => {
        HeatmapQuerySchema.parse({ classSectionId: "not-a-uuid" });
      }).toThrow();
    });
  });

  // StudentGapsQuerySchema
  describe("StudentGapsQuerySchema", () => {
    it("parses valid input", () => {
      const input = { studentId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = StudentGapsQuerySchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects missing studentId", () => {
      expect(() => {
        StudentGapsQuerySchema.parse({});
      }).toThrow();
    });

    it("rejects invalid UUID", () => {
      expect(() => {
        StudentGapsQuerySchema.parse({ studentId: "invalid-uuid" });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        StudentGapsQuerySchema.parse({
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          extra: "key",
        });
      }).toThrow();
    });
  });

  // SuccessRowsQuerySchema
  describe("SuccessRowsQuerySchema", () => {
    it("parses valid input", () => {
      const input = { classSectionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = SuccessRowsQuerySchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects missing classSectionId", () => {
      expect(() => {
        SuccessRowsQuerySchema.parse({});
      }).toThrow();
    });

    it("rejects invalid UUID", () => {
      expect(() => {
        SuccessRowsQuerySchema.parse({ classSectionId: "not-a-uuid" });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        SuccessRowsQuerySchema.parse({
          classSectionId: "550e8400-e29b-41d4-a716-446655440000",
          extra: "field",
        });
      }).toThrow();
    });
  });

  // InterventionsQuerySchema
  describe("InterventionsQuerySchema", () => {
    it("parses valid input with all fields", () => {
      const input = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
        classSectionId: "550e8400-e29b-41d4-a716-446655440001",
        status: "active" as const,
      };
      const result = InterventionsQuerySchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with no fields", () => {
      const result = InterventionsQuerySchema.parse({});
      expect(result).toEqual({});
    });

    it("rejects invalid status", () => {
      expect(() => {
        InterventionsQuerySchema.parse({ status: "invalid_status" });
      }).toThrow();
    });

    it("rejects invalid UUID", () => {
      expect(() => {
        InterventionsQuerySchema.parse({ studentId: "not-a-uuid" });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        InterventionsQuerySchema.parse({
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          unknownKey: "value",
        });
      }).toThrow();
    });
  });

  // SetPaperUnitsSchema
  describe("SetPaperUnitsSchema", () => {
    it("parses valid input with multiple units", () => {
      const input = {
        paperId: "550e8400-e29b-41d4-a716-446655440000",
        unitIds: [
          "550e8400-e29b-41d4-a716-446655440001",
          "550e8400-e29b-41d4-a716-446655440002",
        ],
      };
      const result = SetPaperUnitsSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with empty unitIds", () => {
      const input = {
        paperId: "550e8400-e29b-41d4-a716-446655440000",
        unitIds: [],
      };
      const result = SetPaperUnitsSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects more than 20 unitIds", () => {
      const input = {
        paperId: "550e8400-e29b-41d4-a716-446655440000",
        unitIds: Array.from({ length: 21 }, (_, i) =>
          `550e8400-e29b-41d4-a716-44665544000${i}`.slice(0, 36)
        ),
      };
      expect(() => {
        SetPaperUnitsSchema.parse(input);
      }).toThrow();
    });

    it("rejects duplicate unitIds", () => {
      const input = {
        paperId: "550e8400-e29b-41d4-a716-446655440000",
        unitIds: [
          "550e8400-e29b-41d4-a716-446655440001",
          "550e8400-e29b-41d4-a716-446655440001",
        ],
      };
      expect(() => {
        SetPaperUnitsSchema.parse(input);
      }).toThrow();
    });

    it("rejects invalid paperId UUID", () => {
      expect(() => {
        SetPaperUnitsSchema.parse({
          paperId: "not-a-uuid",
          unitIds: ["550e8400-e29b-41d4-a716-446655440001"],
        });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        SetPaperUnitsSchema.parse({
          paperId: "550e8400-e29b-41d4-a716-446655440000",
          unitIds: [],
          extra: "field",
        });
      }).toThrow();
    });
  });

  // InterventionStepSchema
  describe("InterventionStepSchema", () => {
    it("parses valid input", () => {
      const input = {
        title: "Re-teach Mathematics Unit 1",
        due: "2026-01-15",
        done: false,
      };
      const result = InterventionStepSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("trims title whitespace", () => {
      const input = {
        title: "  Re-teach  ",
        due: "2026-01-15",
        done: true,
      };
      const result = InterventionStepSchema.parse(input);
      expect(result.title).toBe("Re-teach");
    });

    it("rejects title with 0 characters after trim", () => {
      expect(() => {
        InterventionStepSchema.parse({
          title: "   ",
          due: "2026-01-15",
          done: false,
        });
      }).toThrow();
    });

    it("rejects title with more than 120 characters", () => {
      const longTitle = "a".repeat(121);
      expect(() => {
        InterventionStepSchema.parse({
          title: longTitle,
          due: "2026-01-15",
          done: false,
        });
      }).toThrow();
    });

    it("accepts title with exactly 120 characters", () => {
      const title = "a".repeat(120);
      const result = InterventionStepSchema.parse({
        title,
        due: "2026-01-15",
        done: false,
      });
      expect(result.title).toBe(title);
    });

    it("rejects invalid date format", () => {
      expect(() => {
        InterventionStepSchema.parse({
          title: "Test",
          due: "2026-13-01",
          done: false,
        });
      }).toThrow();
    });

    it("rejects non-ISO date format like MM/DD/YYYY", () => {
      expect(() => {
        InterventionStepSchema.parse({
          title: "Test",
          due: "01/15/2026",
          done: false,
        });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        InterventionStepSchema.parse({
          title: "Test",
          due: "2026-01-15",
          done: false,
          extra: "field",
        });
      }).toThrow();
    });
  });

  // UpdateInterventionSchema
  describe("UpdateInterventionSchema", () => {
    it("parses valid input with goal update", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        goal: "Improve mastery",
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with steps update", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        steps: [
          { title: "Step 1", due: "2026-01-15", done: false },
          { title: "Step 2", due: "2026-01-22", done: false },
        ],
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with status update", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        status: "active" as const,
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("parses valid input with reviewDate update", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        reviewDate: "2026-02-01",
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects update with only id", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
        });
      }).toThrow();
    });

    it("parses valid input with multiple fields", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        goal: "Improve",
        status: "active" as const,
        reviewDate: "2026-02-01",
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects goal with more than 300 characters", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          goal: "a".repeat(301),
        });
      }).toThrow();
    });

    it("trims goal whitespace", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        goal: "  Improve mastery  ",
      };
      const result = UpdateInterventionSchema.parse(input);
      expect(result.goal).toBe("Improve mastery");
    });

    it("rejects more than 8 steps", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          steps: Array.from({ length: 9 }, (_, i) => ({
            title: `Step ${i + 1}`,
            due: "2026-01-15",
            done: false,
          })),
        });
      }).toThrow();
    });

    it("rejects invalid status", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          status: "invalid_status",
        });
      }).toThrow();
    });

    it("rejects invalid reviewDate format", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          reviewDate: "01/15/2026",
        });
      }).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "550e8400-e29b-41d4-a716-446655440000",
          goal: "Test",
          unknownKey: "value",
        });
      }).toThrow();
    });

    it("rejects invalid id UUID", () => {
      expect(() => {
        UpdateInterventionSchema.parse({
          id: "not-a-uuid",
          goal: "Test",
        });
      }).toThrow();
    });
  });
});
