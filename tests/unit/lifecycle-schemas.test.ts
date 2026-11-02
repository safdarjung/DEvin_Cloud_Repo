import { describe, expect, it } from "vitest";
import {
  HistorySchema,
  PromoteSchema,
  TransferSchema,
  WithdrawSchema,
} from "@/modules/lifecycle/schemas";
import {
  GuardianLinkSchema,
  GuardianUpdateSchema,
  StudentUpdateSchema,
} from "@/modules/people/schemas";

describe("PromoteSchema", () => {
  it("parses valid inputs", () => {
    const input = {
      fromYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      toYearId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      mappings: [
        {
          fromSectionId: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
          toSectionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        },
      ],
    };
    const result = PromoteSchema.parse(input);
    expect(result.fromYearId).toBe(input.fromYearId);
    expect(result.toYearId).toBe(input.toYearId);
    expect(result.mappings.length).toBe(1);
  });

  it("rejects same from/to year", () => {
    const input = {
      fromYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      toYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      mappings: [],
    };
    expect(() => PromoteSchema.parse(input)).toThrow();
  });

  it("rejects duplicate fromSectionId in mappings", () => {
    const input = {
      fromYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      toYearId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      mappings: [
        {
          fromSectionId: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
          toSectionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        },
        {
          fromSectionId: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
          toSectionId: "6ba7b810-9dad-11d1-80b4-00c04fd430ca",
        },
      ],
    };
    expect(() => PromoteSchema.parse(input)).toThrow();
  });

  it("rejects a student in both overrides and exclude", () => {
    const studentId = "f47ac10b-58cc-4372-a567-0e02b2c3d481";
    const input = {
      fromYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      toYearId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      mappings: [],
      overrides: [
        {
          studentId,
          toSectionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        },
      ],
      exclude: [studentId],
    };
    expect(() => PromoteSchema.parse(input)).toThrow();
  });

  it("allows null toSectionId in mappings", () => {
    const input = {
      fromYearId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      toYearId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      mappings: [
        {
          fromSectionId: "f47ac10b-58cc-4372-a567-0e02b2c3d480",
          toSectionId: null,
        },
      ],
    };
    const result = PromoteSchema.parse(input);
    expect(result.mappings[0].toSectionId).toBeNull();
  });
});

describe("TransferSchema", () => {
  it("parses valid inputs with destinationSchool", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "Family relocation",
      leftOn: "2026-11-02",
      destinationSchool: "St. Xavier School",
      conduct: "Good",
    };
    const result = TransferSchema.parse(input);
    expect(result.studentId).toBe(input.studentId);
    expect(result.reason).toBe(input.reason);
  });

  it("rejects transfer without destinationSchool", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "Family relocation",
      destinationSchool: "",
    };
    expect(() => TransferSchema.parse(input)).toThrow();
  });

  it("rejects reason outside 3-500 chars", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "ab",
      destinationSchool: "St. Xavier School",
    };
    expect(() => TransferSchema.parse(input)).toThrow();
  });

  it("trims reason whitespace", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "  Family relocation  ",
      destinationSchool: "St. Xavier School",
    };
    const result = TransferSchema.parse(input);
    expect(result.reason).toBe("Family relocation");
  });
});

describe("WithdrawSchema", () => {
  it("parses valid inputs without destinationSchool", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "Health reasons",
      leftOn: "2026-11-02",
    };
    const result = WithdrawSchema.parse(input);
    expect(result.studentId).toBe(input.studentId);
  });

  it("rejects reason outside 3-500 chars", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      reason: "x",
    };
    expect(() => WithdrawSchema.parse(input)).toThrow();
  });
});

describe("HistorySchema", () => {
  it("parses valid studentId", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    };
    const result = HistorySchema.parse(input);
    expect(result.studentId).toBe(input.studentId);
  });
});

