import { describe, expect, it } from "vitest";
import {
  RoomUpsertSchema,
  PeriodUpsertSchema,
  VersionCreateSchema,
  SlotInputSchema,
  SaveSlotsSchema,
  PublishVersionSchema,
  ForSectionSchema,
  ForTeacherSchema,
  ForStudentSchema,
  VersionQuerySchema,
} from "../../src/modules/timetable/schemas";

describe("Timetable Schemas", () => {
  describe("RoomUpsertSchema", () => {
    it("accepts valid room input", () => {
      const input = { name: "A101", capacity: 40 };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts room with id", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "A102",
        capacity: 50,
      };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts room with kind", () => {
      const input = { name: "Lab", capacity: 30, kind: "lab" };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { name: "A101", capacity: 40, unknown: "field" };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects name shorter than 1", () => {
      const input = { name: "", capacity: 40 };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 40", () => {
      const input = { name: "a".repeat(41), capacity: 40 };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects capacity less than 1", () => {
      const input = { name: "A101", capacity: 0 };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects capacity greater than 500", () => {
      const input = { name: "A101", capacity: 501 };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects kind longer than 30", () => {
      const input = { name: "Lab", capacity: 30, kind: "a".repeat(31) };
      const result = RoomUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("PeriodUpsertSchema", () => {
    it("accepts valid period input", () => {
      const input = {
        seq: 1,
        name: "Period 1",
        startsAt: "09:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts period with id", () => {
      const input = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        seq: 2,
        name: "Period 2",
        startsAt: "10:00",
        endsAt: "11:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts period with isBreak", () => {
      const input = {
        seq: 3,
        name: "Break",
        startsAt: "11:00",
        endsAt: "11:30",
        isBreak: true,
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "09:00",
        endsAt: "10:00",
        unknown: "field",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects seq less than 1", () => {
      const input = {
        seq: 0,
        name: "P1",
        startsAt: "09:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects seq greater than 12", () => {
      const input = {
        seq: 13,
        name: "P1",
        startsAt: "09:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 30", () => {
      const input = {
        seq: 1,
        name: "a".repeat(31),
        startsAt: "09:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid time format \"9:5\"", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "9:5",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects endsAt less than or equal to startsAt", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "10:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects endsAt before startsAt", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "11:00",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts valid time formats", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "00:00",
        endsAt: "23:59",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid hour in time", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "24:00",
        endsAt: "25:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid minutes in time", () => {
      const input = {
        seq: 1,
        name: "P1",
        startsAt: "09:60",
        endsAt: "10:00",
      };
      const result = PeriodUpsertSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("VersionCreateSchema", () => {
    it("accepts valid version input", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440000",
        name: "Semester 1",
      };
      const result = VersionCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts version with copyFromVersionId", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440000",
        name: "Semester 2",
        copyFromVersionId: "550e8400-e29b-41d4-a716-446655440001",
      };
      const result = VersionCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440000",
        name: "S1",
        unknown: "field",
      };
      const result = VersionCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 60", () => {
      const input = {
        academicYearId: "550e8400-e29b-41d4-a716-446655440000",
        name: "a".repeat(61),
      };
      const result = VersionCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid academicYearId uuid", () => {
      const input = { academicYearId: "not-a-uuid", name: "S1" };
      const result = VersionCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("SlotInputSchema", () => {
    it("accepts valid slot input", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        weekday: 1,
        periodId: "550e8400-e29b-41d4-a716-446655440001",
        subjectId: "550e8400-e29b-41d4-a716-446655440002",
        teacherId: "550e8400-e29b-41d4-a716-446655440003",
      };
      const result = SlotInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts slot with roomId", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        weekday: 1,
        periodId: "550e8400-e29b-41d4-a716-446655440001",
        subjectId: "550e8400-e29b-41d4-a716-446655440002",
        teacherId: "550e8400-e29b-41d4-a716-446655440003",
        roomId: "550e8400-e29b-41d4-a716-446655440004",
      };
      const result = SlotInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        weekday: 1,
        periodId: "550e8400-e29b-41d4-a716-446655440001",
        subjectId: "550e8400-e29b-41d4-a716-446655440002",
        teacherId: "550e8400-e29b-41d4-a716-446655440003",
        unknown: "field",
      };
      const result = SlotInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects weekday less than 1", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        weekday: 0,
        periodId: "550e8400-e29b-41d4-a716-446655440001",
        subjectId: "550e8400-e29b-41d4-a716-446655440002",
        teacherId: "550e8400-e29b-41d4-a716-446655440003",
      };
      const result = SlotInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects weekday greater than 6", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        weekday: 7,
        periodId: "550e8400-e29b-41d4-a716-446655440001",
        subjectId: "550e8400-e29b-41d4-a716-446655440002",
        teacherId: "550e8400-e29b-41d4-a716-446655440003",
      };
      const result = SlotInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("SaveSlotsSchema", () => {
    it("accepts valid save slots input", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        slots: [
          {
            classSectionId: "550e8400-e29b-41d4-a716-446655440001",
            weekday: 1,
            periodId: "550e8400-e29b-41d4-a716-446655440002",
            subjectId: "550e8400-e29b-41d4-a716-446655440003",
            teacherId: "550e8400-e29b-41d4-a716-446655440004",
          },
        ],
      };
      const result = SaveSlotsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts save slots with replaceSectionIds", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        slots: [
          {
            classSectionId: "550e8400-e29b-41d4-a716-446655440001",
            weekday: 1,
            periodId: "550e8400-e29b-41d4-a716-446655440002",
            subjectId: "550e8400-e29b-41d4-a716-446655440003",
            teacherId: "550e8400-e29b-41d4-a716-446655440004",
          },
        ],
        replaceSectionIds: ["550e8400-e29b-41d4-a716-446655440005"],
      };
      const result = SaveSlotsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        slots: [],
        unknown: "field",
      };
      const result = SaveSlotsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects more than 500 slots", () => {
      const slots = Array.from({ length: 501 }, () => ({
        classSectionId: "550e8400-e29b-41d4-a716-446655440001",
        weekday: 1,
        periodId: "550e8400-e29b-41d4-a716-446655440002",
        subjectId: "550e8400-e29b-41d4-a716-446655440003",
        teacherId: "550e8400-e29b-41d4-a716-446655440004",
      }));
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        slots,
      };
      const result = SaveSlotsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects more than 100 replaceSectionIds", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        slots: [
          {
            classSectionId: "550e8400-e29b-41d4-a716-446655440001",
            weekday: 1,
            periodId: "550e8400-e29b-41d4-a716-446655440002",
            subjectId: "550e8400-e29b-41d4-a716-446655440003",
            teacherId: "550e8400-e29b-41d4-a716-446655440004",
          },
        ],
        replaceSectionIds: Array.from({ length: 101 }, () =>
          "550e8400-e29b-41d4-a716-446655440005"
        ),
      };
      const result = SaveSlotsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("PublishVersionSchema", () => {
    it("accepts valid publish version input", () => {
      const input = { versionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = PublishVersionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        unknown: "field",
      };
      const result = PublishVersionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("ForSectionSchema", () => {
    it("accepts valid for section input", () => {
      const input = { classSectionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = ForSectionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts for section with versionId", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        versionId: "550e8400-e29b-41d4-a716-446655440001",
      };
      const result = ForSectionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
        unknown: "field",
      };
      const result = ForSectionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("ForTeacherSchema", () => {
    it("accepts valid for teacher input", () => {
      const input = {};
      const result = ForTeacherSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts for teacher with staffId", () => {
      const input = { staffId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = ForTeacherSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts for teacher with versionId", () => {
      const input = { versionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = ForTeacherSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = { unknown: "field" };
      const result = ForTeacherSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("ForStudentSchema", () => {
    it("accepts valid for student input", () => {
      const input = { studentId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = ForStudentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        studentId: "550e8400-e29b-41d4-a716-446655440000",
        unknown: "field",
      };
      const result = ForStudentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("VersionQuerySchema", () => {
    it("accepts valid version query input", () => {
      const input = { versionId: "550e8400-e29b-41d4-a716-446655440000" };
      const result = VersionQuerySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const input = {
        versionId: "550e8400-e29b-41d4-a716-446655440000",
        unknown: "field",
      };
      const result = VersionQuerySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
