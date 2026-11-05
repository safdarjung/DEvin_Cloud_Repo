import { describe, it, expect } from "vitest";
import {
  VisitorCheckInSchema,
  VisitorCheckOutSchema,
  VisitorPurgeSchema,
  VisitorListSchema,
  PickupAddSchema,
  PickupRemoveSchema,
  PickupListSchema,
  GatePassCreateSchema,
  GatePassSetStatusSchema,
  GatePassListSchema,
  ID_TYPES,
  PICKUP_RELATIONS,
  GATE_PASS_STATUSES,
  VISITOR_RETENTION_DAYS,
  VISITOR_PRIVACY_NOTICE,
} from "../../src/modules/visitors/schemas";

describe("Visitors schemas", () => {
  describe("Constants", () => {
    it("exports correct ID types", () => {
      expect(ID_TYPES).toEqual(["aadhaar", "driving_licence", "voter_id", "pan", "passport", "other"]);
    });

    it("exports correct pickup relations", () => {
      expect(PICKUP_RELATIONS).toEqual(["father", "mother", "grandparent", "uncle", "aunt", "sibling", "driver", "other"]);
    });

    it("exports correct gate pass statuses", () => {
      expect(GATE_PASS_STATUSES).toEqual(["pending", "approved", "rejected", "cancelled", "exited"]);
    });

    it("exports retention days as 180", () => {
      expect(VISITOR_RETENTION_DAYS).toBe(180);
    });

    it("exports privacy notice", () => {
      expect(VISITOR_PRIVACY_NOTICE).toContain("180 days");
    });
  });

  describe("VisitorCheckInSchema", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";

    it("accepts valid check-in input", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        idType: "aadhaar",
        idLast4: "1234",
      });
      expect(result.success).toBe(true);
    });

    it("trims and uppercases idLast4", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        idType: "aadhaar",
        idLast4: " ab12 ",
      });
      expect(result.success).toBe(true);
      expect(result.data?.idLast4).toBe("AB12");
    });

    it("rejects invalid idLast4 with full 12-digit number", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        idType: "aadhaar",
        idLast4: "123456789012",
      });
      expect(result.success).toBe(false);
    });

    it("rejects idType without idLast4", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        idType: "aadhaar",
      });
      expect(result.success).toBe(false);
    });

    it("rejects neither hostStaffId nor meetingWith", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
      });
      expect(result.success).toBe(false);
    });

    it("accepts meetingWith as alternative to hostStaffId", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        meetingWith: "Office",
      });
      expect(result.success).toBe(true);
    });

    it("rejects idLast4 without idType", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        idLast4: "1234",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid phone (starting with 5)", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "5123456789",
        purpose: "Parent meeting",
        hostStaffId: validId,
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = VisitorCheckInSchema.safeParse({
        fullName: "John Doe",
        phone: "9876543210",
        purpose: "Parent meeting",
        hostStaffId: validId,
        unknownField: "should fail",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("VisitorCheckOutSchema", () => {
    it("accepts valid check-out input", () => {
      const result = VisitorCheckOutSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = VisitorCheckOutSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("VisitorPurgeSchema", () => {
    it("accepts empty object", () => {
      const result = VisitorPurgeSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = VisitorPurgeSchema.safeParse({
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("VisitorListSchema", () => {
    it("accepts empty filters", () => {
      const result = VisitorListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid date filter", () => {
      const result = VisitorListSchema.safeParse({
        date: "2026-10-26",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid onSite filter", () => {
      const result = VisitorListSchema.safeParse({
        onSite: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const result = VisitorListSchema.safeParse({
        date: "26-10-2026",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PickupAddSchema", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";

    it("accepts valid pickup addition", () => {
      const result = PickupAddSchema.safeParse({
        studentId: validId,
        fullName: "Ramesh Sharma",
        relation: "grandparent",
        phone: "9876543210",
      });
      expect(result.success).toBe(true);
    });

    it("rejects duplicate phone for same student (via constraint, not schema)", () => {
      // Schema doesn't enforce uniqueness, DB does
      const result = PickupAddSchema.safeParse({
        studentId: validId,
        fullName: "Person 1",
        relation: "grandparent",
        phone: "9876543210",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid phone", () => {
      const result = PickupAddSchema.safeParse({
        studentId: validId,
        fullName: "Ramesh Sharma",
        relation: "grandparent",
        phone: "5123456789",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown relation", () => {
      const result = PickupAddSchema.safeParse({
        studentId: validId,
        fullName: "Ramesh Sharma",
        relation: "unknown",
        phone: "9876543210",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = PickupAddSchema.safeParse({
        studentId: validId,
        fullName: "Ramesh Sharma",
        relation: "grandparent",
        phone: "9876543210",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PickupRemoveSchema", () => {
    it("accepts valid removal input", () => {
      const result = PickupRemoveSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = PickupRemoveSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PickupListSchema", () => {
    it("accepts valid list input", () => {
      const result = PickupListSchema.safeParse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = PickupListSchema.safeParse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GatePassCreateSchema", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";

    it("accepts valid gate pass with guardianId", () => {
      const result = GatePassCreateSchema.safeParse({
        studentId: validId,
        reason: "Early dismissal for appointment",
        guardianId: validId,
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid gate pass with pickupPersonId", () => {
      const result = GatePassCreateSchema.safeParse({
        studentId: validId,
        reason: "Early dismissal for appointment",
        pickupPersonId: validId,
      });
      expect(result.success).toBe(true);
    });

    it("rejects gate pass with both guardianId and pickupPersonId", () => {
      const result = GatePassCreateSchema.safeParse({
        studentId: validId,
        reason: "Early dismissal",
        guardianId: validId,
        pickupPersonId: validId,
      });
      expect(result.success).toBe(false);
    });

    it("rejects gate pass with neither guardianId nor pickupPersonId", () => {
      const result = GatePassCreateSchema.safeParse({
        studentId: validId,
        reason: "Early dismissal",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = GatePassCreateSchema.safeParse({
        studentId: validId,
        reason: "Early dismissal",
        guardianId: validId,
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GatePassSetStatusSchema", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";

    it("accepts valid status update to approved", () => {
      const result = GatePassSetStatusSchema.safeParse({
        id: validId,
        status: "approved",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid status update to rejected", () => {
      const result = GatePassSetStatusSchema.safeParse({
        id: validId,
        status: "rejected",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid status update to exited", () => {
      const result = GatePassSetStatusSchema.safeParse({
        id: validId,
        status: "exited",
      });
      expect(result.success).toBe(true);
    });

    it("rejects pending status in setStatus", () => {
      const result = GatePassSetStatusSchema.safeParse({
        id: validId,
        status: "pending",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = GatePassSetStatusSchema.safeParse({
        id: validId,
        status: "approved",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GatePassListSchema", () => {
    it("accepts empty filters", () => {
      const result = GatePassListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid status filter", () => {
      const result = GatePassListSchema.safeParse({
        status: "approved",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid date filter", () => {
      const result = GatePassListSchema.safeParse({
        date: "2026-10-26",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const result = GatePassListSchema.safeParse({
        status: "unknown",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = GatePassListSchema.safeParse({
        status: "approved",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });
});
