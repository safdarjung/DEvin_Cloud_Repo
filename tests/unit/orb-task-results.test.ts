// Orb task bridge — view rules and approve results: requireOneOf, the result
// link (a real page, never model text), and attendance status options.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { AI_ROLES } from "@/modules/core/schemas";
import { FIRST_SLICE, TASK_CATALOG } from "@/modules/ai/tasks/catalog";
import { classifiedTask, taskActionMeta } from "@/modules/ai/tasks/classified";
import { actionJsonSchema, schemaFields } from "@/modules/ai/tasks/derive";
import { EXPANDERS } from "@/modules/ai/tasks/expanders";
import { missingOneOf, resultHref } from "@/modules/ai/tasks/proposals";
import { taskState } from "@/modules/ai/tasks/state";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const APP = path.join(process.cwd(), "src/app/(tenant)/[institution]");
const STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

function ctxFor(role: Role): TenantContext {
  const aiRoles = Object.fromEntries(AI_ROLES.map((r) => [r, { enabled: true, modes: { manage: true } }]));
  return {
    institution: {
      id: "i", slug: "demo", name: "Demo", ai_policy: "local_only", is_demo: true,
      settings: { modules: allModulesOn(), ai_roles: aiRoles, attendance: { mode: "daily", correction_window_days: 3, statuses: STATUSES, alert_thresholds: { warn: 80, critical: 75 } } },
    },
    user: { id: "u", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "s", guardianId: "g", studentId: "st" },
    permissions: new Set(permissionsFor(role)),
  };
}

describe("result links", () => {
  it("every first-slice task and undo target links to a page that exists, for every role that has it", () => {
    const actions = Object.keys(TASK_CATALOG).filter((a) => classifiedTask(a));
    expect(actions.length).toBeGreaterThanOrEqual(FIRST_SLICE.length);
    let checked = 0;
    for (const action of actions) {
      for (const role of AI_ROLES) {
        const ctx = ctxFor(role);
        if (!taskState(ctx, action).enabled) continue;
        const href = resultHref(ctx, classifiedTask(action)!);
        expect(href.startsWith("/demo/"), `${action} as ${role}`).toBe(true);
        expect(fs.existsSync(path.join(APP, href.slice("/demo".length), "page.tsx")), `${action} as ${role} → ${href}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("guardians and students stay in the portal", () => {
    expect(resultHref(ctxFor("guardian"), classifiedTask("studentLeave.request")!)).toBe("/demo/portal/leave");
    expect(resultHref(ctxFor("student"), classifiedTask("helpdesk.ticket.raise")!)).toBe("/demo/portal");
    expect(resultHref(ctxFor("principal"), classifiedTask("library.loan.issue")!)).toBe("/demo/library");
  });
});

describe("requireOneOf", () => {
  it("every rule names real top-level fields of the action", () => {
    for (const [action, row] of Object.entries(TASK_CATALOG)) {
      if (row.excluded !== undefined || !row.requireOneOf) continue;
      const paths = new Set(schemaFields(actionJsonSchema(taskActionMeta(action)!)).map((f) => f.path));
      for (const p of row.requireOneOf.flat()) expect(paths.has(p), `${action} ${p}`).toBe(true);
    }
  });

  it("library.loan.issue needs a student or a staff member: an error on both paths when neither is filled", () => {
    const task = classifiedTask("library.loan.issue")!;
    expect(missingOneOf(task, { accessionNo: "LIB-1" })).toEqual({
      "/studentId": ["Fill in the student or staff member."],
      "/staffId": ["Fill in the student or staff member."],
    });
    expect(missingOneOf(task, { accessionNo: "LIB-1", staffId: "x" })).toBeNull();
  });
});

describe("attendance status options", () => {
  it("the register's status is an enum of the school's codes with their labels", () => {
    const patch = EXPANDERS["attendance.mark"]!.fields!(ctxFor("teacher"));
    expect(patch["/records/*/status"]).toEqual({ kind: "enum", options: ["P", "A"], optionLabels: ["Present", "Absent"] });
  });
});
