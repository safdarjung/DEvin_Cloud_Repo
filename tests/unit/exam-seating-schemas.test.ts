import { describe, it, expect } from "vitest";
import {
  GenerateSeatingSchema,
  SlotsQuerySchema,
  PlanIdSchema,
  StudentSeatsSchema,
  AdmitCardsSchema,
} from "../../src/modules/exam-seating/schemas";

describe("exam-seating schemas", () => {
  describe("GenerateSeatingSchema", () => {
    it("parses valid generate input", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00.000Z",
        rooms: [
          { roomId: "550e8400-e29b-41d4-a716-446655440001", seats: 30 },
        ],
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examId).toBe(input.examId);
      }
    });

    it("parses when seats is omitted", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00.000Z",
        rooms: [
          { roomId: "550e8400-e29b-41d4-a716-446655440001" },
        ],
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects duplicate roomId", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00.000Z",
        rooms: [
          { roomId: "550e8400-e29b-41d4-a716-446655440001", seats: 30 },
          { roomId: "550e8400-e29b-41d4-a716-446655440001", seats: 25 },
        ],
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects more than 50 rooms", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00.000Z",
        rooms: Array.from({ length: 51 }, (_, i) => ({
          roomId: `550e8400-e29b-41d4-a716-44665544000${i.toString().padStart(2, "0")}`,
          seats: 30,
        })),
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects slotStart without offset", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00",
        rooms: [
          { roomId: "550e8400-e29b-41d4-a716-446655440001", seats: 30 },
        ],
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects unknown key", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        slotStart: "2026-11-16T04:00:00.000Z",
        rooms: [
          { roomId: "550e8400-e29b-41d4-a716-446655440001", seats: 30 },
        ],
        unknownField: "value",
      };
      const result = GenerateSeatingSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("SlotsQuerySchema", () => {
    it("parses valid input", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = SlotsQuerySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown key", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        extra: "field",
      };
      const result = SlotsQuerySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("PlanIdSchema", () => {
    it("parses valid input", () => {
      const input = {
        planId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = PlanIdSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("StudentSeatsSchema", () => {
    it("parses valid input", () => {
      const input = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      };
      const result = StudentSeatsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("AdmitCardsSchema", () => {
    it("parses with required fields only", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        classSectionId: "550e8400-e29b-41d4-a716-446655440001",
      };
      const result = AdmitCardsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("parses with optional studentId", () => {
      const input = {
        examId: "550e8400-e29b-41d4-a716-446655440000",
        classSectionId: "550e8400-e29b-41d4-a716-446655440001",
        studentId: "550e8400-e29b-41d4-a716-446655440002",
      };
      const result = AdmitCardsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
