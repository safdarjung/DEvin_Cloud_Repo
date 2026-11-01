import { describe, expect, it } from "vitest";
import { permissionsFor, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";

// Mirrors 07 §2.2's table layout exactly (column order own·pri·adm·ads·acc·exc·tch·stu·grd)
// so a mismatch is easy to spot against the doc. `✓` and `s` (scoped) both grant the
// permission here — scoping itself is enforced by RLS/handlers, not this check.
const ROLE_ORDER: Role[] = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
  "student",
  "guardian",
];

type Row = [Permission, ...boolean[]];

const MATRIX: Row[] = [
  ["institution.settings.manage", true, true, true, false, false, false, false, false, false],
  ["member.manage", true, true, true, false, false, false, false, false, false],
  ["audit.read", true, true, true, false, false, false, false, false, false],
  ["dashboard.view", true, true, true, true, true, true, false, false, false],
  ["student.read", true, true, true, true, true, true, true, true, true],
  ["student.write", true, true, true, true, false, false, false, false, false],
  ["guardian.read", true, true, true, true, true, false, true, false, true],
  ["staff.read", true, true, true, false, true, true, false, false, false],
  ["staff.write", true, true, true, false, false, false, false, false, false],
  ["academics.manage", true, true, true, false, false, false, false, false, false],
  ["academics.read", true, true, true, true, true, true, true, true, true],
  ["attendance.mark", true, true, true, false, false, false, true, false, false],
  ["attendance.correct", true, true, true, false, false, false, true, false, false],
  ["attendance.read", true, true, true, false, false, true, true, true, true],
  ["admissions.enquiry.read", true, true, true, true, false, false, false, false, false],
  ["admissions.enquiry.write", true, true, true, true, false, false, false, false, false],
  ["admissions.application.decide", true, true, false, true, false, false, false, false, false],
  ["admissions.enrol", true, true, true, true, false, false, false, false, false],
  ["finance.structure.manage", true, true, true, false, true, false, false, false, false],
  ["finance.invoice.generate", true, true, false, false, true, false, false, false, false],
  ["finance.payment.record", true, true, false, false, true, false, false, false, false],
  ["finance.read", true, true, true, false, true, false, false, true, true],
  ["exam.manage", true, true, false, false, false, true, false, false, false],
  ["exam.marks.enter", true, true, false, false, false, true, true, false, false],
  ["exam.result.publish", true, true, false, false, false, true, false, false, false],
  ["exam.result.read", true, true, true, false, false, true, true, true, true],
  ["exam.recheck.request", false, false, false, false, false, false, false, true, true],
  ["exam.recheck.review", true, true, false, false, false, true, false, false, false],
  ["exam.recheck.decide", true, true, false, false, false, true, false, false, false],
  ["assignment.manage", true, true, false, false, false, false, true, false, false],
  ["assignment.read", true, true, true, false, false, false, true, true, true],
  ["ai.generate", true, true, true, true, false, false, true, false, false],
  ["ai.usage.read", true, true, true, false, false, false, false, false, false],
  // D32/GU-08 — student only.
  ["ai.study", false, false, false, false, false, false, false, true, false],
  ["website.edit", true, true, true, true, false, false, false, false, false],
  ["website.publish", true, true, true, false, false, false, false, false, false],
  ["notification.read", true, true, true, true, true, true, true, true, true],
  ["notification.log.read", true, true, true, true, false, false, false, false, false],
  ["job.manage", true, true, true, false, false, false, false, false, false],
  ["data.import", true, true, true, false, false, false, false, false, false],
  ["document.read", true, true, true, true, true, true, true, true, true],
  ["document.write", true, true, true, true, false, false, false, false, false],
  ["announcement.manage", true, true, true, false, false, false, false, false, false],
  ["timetable.manage", true, true, true, false, false, false, false, false, false],
  ["timetable.read", true, true, true, true, true, true, true, true, true],
];

function expectedPermissionsForRole(role: Role): Permission[] {
  const index = ROLE_ORDER.indexOf(role);
  return MATRIX.filter((row) => row[index + 1]).map((row) => row[0]);
}

describe("ROLE_PERMISSIONS (C-03 snapshot of 07 §2.2)", () => {
  for (const role of ROLE_ORDER) {
    it(`matches the documented matrix for ${role}`, () => {
      const expected = new Set(expectedPermissionsForRole(role));
      const actual = new Set(permissionsFor(role));

      const missing = [...expected].filter((p) => !actual.has(p));
      const extra = [...actual].filter((p) => !expected.has(p));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }

  it("covers every documented role and no extra roles", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_ORDER].sort());
  });

  it("data.import is held by exactly owner, principal, admin", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("data.import"));
    expect(holders.sort()).toEqual(["admin", "owner", "principal"].sort());
  });
});
