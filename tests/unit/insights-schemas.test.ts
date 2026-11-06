import { describe, it, expect } from "vitest";
import {
  InsightIdSchema,
  ReviewInsightSchema,
  CloseInsightSchema,
  RecordInsightActionSchema,
  ListInsightsSchema,
  InsightCardsSchema,
  InsightExplanationSchema,
} from "../../src/modules/insights/schemas";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("insights schemas", () => {
  describe("InsightIdSchema", () => {
    it("parses valid insightId", () => {
      const result = InsightIdSchema.parse({ insightId: validUuid });
      expect(result.insightId).toBe(validUuid);
    });

    it("rejects invalid UUID", () => {
      expect(() =>
        InsightIdSchema.parse({ insightId: "not-a-uuid" })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        InsightIdSchema.parse({ insightId: validUuid, extra: "key" })
      ).toThrow();
    });
  });

  describe("ReviewInsightSchema", () => {
    it("parses valid input with reviewerId", () => {
      const result = ReviewInsightSchema.parse({
        insightId: validUuid,
        reviewerId: validUuid,
      });
      expect(result.insightId).toBe(validUuid);
      expect(result.reviewerId).toBe(validUuid);
    });

    it("parses with reviewerId omitted", () => {
      const result = ReviewInsightSchema.parse({ insightId: validUuid });
      expect(result.insightId).toBe(validUuid);
      expect(result.reviewerId).toBeUndefined();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        ReviewInsightSchema.parse({ insightId: validUuid, unknown: "value" })
      ).toThrow();
    });
  });

  describe("CloseInsightSchema", () => {
    it("parses valid input with note", () => {
      const result = CloseInsightSchema.parse({
        insightId: validUuid,
        note: "This is a valid note",
      });
      expect(result.insightId).toBe(validUuid);
      expect(result.note).toBe("This is a valid note");
    });

    it("trims and validates note length (min 5)", () => {
      const result = CloseInsightSchema.parse({
        insightId: validUuid,
        note: "  Valid note with spaces  ",
      });
      expect(result.note).toBe("Valid note with spaces");
    });

    it("rejects note shorter than 5 chars", () => {
      expect(() =>
        CloseInsightSchema.parse({
          insightId: validUuid,
          note: "abcd",
        })
      ).toThrow();
    });

    it("rejects note longer than 500 chars", () => {
      const longNote = "a".repeat(501);
      expect(() =>
        CloseInsightSchema.parse({
          insightId: validUuid,
          note: longNote,
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        CloseInsightSchema.parse({
          insightId: validUuid,
          note: "Valid note",
          extra: "key",
        })
      ).toThrow();
    });
  });

  describe("RecordInsightActionSchema", () => {
    const validAction = {
      insightId: validUuid,
      action: "Take the action",
      owner: "John Doe",
      rationale: "This is the reason",
      expectedOutcome: "This is what we expect",
    };

    it("parses valid action with defaults", () => {
      const result = RecordInsightActionSchema.parse(validAction);
      expect(result.insightId).toBe(validUuid);
      expect(result.action).toBe("Take the action");
      expect(result.owner).toBe("John Doe");
      expect(result.status).toBe("planned");
      expect(result.actualOutcome).toBeUndefined();
      expect(result.supersedesId).toBeUndefined();
    });

    it("parses with all optional fields", () => {
      const result = RecordInsightActionSchema.parse({
        ...validAction,
        supersedesId: validUuid,
        status: "measured",
        actualOutcome: "The actual result",
      });
      expect(result.supersedesId).toBe(validUuid);
      expect(result.status).toBe("measured");
      expect(result.actualOutcome).toBe("The actual result");
    });

    it("rejects measured without actualOutcome", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          status: "measured",
        })
      ).toThrow();
    });

    it("rejects action longer than 200 chars", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          action: "a".repeat(201),
        })
      ).toThrow();
    });

    it("rejects owner longer than 80 chars", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          owner: "a".repeat(81),
        })
      ).toThrow();
    });

    it("rejects rationale longer than 500 chars", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          rationale: "a".repeat(501),
        })
      ).toThrow();
    });

    it("rejects expectedOutcome longer than 300 chars", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          expectedOutcome: "a".repeat(301),
        })
      ).toThrow();
    });

    it("rejects actualOutcome longer than 500 chars", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          status: "measured",
          actualOutcome: "a".repeat(501),
        })
      ).toThrow();
    });

    it("rejects invalid status", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          status: "invalid",
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        RecordInsightActionSchema.parse({
          ...validAction,
          unknown: "key",
        })
      ).toThrow();
    });
  });

  describe("ListInsightsSchema", () => {
    it("parses with all defaults", () => {
      const result = ListInsightsSchema.parse({});
      expect(result.status).toEqual(["new", "reviewing", "actioned"]);
      expect(result.domain).toBeUndefined();
      expect(result.limit).toBe(50);
    });

    it("parses with custom status array (up to 5)", () => {
      const result = ListInsightsSchema.parse({
        status: ["new", "resolved"],
      });
      expect(result.status).toEqual(["new", "resolved"]);
    });

    it("rejects more than 5 status values", () => {
      expect(() =>
        ListInsightsSchema.parse({
          status: ["new", "reviewing", "actioned", "resolved", "dismissed", "extra"],
        })
      ).toThrow();
    });

    it("parses with custom domain", () => {
      const result = ListInsightsSchema.parse({
        domain: "finance",
      });
      expect(result.domain).toBe("finance");
    });

    it("rejects invalid domain", () => {
      expect(() =>
        ListInsightsSchema.parse({
          domain: "invalid_domain",
        })
      ).toThrow();
    });

    it("parses with custom limit", () => {
      const result = ListInsightsSchema.parse({
        limit: 100,
      });
      expect(result.limit).toBe(100);
    });

    it("rejects limit less than 1", () => {
      expect(() =>
        ListInsightsSchema.parse({
          limit: 0,
        })
      ).toThrow();
    });

    it("rejects limit greater than 200", () => {
      expect(() =>
        ListInsightsSchema.parse({
          limit: 201,
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        ListInsightsSchema.parse({
          unknown: "key",
        })
      ).toThrow();
    });
  });

  describe("InsightCardsSchema", () => {
    it("parses with default limit", () => {
      const result = InsightCardsSchema.parse({});
      expect(result.limit).toBe(3);
    });

    it("parses with custom limit", () => {
      const result = InsightCardsSchema.parse({
        limit: 5,
      });
      expect(result.limit).toBe(5);
    });

    it("rejects limit less than 1", () => {
      expect(() =>
        InsightCardsSchema.parse({
          limit: 0,
        })
      ).toThrow();
    });

    it("rejects limit greater than 6", () => {
      expect(() =>
        InsightCardsSchema.parse({
          limit: 7,
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        InsightCardsSchema.parse({
          limit: 3,
          unknown: "key",
        })
      ).toThrow();
    });
  });

  describe("InsightExplanationSchema", () => {
    const validExplanation = {
      what: "This is what happened",
      why: "This is why it happened",
      next_steps: ["Step 1", "Step 2"],
    };

    it("parses valid explanation", () => {
      const result = InsightExplanationSchema.parse(validExplanation);
      expect(result.what).toBe("This is what happened");
      expect(result.why).toBe("This is why it happened");
      expect(result.next_steps).toEqual(["Step 1", "Step 2"]);
    });

    it("parses with 3 next_steps", () => {
      const result = InsightExplanationSchema.parse({
        ...validExplanation,
        next_steps: ["Step 1", "Step 2", "Step 3"],
      });
      expect(result.next_steps).toHaveLength(3);
    });

    it("rejects more than 3 next_steps", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          next_steps: ["Step 1", "Step 2", "Step 3", "Step 4"],
        })
      ).toThrow();
    });

    it("rejects next_steps shorter than 1 item", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          next_steps: [],
        })
      ).toThrow();
    });

    it("rejects what longer than 500 chars", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          what: "a".repeat(501),
        })
      ).toThrow();
    });

    it("rejects why longer than 500 chars", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          why: "a".repeat(501),
        })
      ).toThrow();
    });

    it("rejects next_steps item longer than 200 chars", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          next_steps: ["a".repeat(201)],
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        InsightExplanationSchema.parse({
          ...validExplanation,
          unknown: "key",
        })
      ).toThrow();
    });
  });
});
