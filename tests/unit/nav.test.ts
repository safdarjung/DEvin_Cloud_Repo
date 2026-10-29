import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { navItemsFor } from "@/lib/nav";

// Independently re-derived from 07 §2.2 (not just re-running navItemsFor's own
// logic back at itself) so a wrong permission on a NAV_ITEMS entry is caught.
const EXPECTED_HREFS: Record<Role, string[]> = {
  owner: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/academics",
    "/assignments",
    "/exams",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings",
  ],
  principal: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/academics",
    "/assignments",
    "/exams",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings",
  ],
  admin: [
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/academics",
    "/assignments",
    "/exams",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings",
  ],
  admissions: ["/dashboard", "/students", "/admissions", "/academics", "/website", "/notifications"],
  accountant: ["/dashboard", "/students", "/academics", "/finance", "/notifications"],
  exam_controller: ["/dashboard", "/students", "/attendance", "/academics", "/exams", "/notifications"],
  teacher: ["/students", "/attendance", "/academics", "/assignments", "/exams", "/ai", "/notifications"],
  student: ["/students", "/attendance", "/academics", "/assignments", "/exams", "/finance", "/notifications", "/portal"],
  guardian: ["/students", "/attendance", "/academics", "/assignments", "/exams", "/finance", "/notifications", "/portal"],
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
