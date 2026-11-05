import { describe, it, expect } from "vitest";
import {
  CertificateKindSchema,
  IssueCertificateSchema,
  CertificateListSchema,
  CertificatePrintSchema,
  IdCardsSchema,
  CertificateSnapshotSchema,
  TcSnapshotSchema,
} from "../../src/modules/certificates/schemas";

const testUuid = "123e4567-e89b-12d3-a456-426614174000";

describe("CertificateKindSchema", () => {
  it("parses valid kinds", () => {
    expect(CertificateKindSchema.parse("bonafide")).toBe("bonafide");
    expect(CertificateKindSchema.parse("character")).toBe("character");
    expect(CertificateKindSchema.parse("transfer")).toBe("transfer");
  });
});

describe("IssueCertificateSchema", () => {
  it("parses bonafide with required purpose", () => {
    const data = {
      kind: "bonafide",
      studentId: testUuid,
      purpose: "Passport application",
    };
    const result = IssueCertificateSchema.parse(data);
    expect(result.kind).toBe("bonafide");
    expect((result as typeof result & { kind: "bonafide" }).purpose).toBe(
      "Passport application"
    );
  });

  it("rejects bonafide without purpose", () => {
    const data = { kind: "bonafide", studentId: testUuid };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("trims bonafide purpose (3-200 chars)", () => {
    const data = {
      kind: "bonafide",
      studentId: testUuid,
      purpose: "  Visa application  ",
    };
    const result = IssueCertificateSchema.parse(data);
    expect((result as typeof result & { kind: "bonafide" }).purpose).toBe(
      "Visa application"
    );
  });

  it("rejects bonafide purpose too short", () => {
    const data = {
      kind: "bonafide",
      studentId: testUuid,
      purpose: "ab",
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("rejects bonafide purpose too long", () => {
    const data = {
      kind: "bonafide",
      studentId: testUuid,
      purpose: "a".repeat(201),
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("parses character with conduct", () => {
    const data = {
      kind: "character",
      studentId: testUuid,
      conduct: "Good",
    };
    const result = IssueCertificateSchema.parse(data);
    expect(result.kind).toBe("character");
    expect((result as typeof result & { kind: "character" }).conduct).toBe("Good");
  });

  it("parses character with optional purpose", () => {
    const data = {
      kind: "character",
      studentId: testUuid,
      conduct: "Very good",
      purpose: "Higher education",
    };
    const result = IssueCertificateSchema.parse(data);
    expect((result as typeof result & { kind: "character" }).purpose).toBe(
      "Higher education"
    );
  });

  it("rejects character without conduct", () => {
    const data = { kind: "character", studentId: testUuid };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("rejects character conduct too short", () => {
    const data = {
      kind: "character",
      studentId: testUuid,
      conduct: "G",
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("rejects character conduct too long", () => {
    const data = {
      kind: "character",
      studentId: testUuid,
      conduct: "a".repeat(101),
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("trims character conduct (2-100 chars)", () => {
    const data = {
      kind: "character",
      studentId: testUuid,
      conduct: "  Excellent  ",
    };
    const result = IssueCertificateSchema.parse(data);
    expect((result as typeof result & { kind: "character" }).conduct).toBe("Excellent");
  });

  it("parses transfer with studentId only", () => {
    const data = {
      kind: "transfer",
      studentId: testUuid,
    };
    const result = IssueCertificateSchema.parse(data);
    expect(result.kind).toBe("transfer");
  });

  it("rejects transfer with purpose", () => {
    const data = {
      kind: "transfer",
      studentId: testUuid,
      purpose: "New school",
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("rejects transfer with conduct", () => {
    const data = {
      kind: "transfer",
      studentId: testUuid,
      conduct: "Good",
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });

  it("enforces strict mode (no extra fields)", () => {
    const data = {
      kind: "bonafide",
      studentId: testUuid,
      purpose: "Passport",
      extraField: "should fail",
    };
    expect(() => IssueCertificateSchema.parse(data)).toThrow();
  });
});

describe("CertificateListSchema", () => {
  it("parses with defaults", () => {
    const result = CertificateListSchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("accepts optional filters", () => {
    const data = {
      studentId: testUuid,
      serialNo: "BON/2026/00001",
      kind: "bonafide",
      limit: 25,
    };
    const result = CertificateListSchema.parse(data);
    expect(result.studentId).toBe(testUuid);
    expect(result.kind).toBe("bonafide");
  });

  it("trims serialNo (1-60 chars)", () => {
    const data = { serialNo: "  BON/2026/00001  " };
    const result = CertificateListSchema.parse(data);
    expect(result.serialNo).toBe("BON/2026/00001");
  });

  it("rejects limit > 100", () => {
    expect(() => CertificateListSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => CertificateListSchema.parse({ limit: 0 })).toThrow();
  });

  it("enforces strict mode", () => {
    const data = { extra: "field" };
    expect(() => CertificateListSchema.parse(data)).toThrow();
  });
});

describe("CertificatePrintSchema", () => {
  it("parses with certificateId", () => {
    const result = CertificatePrintSchema.parse({ certificateId: testUuid });
    expect(result.certificateId).toBe(testUuid);
  });

  it("enforces strict mode", () => {
    const data = { certificateId: testUuid, extra: "field" };
    expect(() => CertificatePrintSchema.parse(data)).toThrow();
  });
});

describe("IdCardsSchema", () => {
  it("parses with classSectionId", () => {
    const result = IdCardsSchema.parse({ classSectionId: testUuid });
    expect(result.classSectionId).toBe(testUuid);
  });

  it("enforces strict mode", () => {
    const data = { classSectionId: testUuid, extra: "field" };
    expect(() => IdCardsSchema.parse(data)).toThrow();
  });
});

describe("CertificateSnapshotSchema", () => {
  it("parses snapshot with required keys", () => {
    const snapshot = {
      kind: "bonafide",
      serial_no: "BON/2026/00001",
      issued_on: "2026-11-04",
      issued_by_name: "Principal Name",
      school: {
        name: "School Name",
        board: "CBSE",
        address: "123 Main St",
      },
      student: {
        name: "Student Name",
        admission_no: "ADM001",
        dob: "2010-05-15",
        gender: "M",
        status: "active",
      },
      guardian: {
        name: "Parent Name",
        relationship: "father",
      },
      enrolment: {
        grade: "X",
        section: "A",
        academic_year: "2025-26",
        roll_no: 1,
        status: "active",
      },
      admitted_on: "2020-04-01",
      purpose: "Passport application",
      conduct: null,
      tc: null,
    };
    const result = CertificateSnapshotSchema.parse(snapshot);
    expect(result.kind).toBe("bonafide");
    expect(result.serial_no).toBe("BON/2026/00001");
  });

  it("parses character snapshot with null roll_no and null guardian", () => {
    const snapshot = {
      kind: "character",
      serial_no: "CHR/2026/00001",
      issued_on: "2026-11-04",
      issued_by_name: "Principal",
      school: { name: "School", board: null, address: null },
      student: { name: "Student", admission_no: "A1", dob: "2010-01-01", gender: "female", status: "withdrawn" },
      guardian: null,
      enrolment: { grade: "X", section: "A", academic_year: "2025-26", roll_no: null, status: "withdrawn" },
      admitted_on: "2020-01-01",
      purpose: null,
      conduct: "Good",
      tc: null,
    };
    expect(CertificateSnapshotSchema.parse(snapshot).conduct).toBe("Good");
  });

  it("parses transfer snapshot with embedded tc and coerces dues", () => {
    const snapshot = {
      kind: "transfer",
      serial_no: "TC/2026/00001",
      issued_on: "2026-11-04",
      issued_by_name: "Principal",
      school: { name: "School", board: "CBSE", address: "Pune" },
      student: { name: "Student", admission_no: "A1", dob: "2010-01-01", gender: "male", status: "withdrawn" },
      guardian: { name: "Parent", relationship: "mother" },
      enrolment: null,
      admitted_on: null,
      purpose: null,
      conduct: null,
      tc: { ...tcFixture, dues_outstanding: "250.50" },
    };
    const result = CertificateSnapshotSchema.parse(snapshot);
    expect(result.tc?.dues_outstanding).toBe(250.5);
    expect(result.tc?.student_name).toBe("Asha Rao");
  });

  it("rejects transfer snapshot whose tc lacks tc_no", () => {
    const { tc_no: _omit, ...tcWithoutNo } = tcFixture;
    void _omit;
    const snapshot = {
      kind: "transfer",
      serial_no: "TC/2026/00001",
      issued_on: "2026-11-04",
      issued_by_name: "Principal",
      school: { name: "School", board: null, address: null },
      student: { name: "Student", admission_no: "A1", dob: "2010-01-01", gender: "male", status: "withdrawn" },
      guardian: null,
      enrolment: null,
      admitted_on: null,
      purpose: null,
      conduct: null,
      tc: tcWithoutNo,
    };
    expect(() => CertificateSnapshotSchema.parse(snapshot)).toThrow();
  });

  it("keeps unknown keys in loose object mode", () => {
    const snapshot = {
      kind: "bonafide",
      serial_no: "BON/2026/00001",
      issued_on: "2026-11-04",
      issued_by_name: "Principal",
      school: { name: "School", board: "CBSE", address: "" },
      student: { name: "Student", admission_no: "A1", dob: "2010-01-01", gender: "M", status: "active" },
      guardian: null,
      enrolment: null,
      admitted_on: "2020-01-01",
      purpose: "Test",
      conduct: null,
      tc: null,
      unknownKey: "preserved",
    };
    const result = CertificateSnapshotSchema.parse(snapshot);
    expect(result.unknownKey).toBe("preserved");
  });
});

// Shape of 0076 exit_student's tc_snapshot (frozen pupil fields + exit fields).
const tcFixture = {
  tc_no: "TC/2026/00001",
  student_name: "Asha Rao",
  admission_no: "A1",
  dob: "2010-01-01",
  gender: "female",
  primary_guardian_name: "Ravi Rao",
  grade: "X",
  section: "A",
  academic_year: "2025-26",
  admitted_on: "2020-04-01",
  left_on: "2026-11-04",
  kind: "transferred_out",
  reason: "Relocation",
  destination_school: "New School",
  conduct: "Good",
  dues_outstanding: 0,
  issued_at: "2026-11-04T10:00:00+00:00",
};

describe("TcSnapshotSchema", () => {
  it("parses TC snapshot with coerced dues_outstanding", () => {
    const tc = { ...tcFixture, dues_outstanding: "1500" };
    const result = TcSnapshotSchema.parse(tc);
    expect(result.dues_outstanding).toBe(1500);
    expect(typeof result.dues_outstanding).toBe("number");
  });

  it("parses TC snapshot with null conduct, destination, guardian and class", () => {
    const tc = {
      ...tcFixture,
      kind: "withdrawn",
      destination_school: null,
      conduct: null,
      primary_guardian_name: null,
      grade: null,
      section: null,
      academic_year: null,
      admitted_on: null,
    };
    const result = TcSnapshotSchema.parse(tc);
    expect(result.destination_school).toBeNull();
    expect(result.conduct).toBeNull();
    expect(result.grade).toBeNull();
  });

  it("rejects dues_outstanding that is not numeric", () => {
    expect(() => TcSnapshotSchema.parse({ ...tcFixture, dues_outstanding: "abc" })).toThrow();
  });

  it("keeps unknown keys in loose object mode", () => {
    const tc = { ...tcFixture, customField: "value" };
    const result = TcSnapshotSchema.parse(tc);
    expect(result.customField).toBe("value");
  });
});
