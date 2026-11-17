import { describe, expect, it } from "vitest";
import { staffFromEmail } from "@/modules/core/setup/email-list";

describe("staffFromEmail", () => {
  it("names the placeholder staff row after the address and keeps the role's title", () => {
    const row = staffFromEmail("meera.iyer@school.in", "teacher");
    expect(row.fullName).toBe("Meera Iyer");
    expect(row.designation).toBe("Teacher");
    expect(row.isTeaching).toBe(true);
    expect(row.email).toBe("meera.iyer@school.in");
  });

  it("only teachers are teaching staff, and exam_controller reads as words", () => {
    expect(staffFromEmail("a@x.in", "accountant").isTeaching).toBe(false);
    expect(staffFromEmail("a@x.in", "exam_controller").designation).toBe("Exam controller");
  });

  it("copes with digits and odd local parts, and gives each row its own employee number", () => {
    const a = staffFromEmail("rajesh_k99@x.in", "admin");
    const b = staffFromEmail("rajesh_k99@x.in", "admin");
    expect(a.fullName).toBe("Rajesh K99");
    expect(a.employeeNo).toMatch(/^INV-[A-Z0-9]{6}$/);
    expect(a.employeeNo).not.toBe(b.employeeNo);
  });
});
