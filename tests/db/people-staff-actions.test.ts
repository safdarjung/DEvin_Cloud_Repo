import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { upsertDepartment, upsertStaff } from "@/modules/people/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M03-T10 — people.department.upsert / people.staff.upsert. Columns exactly
// as 0004: departments.name; staff.{employee_no, full_name, designation,
// department_id, phone, email, status, is_teaching}.

afterAll(async () => {
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("people setup actions (M03-T10)", () => {
  it("admin creates a department and a teaching staff member", async () => {
    const inst = await createTestInstitution("people-setup-ok");

    const department = await callAs(inst, "admin", upsertDepartment, { name: "Science" });
    expect(department.ok).toBe(true);
    if (!department.ok) return;

    const staff = await callAs(inst, "admin", upsertStaff, {
      employeeNo: `EMP-${crypto.randomUUID().slice(0, 8)}`,
      fullName: "Jane Teacher",
      designation: "Teacher",
      departmentId: department.data.id,
      isTeaching: true,
    });
    expect(staff.ok).toBe(true);
    if (!staff.ok) return;
    expect(staff.data.departmentId).toBe(department.data.id);
    expect(staff.data.isTeaching).toBe(true);
    expect(staff.data.status).toBe("active");
  });

  it("an accountant is forbidden", async () => {
    const inst = await createTestInstitution("people-setup-forbidden");

    const result = await callAs(inst, "accountant", upsertDepartment, { name: "Science" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("a duplicate employee_no is a conflict", async () => {
    const inst = await createTestInstitution("people-setup-staff-conflict");
    const employeeNo = `EMP-${crypto.randomUUID().slice(0, 8)}`;

    const first = await callAs(inst, "admin", upsertStaff, {
      employeeNo,
      fullName: "First Staff",
      designation: "Teacher",
    });
    expect(first.ok).toBe(true);

    const second = await callAs(inst, "admin", upsertStaff, {
      employeeNo,
      fullName: "Second Staff",
      designation: "Teacher",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("conflict");
  });

  it("a department from another institution is rejected (0065)", async () => {
    const instA = await createTestInstitution("people-setup-fk-a");
    const instB = await createTestInstitution("people-setup-fk-b");
    try {
      const deptB = await callAs(instB, "admin", upsertDepartment, { name: "Arts" });
      expect(deptB.ok).toBe(true);
      if (!deptB.ok) return;

      const result = await callAs(instA, "admin", upsertStaff, {
        employeeNo: `EMP-${crypto.randomUUID().slice(0, 8)}`,
        fullName: "Cross Tenant",
        designation: "Teacher",
        departmentId: deptB.data.id,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // 0065's staff_insert `with check` rejects this at the RLS layer
      // (SQLSTATE 42501); mapSqlError maps 42501 to `forbidden` since M12.
      expect(result.error.code).toBe("forbidden");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });
});
