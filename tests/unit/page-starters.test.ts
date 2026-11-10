import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { GUARDIAN_NAV, NAV_ITEMS, STUDENT_NAV, type NavItem } from "@/lib/nav";
import { starterPromptsFor } from "@/modules/ai/page-starters";

const STAFF: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"];
const ALL: Role[] = [...STAFF, "student", "guardian"];

const navFor = (role: Role): readonly NavItem[] =>
  role === "student" ? STUDENT_NAV : role === "guardian" ? GUARDIAN_NAV : NAV_ITEMS;

describe("starterPromptsFor", () => {
  it.each(ALL)("%s gets 2-4 prompts for every nav href they hold", (role) => {
    const perms = new Set(permissionsFor(role));
    for (const item of navFor(role).filter((i) => perms.has(i.permission))) {
      const out = starterPromptsFor(item.href, role);
      expect(out.length, `${role} ${item.href}`).toBeGreaterThanOrEqual(2);
      expect(out.length, `${role} ${item.href}`).toBeLessThanOrEqual(4);
    }
  });

  it("guardian and student never receive a staff or teacher prompt", () => {
    const paths = [...NAV_ITEMS, ...STUDENT_NAV, ...GUARDIAN_NAV].map((i) => i.href).concat("/nope");
    const staffOnly = new Set(paths.flatMap((p) => [...STAFF.flatMap((r) => starterPromptsFor(p, r))]));
    for (const role of ["student", "guardian"] as const) {
      for (const p of paths) {
        for (const prompt of starterPromptsFor(p, role)) expect(staffOnly.has(prompt), `${role} ${p}: ${prompt}`).toBe(false);
      }
    }
  });

  it("guardian prompts stay child-scoped and student prompts stay study-scoped", () => {
    for (const p of ["/portal/fees", "/portal/results", "/portal", "/x"]) {
      for (const s of starterPromptsFor(p, "guardian")) expect(s).toMatch(/child|school|notice|leave|fees/i);
      for (const s of starterPromptsFor(p, "student")) expect(s).not.toMatch(/school-wide|enquir|outstanding|section/i);
    }
  });

  it("picks the longest matching page and ignores query and trailing slash", () => {
    expect(starterPromptsFor("/finance/ledger/?x=1", "accountant")).toEqual(starterPromptsFor("/finance", "accountant"));
    expect(starterPromptsFor("/exams/rechecks", "principal")).toEqual(starterPromptsFor("/exams", "principal"));
  });

  it("teacher gets own-class prompts on exams and the default elsewhere", () => {
    expect(starterPromptsFor("/exams", "teacher").join(" ")).toMatch(/I teach/);
    expect(starterPromptsFor("/finance", "teacher")).toEqual(starterPromptsFor("/unknown", "teacher"));
  });

  it("unknown path falls back to a role default", () => {
    for (const role of ALL) expect(starterPromptsFor("/zzz", role).length).toBeGreaterThanOrEqual(2);
  });
});
