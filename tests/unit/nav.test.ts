import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { homePathFor, navItemsFor } from "@/lib/nav";

// Independently re-derived from 07 §2.2 (not just re-running navItemsFor's own
// logic back at itself) so a wrong permission on a NAV_ITEMS entry is caught.
// Live workspaces (2026-11-06): twin + marketplace need dashboard.view; students needs
// mastery.review (+ mastery module), simulator scenario.manage, studio studio.request.
const VIEW_WORKSPACES = ["/fabric/twin", "/fabric/marketplace"];
const LEADER_WORKSPACES = [...VIEW_WORKSPACES, "/fabric/students", "/fabric/simulator", "/fabric/studio"];
const FABRIC_HREFS = [
  "/fabric/learning", "/fabric/operations", "/fabric/finance-intel", "/fabric/insights",
  "/fabric/agents", "/fabric/data", "/fabric/trust",
];
// Permission-gated links (insight.read / forecast.read / agent.run): staff roles
// without them don't get dead pages. Demo tenant, no module settings.
const NO_FORECAST_AGENT = FABRIC_HREFS.filter((h) => h !== "/fabric/finance-intel" && h !== "/fabric/agents");
const NO_AGENT = FABRIC_HREFS.filter((h) => h !== "/fabric/agents");
// Education OS pages (2026-11-06): lesson plans + class diary (diary.write), question bank
// (question.manage), timetable (timetable.read), parent meetings (ptm.manage or ptm.slot.manage).
// /me (Personal AI) is a placeholder workspace and is no longer linked from the nav.
const EXPECTED_HREFS: Record<Role, string[]> = {
  owner: [
    ...FABRIC_HREFS,
    ...LEADER_WORKSPACES,
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/finance/ledger",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings/modules",
    "/settings/ai",
    "/diary", "/lesson-plans", "/ptm", "/question-bank", "/timetable", "/assistant", "/messages",
  ],
  principal: [
    ...FABRIC_HREFS,
    ...LEADER_WORKSPACES,
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/exams/rechecks",
    "/finance",
    "/finance/ledger",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings/modules",
    "/settings/ai",
    "/diary", "/lesson-plans", "/ptm", "/question-bank", "/timetable", "/assistant", "/messages",
  ],
  admin: [
    ...FABRIC_HREFS,
    ...LEADER_WORKSPACES,
    "/dashboard",
    "/students",
    "/admissions",
    "/attendance",
    "/assignments",
    "/exams",
    "/finance",
    "/finance/ledger",
    "/website",
    "/ai",
    "/ai/usage",
    "/notifications",
    "/jobs",
    "/settings/modules",
    "/settings/ai",
    "/diary", "/lesson-plans", "/ptm", "/timetable", "/assistant", "/messages",
  ],
  admissions: ["/dashboard", "/students", "/admissions", "/website", "/ai", "/notifications", ...NO_FORECAST_AGENT, ...VIEW_WORKSPACES, "/timetable", "/assistant"],
  accountant: ["/dashboard", "/students", "/finance", "/finance/ledger", "/notifications", ...NO_AGENT, ...VIEW_WORKSPACES, "/timetable", "/assistant"],
  // Finance intel needs finance.read (9bb75b9); exam_controller holds forecast.read but not finance.read.
  exam_controller: ["/dashboard", "/students", "/attendance", "/exams", "/exams/rechecks", "/notifications", ...NO_FORECAST_AGENT, ...VIEW_WORKSPACES, "/fabric/students", "/question-bank", "/timetable", "/assistant"],
  teacher: ["/today", "/students", "/attendance", "/assignments", "/exams", "/ai", "/notifications", "/diary", "/lesson-plans", "/ptm", "/question-bank", "/timetable", "/messages"],
  // Portal roles hold read permissions for their own child's data, but the
  // staff module pages aren't built for them — the portal tabs are.
  // They get the portal's own sidebar (formerly PortalNav's tab strip).
  student: [
    "/portal", "/portal/subjects", "/portal/study", "/portal/practice", "/portal/assignments",
    "/portal/results", "/portal/attendance", "/portal/fees", "/portal/notifications",
  ],
  guardian: [
    "/portal", "/portal/attendance", "/portal/results", "/portal/assignments", "/portal/updates",
    "/portal/fees", "/portal/messages", "/portal/meetings", "/portal/assistant", "/portal/leave",
    "/portal/surveys", "/portal/notifications",
  ],
};

describe("navItemsFor", () => {
  for (const role of Object.keys(EXPECTED_HREFS) as Role[]) {
    it(`matches the expected link set for ${role}`, () => {
      const hrefs = navItemsFor(new Set(permissionsFor(role)), undefined, true, role).map((item) => item.href);
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

  it("guardian sidebar has no student-only Study link", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("guardian")), undefined, false, "guardian").map((i) => i.href);
    for (const h of ["/portal/study", "/portal/practice", "/portal/subjects"]) expect(hrefs).not.toContain(h);
  });

  it("student sidebar has no guardian-only Messages link", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("student")), undefined, false, "student").map((i) => i.href);
    for (const h of ["/portal/messages", "/portal/meetings", "/portal/updates", "/portal/assistant", "/portal/leave", "/portal/surveys"]) {
      expect(hrefs).not.toContain(h);
    }
  });

  it("student without ai.study loses Study and Practice", () => {
    const perms = new Set(permissionsFor("student"));
    perms.delete("ai.study");
    const hrefs = navItemsFor(perms, undefined, false, "student").map((i) => i.href);
    expect(hrefs).not.toContain("/portal/study");
    expect(hrefs).not.toContain("/portal/practice");
  });

  it("portal links are only visible to portal users", () => {
    for (const role of ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"] as Role[]) {
      const hrefs = navItemsFor(new Set(permissionsFor(role)), undefined, true, role).map((i) => i.href);
      expect(hrefs.filter((h) => h.startsWith("/portal"))).toEqual([]);
    }
  });

  it("portal modules follow settings (assignments off hides Assignments)", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("guardian")), { modules: { assignments: false } }, false, "guardian").map((i) => i.href);
    expect(hrefs).not.toContain("/portal/assignments");
  });

  it("guardian sees only the Portal-facing links", () => {
    const hrefs = navItemsFor(new Set(permissionsFor("guardian")), undefined, false, "guardian").map((item) => item.href);
    expect(hrefs).toContain("/portal");
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/dashboard");
  });

  it("owner with exams module disabled gets no /exams and no /exams/rechecks", () => {
    const settings = { modules: { exams: false } };
    const hrefs = navItemsFor(new Set(permissionsFor("owner")), settings).map((item) => item.href);
    expect(hrefs).not.toContain("/exams");
    expect(hrefs).not.toContain("/exams/rechecks");
  });

  it("owner with assignments module disabled has no /assignments", () => {
    const settings = { modules: { assignments: false } };
    const hrefs = navItemsFor(new Set(permissionsFor("owner")), settings).map((item) => item.href);
    expect(hrefs).not.toContain("/assignments");
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
