import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/actions/result";
import {
  CommitImportSchema,
  STAFF_COLUMNS,
  StaffImportRowSchema,
  StageImportSchema,
  STUDENT_COLUMNS,
  StudentImportRowSchema,
  parseCsv,
} from "@/modules/imports/schemas";

const STUDENT_ROW = {
  admission_no: "A-001",
  first_name: "Asha",
  last_name: "Rao",
  dob: "2015-04-12",
  gender: "female",
  grade: "5",
  section: "A",
  roll_no: "12",
  guardian_name: "Rohan Rao",
  guardian_phone: "9876543210",
  guardian_email: "rohan@example.com",
  guardian_relationship: "father",
};

describe("parseCsv", () => {
  it("parses a quoted field containing a comma", () => {
    const csv = `admission_no,first_name\nA-001,"Rao, Asha"`;
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["admission_no", "first_name"]);
    expect(rows).toEqual([{ admission_no: "A-001", first_name: "Rao, Asha" }]);
  });

  it("trims header and cell whitespace and skips empty lines", () => {
    const csv = `admission_no , first_name \n A-001 , Asha \n\nA-002,Rita`;
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["admission_no", "first_name"]);
    expect(rows).toEqual([
      { admission_no: "A-001", first_name: "Asha" },
      { admission_no: "A-002", first_name: "Rita" },
    ]);
  });

  it("throws validation_failed when the CSV has no header row", () => {
    expect(() => parseCsv("   \n  ")).toThrow(AppError);
    try {
      parseCsv("");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("validation_failed");
    }
  });

  it("throws validation_failed when a data row has the wrong field count", () => {
    const csv = `admission_no,first_name\nA-001,Asha,Extra`;
    expect(() => parseCsv(csv)).toThrow(AppError);
  });

  it("throws validation_failed when there are more than 5000 rows", () => {
    const lines = ["admission_no,first_name"];
    for (let i = 0; i < 5001; i += 1) lines.push(`A-${i},Name${i}`);
    expect(() => parseCsv(lines.join("\n"))).toThrow(AppError);
    try {
      parseCsv(lines.join("\n"));
    } catch (err) {
      expect((err as AppError).code).toBe("validation_failed");
    }
  });
});

describe("StudentImportRowSchema", () => {
  it("accepts a well-formed row", () => {
    const result = StudentImportRowSchema.safeParse(STUDENT_ROW);
    expect(result.success).toBe(true);
  });

  it("normalises guardian_phone with +91 prefix and dashes/spaces", () => {
    const result = StudentImportRowSchema.safeParse({
      ...STUDENT_ROW,
      guardian_phone: "+91 98765-43210",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guardian_phone).toBe("9876543210");
    }
  });

  it("rejects an invalid dob", () => {
    const result = StudentImportRowSchema.safeParse({ ...STUDENT_ROW, dob: "12/04/2015" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.dob).toBeDefined();
    }
  });

  it("rejects an invalid guardian_phone", () => {
    const result = StudentImportRowSchema.safeParse({ ...STUDENT_ROW, guardian_phone: "12345" });
    expect(result.success).toBe(false);
  });

  it("accepts an optional roll_no left blank", () => {
    const result = StudentImportRowSchema.safeParse({ ...STUDENT_ROW, roll_no: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roll_no).toBeUndefined();
    }
  });
});

describe("StaffImportRowSchema", () => {
  const STAFF_ROW = {
    employee_no: "E-001",
    full_name: "Meena Iyer",
    designation: "Teacher",
    department: "Science",
    phone: "9876543210",
    email: "meena@example.com",
    is_teaching: "Yes",
  };

  it("maps is_teaching Yes to true", () => {
    const result = StaffImportRowSchema.safeParse(STAFF_ROW);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_teaching).toBe(true);
    }
  });

  it("maps is_teaching no to false", () => {
    const result = StaffImportRowSchema.safeParse({ ...STAFF_ROW, is_teaching: "no" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_teaching).toBe(false);
    }
  });

  it("accepts a blank optional department/phone/email", () => {
    const result = StaffImportRowSchema.safeParse({
      ...STAFF_ROW,
      department: "",
      phone: "",
      email: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid is_teaching value", () => {
    const result = StaffImportRowSchema.safeParse({ ...STAFF_ROW, is_teaching: "maybe" });
    expect(result.success).toBe(false);
  });
});

describe("template columns", () => {
  it("defines the student CSV template header order", () => {
    expect(STUDENT_COLUMNS).toEqual([
      "admission_no",
      "first_name",
      "last_name",
      "dob",
      "gender",
      "grade",
      "section",
      "roll_no",
      "guardian_name",
      "guardian_phone",
      "guardian_email",
      "guardian_relationship",
    ]);
  });

  it("defines the staff CSV template header order", () => {
    expect(STAFF_COLUMNS).toEqual([
      "employee_no",
      "full_name",
      "designation",
      "department",
      "phone",
      "email",
      "is_teaching",
    ]);
  });
});

describe("StageImportSchema / CommitImportSchema", () => {
  it("accepts a valid stage payload", () => {
    const result = StageImportSchema.safeParse({
      entityType: "students",
      fileName: "students.csv",
      csv: "admission_no\nA-001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a csv payload over 1 MB", () => {
    const result = StageImportSchema.safeParse({
      entityType: "students",
      fileName: "students.csv",
      csv: "a".repeat(1_048_577),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown entityType", () => {
    const result = StageImportSchema.safeParse({
      entityType: "teachers",
      fileName: "x.csv",
      csv: "a",
    });
    expect(result.success).toBe(false);
  });

  it("validates a batchId as uuid", () => {
    expect(CommitImportSchema.safeParse({ batchId: "not-a-uuid" }).success).toBe(false);
    expect(
      CommitImportSchema.safeParse({ batchId: "123e4567-e89b-12d3-a456-426614174000" }).success,
    ).toBe(true);
  });
});
