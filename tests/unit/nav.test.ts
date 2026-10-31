import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { homePathFor, navItemsFor } from "@/lib/nav";

// Independently re-derived from 07 §2.2 (not just re-running navItemsFor's own
// logic back at itself) so a wrong permission on a NAV_ITEMS entry is caught.
const FABRIC_HREFS = [
  "/fabric/learning", "/fabric/students", "/fabric/operations", "/fabric/finance-intel", "/fabric/insights",
  "/fabric/simulator", "/fabric/twin", "/fabric/agents", "/fabric/marketplace", "/fabric/studio",
  "/fabric/data", "/fabric/trust",
];
const EXPECTED_HREFS: Record<Role, string[]> = {
  owner: [
    ...FABRIC_HREFS, "/me",
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  principal: [
    ...FABRIC_HREFS, "/me",
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  admin: [
    ...FABRIC_HREFS, "/me",
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/finance",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
  ],
  admissions: ["/dashboard", "/students", "/admissions", "/website", "/ai", "/notifications", ...FABRIC_HREFS, "/me"],
  accountant: ["/dashboard", "/students", "/finance", "/notifications", ...FABRIC_HREFS],
  exam_controller: ["/dashboard", "/students", "/attendance", "/exams", "/exams/rechecks", "/notifications", ...FABRIC_HREFS],
  teacher: ["/today", "/students", "/attendance", "/assignments", "/exams", "/ai", "/notifications", "/me"],
  // Portal roles hold read permissions for their own child's data, but the
  // staff module pages aren't built for them — the portal tabs are.
  student: ["/notifications", "/portal"],
  guardian: ["/notifications", "/portal"],
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

  it("Today is for teachers only: staff with dashboard.view and portal users never see it", () => {
    for (const role of ["owner", "principal", "admin", "student", "guardian"] as Role[]) {
      const hrefs = navItemsFor(new Set(permissionsFor(role))).map((item) => item.href);
      expect(hrefs).not.toContain("/today");
    }
  });

  it("teacher's first link is Today", () => {
    expect(navItemsFor(new Set(permissionsFor("teacher")))[0]?.href).toBe("/today");
  });

  it("every item belongs to a group and groups keep their order", () => {
    const order = ["Overview", "Academics", "Operations", "Communication", "Admin", "Fabric", "Personal"];
    const groups = navItemsFor(new Set(permissionsFor("owner"))).map((item) => order.indexOf(item.group));
    expect(groups).not.toContain(-1);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
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
    teacher: "/today",
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
