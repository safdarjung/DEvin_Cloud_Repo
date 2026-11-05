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
  ["finance.payment.void", true, true, false, false, false, false, false, false, false],
  ["finance.payment.online", true, true, false, false, true, false, false, false, true],
  ["finance.reminder.send", true, true, false, false, true, false, false, false, false],
  ["finance.read", true, true, true, false, true, false, false, true, true],
  ["exam.manage", true, true, false, false, false, true, false, false, false],
  ["exam.marks.enter", true, true, false, false, false, true, true, false, false],
  ["exam.result.publish", true, true, false, false, false, true, false, false, false],
  ["exam.result.read", true, true, true, false, false, true, true, true, true],
  ["exam.recheck.request", false, false, false, false, false, false, false, true, true],
  ["exam.recheck.review", true, true, false, false, false, true, false, false, false],
  ["exam.recheck.decide", true, true, false, false, false, true, false, false, false],
  ["exam.seating.read", true, true, true, false, false, true, false, true, true],
  ["assignment.manage", true, true, false, false, false, false, true, false, false],
  ["assignment.read", true, true, true, false, false, false, true, true, true],
  ["assignment.submit", false, false, false, false, false, false, false, true, false],
  ["ai.generate", true, true, true, true, false, false, true, false, false],
  ["ai.usage.read", true, true, true, false, false, false, false, false, false],
  // D32/GU-08 — student only.
  ["ai.study", false, false, false, false, false, false, false, true, false],
  ["website.edit", true, true, true, true, false, false, false, false, false],
  ["website.publish", true, true, true, false, false, false, false, false, false],
  ["notification.read", true, true, true, true, true, true, true, true, true],
  ["notification.log.read", true, true, true, true, false, false, false, false, false],
  ["question.manage", true, true, false, false, false, true, true, false, false],
  ["library.manage", true, true, true, false, false, false, false, false, false],
  ["library.read", true, true, true, true, true, true, true, true, true],
  ["job.manage", true, true, true, false, false, false, false, false, false],
  ["data.import", true, true, true, false, false, false, false, false, false],
  ["data.export", true, true, true, false, true, false, false, false, false],
  ["document.read", true, true, true, true, true, true, true, true, true],
  ["document.write", true, true, true, true, false, false, false, true, false],
  ["announcement.manage", true, true, true, false, false, false, false, false, false],
  ["timetable.manage", true, true, true, false, false, false, false, false, false],
  ["timetable.read", true, true, true, true, true, true, true, true, true],
  ["staff.attendance.mark", true, true, true, true, true, true, true, false, false],
  ["leave.request", true, true, true, true, true, true, true, false, false],
  ["leave.approve", true, true, true, false, false, false, false, false, false],
  ["certificate.manage", true, true, true, true, false, false, false, false, false],
  ["facilities.manage", true, true, true, false, false, false, false, false, false],
  ["transport.manage", true, true, true, false, false, false, false, false, false],
  ["maintenance.request", true, true, true, true, true, true, true, false, false],
  ["insight.read", true, true, true, true, true, true, true, false, false],
  ["insight.review", true, true, true, true, true, true, false, false, false],
  ["report.schedule", true, true, true, false, false, false, false, false, false],
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

  it("facilities.manage is held by exactly owner, principal, admin", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("facilities.manage"));
    expect(holders.sort()).toEqual(["admin", "owner", "principal"].sort());
  });

  it("transport.manage is held by exactly owner, principal, admin", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("transport.manage"));
    expect(holders.sort()).toEqual(["admin", "owner", "principal"].sort());
  });

  it("certificate.manage is held by exactly owner, principal, admin, admissions", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("certificate.manage"));
    expect(holders.sort()).toEqual(["admin", "admissions", "owner", "principal"].sort());
  });

  it("maintenance.request is held by all 7 staff roles", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("maintenance.request"));
    expect(holders.sort()).toEqual(["accountant", "admin", "admissions", "exam_controller", "owner", "principal", "teacher"].sort());
  });

  it("maintenance.request is not held by guardian or student", () => {
    expect(permissionsFor("guardian").includes("maintenance.request")).toBe(false);
    expect(permissionsFor("student").includes("maintenance.request")).toBe(false);
  });

  it("teacher has maintenance.request but not facilities.manage", () => {
    expect(permissionsFor("teacher").includes("maintenance.request")).toBe(true);
    expect(permissionsFor("teacher").includes("facilities.manage")).toBe(false);
  });

  it("accountant has maintenance.request but not facilities.manage or transport.manage", () => {
    expect(permissionsFor("accountant").includes("maintenance.request")).toBe(true);
    expect(permissionsFor("accountant").includes("facilities.manage")).toBe(false);
    expect(permissionsFor("accountant").includes("transport.manage")).toBe(false);
  });

  it("admin has all three new permissions", () => {
    expect(permissionsFor("admin").includes("facilities.manage")).toBe(true);
    expect(permissionsFor("admin").includes("transport.manage")).toBe(true);
    expect(permissionsFor("admin").includes("maintenance.request")).toBe(true);
  });

  it("teacher has insight.read but not insight.review", () => {
    expect(permissionsFor("teacher").includes("insight.read")).toBe(true);
    expect(permissionsFor("teacher").includes("insight.review")).toBe(false);
  });

  it("accountant has both insight.read and insight.review", () => {
    expect(permissionsFor("accountant").includes("insight.read")).toBe(true);
    expect(permissionsFor("accountant").includes("insight.review")).toBe(true);
  });

  it("guardian and student have neither insight.read nor insight.review", () => {
    expect(permissionsFor("guardian").includes("insight.read")).toBe(false);
    expect(permissionsFor("guardian").includes("insight.review")).toBe(false);
    expect(permissionsFor("student").includes("insight.read")).toBe(false);
    expect(permissionsFor("student").includes("insight.review")).toBe(false);
  });

  it("insight.read is held by owner, principal, admin, admissions, accountant, exam_controller, teacher", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("insight.read"));
    expect(holders.sort()).toEqual(
      ["accountant", "admin", "admissions", "exam_controller", "owner", "principal", "teacher"].sort()
    );
  });

  it("insight.review is held by owner, principal, admin, admissions, accountant, exam_controller", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("insight.review"));
    expect(holders.sort()).toEqual(
      ["accountant", "admin", "admissions", "exam_controller", "owner", "principal"].sort()
    );
  });

  it("guardian holds finance.payment.online, not finance.payment.void", () => {
    expect(permissionsFor("guardian").includes("finance.payment.online")).toBe(true);
    expect(permissionsFor("guardian").includes("finance.payment.void")).toBe(false);
  });

  it("accountant holds finance.reminder.send, not finance.payment.void", () => {
    expect(permissionsFor("accountant").includes("finance.reminder.send")).toBe(true);
    expect(permissionsFor("accountant").includes("finance.payment.void")).toBe(false);
  });

  it("finance.payment.void is held by owner and principal only", () => {
    const holders = ROLE_ORDER.filter((role) => permissionsFor(role).includes("finance.payment.void"));
    expect(holders.sort()).toEqual(["owner", "principal"].sort());
  });
});