describe("StudentUpdateSchema", () => {
  it("parses valid inputs with multiple fields", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      firstName: "John",
      lastName: "Doe",
      dob: "2015-01-15",
      gender: "male",
      admissionNo: "A-001",
    };
    const result = StudentUpdateSchema.parse(input);
    expect(result.studentId).toBe(input.studentId);
    expect(result.firstName).toBe(input.firstName);
  });

  it("rejects studentId alone without other fields", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    };
    expect(() => StudentUpdateSchema.parse(input)).toThrow();
  });

  it("rejects status key (strict mode)", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      firstName: "John",
      status: "active",
    };
    expect(() => StudentUpdateSchema.parse(input)).toThrow();
  });

  it("allows null lastName", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      firstName: "John",
      lastName: null,
    };
    const result = StudentUpdateSchema.parse(input);
    expect(result.lastName).toBeNull();
  });

  it("rejects invalid gender", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      firstName: "John",
      gender: "invalid",
    };
    expect(() => StudentUpdateSchema.parse(input)).toThrow();
  });

  it("accepts valid genders: male, female, other", () => {
    const validGenders = ["male", "female", "other"];
    for (const gender of validGenders) {
      const input = {
        studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        firstName: "John",
        gender,
      };
      const result = StudentUpdateSchema.parse(input);
      expect(result.gender).toBe(gender);
    }
  });
});

describe("GuardianUpdateSchema", () => {
  it("parses valid inputs with multiple fields", () => {
    const input = {
      guardianId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      fullName: "Jane Doe",
      phone: "9876543210",
      email: "jane@example.com",
    };
    const result = GuardianUpdateSchema.parse(input);
    expect(result.guardianId).toBe(input.guardianId);
    expect(result.fullName).toBe(input.fullName);
  });

  it("rejects guardianId alone without other fields", () => {
    const input = {
      guardianId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    };
    expect(() => GuardianUpdateSchema.parse(input)).toThrow();
  });

  it("rejects invalid phone", () => {
    const input = {
      guardianId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      phone: "12345",
    };
    expect(() => GuardianUpdateSchema.parse(input)).toThrow();
  });

  it("allows null email", () => {
    const input = {
      guardianId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      fullName: "Jane Doe",
      email: null,
    };
    const result = GuardianUpdateSchema.parse(input);
    expect(result.email).toBeNull();
  });
});

describe("GuardianLinkSchema", () => {
  it("parses with guardianId and no guardian object", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      relationship: "father",
      isPrimary: true,
      guardianId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    };
    const result = GuardianLinkSchema.parse(input);
    expect(result.guardianId).toBe(input.guardianId);
    expect(result.guardian).toBeUndefined();
  });

  it("parses with guardian object and no guardianId", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      relationship: "mother",
      isPrimary: false,
      guardian: {
        fullName: "Jane Doe",
        phone: "9876543210",
        email: "jane@example.com",
      },
    };
    const result = GuardianLinkSchema.parse(input);
    expect(result.guardian?.fullName).toBe(input.guardian.fullName);
    expect(result.guardianId).toBeUndefined();
  });

  it("rejects both guardianId and guardian object", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      relationship: "father",
      guardianId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      guardian: {
        fullName: "Jane Doe",
        phone: "9876543210",
      },
    };
    expect(() => GuardianLinkSchema.parse(input)).toThrow();
  });

  it("rejects neither guardianId nor guardian object", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      relationship: "father",
    };
    expect(() => GuardianLinkSchema.parse(input)).toThrow();
  });

  it("accepts valid relationships", () => {
    const relationships = [
      "father",
      "mother",
      "legal_guardian",
      "grandparent",
      "other",
    ];
    for (const rel of relationships) {
      const input = {
        studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        relationship: rel,
        guardianId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      };
      const result = GuardianLinkSchema.parse(input);
      expect(result.relationship).toBe(rel);
    }
  });

  it("rejects invalid relationship", () => {
    const input = {
      studentId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      relationship: "aunt",
      guardianId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    };
    expect(() => GuardianLinkSchema.parse(input)).toThrow();
  });
});
