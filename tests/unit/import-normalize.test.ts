import { describe, expect, it } from "vitest";
import { normalizeStudentRow } from "@/modules/imports/normalize";
import { parseCsv, StudentImportRowSchema } from "@/modules/imports/schemas";

const base = {
  admission_no: "A1", first_name: "Ravi", last_name: "", dob: "2014-05-01", gender: "male", grade: "V", section: "A",
  roll_no: "", guardian_name: "Sita", guardian_phone: "9876543210", guardian_email: "", guardian_relationship: "mother",
};

describe("normalizeStudentRow", () => {
  it("maps everyday spreadsheet values to the strict ones", () => {
    const row = normalizeStudentRow({ ...base, gender: "Female", grade: "Class 5", section: "a", dob: "01/05/2014", guardian_relationship: "Father" });
    expect(row).toMatchObject({ gender: "female", grade: "V", section: "A", dob: "2014-05-01", guardian_relationship: "father" });
  });
  it("accepts M/F, Std, Roman and nursery grades, and guardian wording", () => {
    expect(normalizeStudentRow({ ...base, gender: "M" }).gender).toBe("male");
    expect(normalizeStudentRow({ ...base, grade: "Std. 12" }).grade).toBe("XII");
    expect(normalizeStudentRow({ ...base, grade: "v" }).grade).toBe("V");
    expect(normalizeStudentRow({ ...base, grade: "Nursery" }).grade).toBe("NUR");
    expect(normalizeStudentRow({ ...base, guardian_relationship: "Legal Guardian" }).guardian_relationship).toBe("legal_guardian");
    expect(normalizeStudentRow({ ...base, guardian_relationship: "Grandmother" }).guardian_relationship).toBe("grandparent");
  });
  it("repairs Excel phone numbers", () => {
    expect(normalizeStudentRow({ ...base, guardian_phone: "9.87654E+09" }).guardian_phone).toBe("9876540000");
    expect(normalizeStudentRow({ ...base, guardian_phone: "09876543210" }).guardian_phone).toBe("9876543210");
    expect(normalizeStudentRow({ ...base, guardian_phone: "+91 98765 43210" }).guardian_phone).toBe("9876543210");
  });
  it("leaves unknown values alone so validation still reports them", () => {
    expect(normalizeStudentRow({ ...base, gender: "robot", dob: "someday" })).toMatchObject({ gender: "robot", dob: "someday" });
  });
  it("normalised rows pass the strict schema", () => {
    const row = normalizeStudentRow({ ...base, gender: "Male", grade: "Class 5", dob: "1/5/2014" });
    expect(StudentImportRowSchema.safeParse(row).success).toBe(true);
  });
});

describe("parseCsv ragged rows", () => {
  it("keeps going when a row has too few or too many fields", () => {
    const { rows } = parseCsv("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
    expect(rows).toHaveLength(3);
    expect(rows[1].c).toBeUndefined();
    expect(rows[2]).toHaveProperty("__parsed_extra");
  });
  it("still rejects broken quoting", () => {
    expect(() => parseCsv('a,b\n"x,2\n')).toThrow();
  });
});
