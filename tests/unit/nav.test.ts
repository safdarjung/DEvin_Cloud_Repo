import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { homePathFor, navItemsFor } from "@/lib/nav";

// Independently re-derived from 07 §2.2 (not just re-running navItemsFor's own
// logic back at itself) so a wrong permission on a NAV_ITEMS entry is caught.
const EXPECTED_HREFS: Record<Role, string[]> = {
  owner: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/website",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  principal: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/website",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  admin: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/finance",
    "/website",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  admissions: ["/dashboard", "/students", "/admissions", "/website", "/notifications"],
  accountant: ["/dashboard", "/students", "/finance", "/notifications"],
  exam_controller: ["/dashboard", "/students", "/attendance", "/exams", "/exams/rechecks", "/notifications"],
  teacher: ["/students", "/attendance", "/assignments", "/exams", "/notifications"],
  student: ["/students", "/attendance", "/assignments", "/exams", "/finance", "/notifications", "/portal"],
  guardian: ["/students", "/attendance", "/assignments", "/exams", "/finance", "/notifications", "/portal"],
};

describe("navItemsFor", () => {
  for (const role of Object.keys(EXPECTED_HREFS) as Role[]) {
    it(`matches the expected link set for ${role}`, () => {
      const hrefs = navItemsFor(new Set(permissionsFor(role))).map((item) => item.href);
      expect(new Set(hrefs)).toEqual(new Set(EXPECTED_HREFS[role]));
    });
  }

  it("teacher has no Finance link (07 §1 T3)", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("teacher"))).map((item) => item.href);
    expect(hrefs).not.toContain("/finance");
  });

  it("guardian sees only the Portal-facing links", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("guardian"))).map((item) => item.href);
    expect(hrefs).toContain("/portal");
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/dashboard");
  });
});

// T-041 "Found" / T-042: `/[institution]` sent every member without
// `dashboard.view` to `/portal`, which throws for staff (teacher → 500).
describe("homePathFor", () => {
  const EXPECTED_HOME: Record<Role, string> = {
    owner: "/dashboard",
    principal: "/dashboard",
    admin: "/dashboard",
    admissions: "/dashboard",
    accountant: "/dashboard",
    exam_controller: "/dashboard",
    teacher: "/attendance",
    student: "/portal",
    guardian: "/portal",
  };

  for (const role of Object.keys(EXPECTED_HOME) as Role[]) {
    it(`sends ${role} to ${EXPECTED_HOME[role]}`, () => {
      expect(homePathFor(new Set(permissionsFor(role)))).toBe(EXPECTED_HOME[role]);
    });
  }

  it("never sends a staff member without dashboard.view to the portal", () => {
    expect(homePathFor(new Set(["student.read", "notification.read"]))).toBe("/students");
  });

  it("falls back to notifications when nothing else is permitted", () => {
    expect(homePathFor(new Set())).toBe("/notifications");
  });
});
