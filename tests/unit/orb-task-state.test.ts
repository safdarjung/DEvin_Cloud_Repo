// Orb task bridge — taskState lock chain and the env kill switch (design §6).
import { afterEach, describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { UNCLASSIFIED } from "@/modules/ai/tasks/catalog";
import { listEnabledTasks, taskState } from "@/modules/ai/tasks/state";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const ALL_ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];

function ctxFor(role: Role, settings: { modules?: Record<string, boolean>; aiRoles?: Record<string, unknown> } = {}): TenantContext {
  const aiRoles = Object.fromEntries(ALL_ROLES.map((r) => [r, { enabled: true }]));
  return {
    institution: {
      id: "inst-1",
      slug: "orb-state",
      name: "Orb",
      settings: { modules: { ...allModulesOn(), ...settings.modules }, ai_roles: { ...aiRoles, ...settings.aiRoles } },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: "guardian-1", studentId: "student-1" },
    permissions: new Set(permissionsFor(role)),
  };
}

afterEach(() => {
  delete process.env.AI_ORB_TASKS;
});

describe("taskState lock chain", () => {
  it("an excluded action is locked as excluded, whatever the settings say", () => {
    const ctx = ctxFor("owner", { aiRoles: { owner: { enabled: true, tasks: { "core.module.set": true } } } });
    expect(taskState(ctx, "core.module.set")).toMatchObject({ enabled: false, lock: "excluded" });
    expect(taskState(ctx, "ai.proposal.approve")).toMatchObject({ enabled: false, lock: "excluded" });
  });

  it("an unclassified or unknown action is never offered", () => {
    expect(taskState(ctxFor("owner"), UNCLASSIFIED[0]!)).toMatchObject({ enabled: false, lock: "unclassified" });
    expect(taskState(ctxFor("owner"), "no.such.action")).toMatchObject({ enabled: false, lock: "unclassified" });
  });

  it("AI_ORB_TASKS=off turns every task off", () => {
    expect(taskState(ctxFor("owner"), "library.loan.issue").enabled).toBe(true);
    process.env.AI_ORB_TASKS = "off";
    expect(taskState(ctxFor("owner"), "library.loan.issue")).toMatchObject({ enabled: false, lock: "kill_switch" });
    expect(listEnabledTasks(ctxFor("owner"))).toEqual([]);
  });

  it("a role without the action's permission is locked, even with a stored override on", () => {
    const ctx = ctxFor("guardian", { aiRoles: { guardian: { enabled: true, tasks: { "people.leave.approve": true } } } });
    expect(taskState(ctx, "people.leave.approve")).toMatchObject({ enabled: false, lock: "permission" });
  });

  it("the action's module off, or the role's AI module off, locks the task", () => {
    expect(taskState(ctxFor("owner", { modules: { library: false } }), "library.loan.issue")).toMatchObject({ lock: "module" });
    expect(taskState(ctxFor("owner", { modules: { ai_teacher: false } }), "library.loan.issue")).toMatchObject({ lock: "module" });
  });

  it("the role's AI switch off locks it as role_off", () => {
    expect(taskState(ctxFor("owner", { aiRoles: { owner: { enabled: false } } }), "library.loan.issue")).toMatchObject({ lock: "role_off" });
  });

  it("Manage is off by default and a stored mode switch turns it on; a mode switched off locks its tasks", () => {
    expect(taskState(ctxFor("teacher"), "ptm.slots.add")).toMatchObject({ enabled: false, lock: "mode_off" });
    expect(taskState(ctxFor("teacher", { aiRoles: { teacher: { enabled: true, modes: { manage: true } } } }), "ptm.slots.add").enabled).toBe(true);
    expect(taskState(ctxFor("owner", { aiRoles: { owner: { enabled: true, modes: { do: false } } } }), "library.loan.issue")).toMatchObject({ lock: "mode_off" });
  });

  it("a group switched off locks its tasks for that role only", () => {
    const ctx = ctxFor("owner", { aiRoles: { owner: { enabled: true, groups: { operations: false } } } });
    expect(taskState(ctx, "library.loan.issue")).toMatchObject({ enabled: false, lock: "group_off" });
    expect(taskState({ ...ctx, membership: { ...ctx.membership, role: "principal" }, permissions: new Set(permissionsFor("principal")) }, "library.loan.issue").enabled).toBe(true);
  });

  it("a task switched off is task_off; a rule-6 task is off by default until a stored override turns it on", () => {
    expect(taskState(ctxFor("owner", { aiRoles: { owner: { enabled: true, tasks: { "library.loan.issue": false } } } }), "library.loan.issue")).toMatchObject({
      lock: "task_off",
    });
    expect(taskState(ctxFor("accountant"), "expenses.record")).toMatchObject({ enabled: false, lock: "task_off" });
    expect(taskState(ctxFor("accountant", { aiRoles: { accountant: { enabled: true, tasks: { "expenses.record": true } } } }), "expenses.record").enabled).toBe(true);
  });

  it("an override never unlocks a lock above it (module off + task on stays module)", () => {
    const ctx = ctxFor("owner", { modules: { library: false }, aiRoles: { owner: { enabled: true, tasks: { "library.loan.issue": true } } } });
    expect(taskState(ctx, "library.loan.issue").lock).toBe("module");
  });

  it("a malformed settings blob never throws and never widens", () => {
    const ctx = ctxFor("teacher", { aiRoles: { teacher: { enabled: true, modes: "nope", tasks: 7 } } });
    expect(taskState(ctx, "ptm.slots.add")).toMatchObject({ lock: "mode_off" });
  });

  it("takes another role for the control centre view", () => {
    expect(taskState(ctxFor("owner"), "studentLeave.request", "guardian").enabled).toBe(true);
    expect(taskState(ctxFor("owner"), "studentLeave.request").lock).toBe("permission");
  });
});

describe("listEnabledTasks", () => {
  it("lists only tasks that are on for the caller's role", () => {
    const guardian = listEnabledTasks(ctxFor("guardian")).map((t) => t.action);
    expect(guardian).toEqual(expect.arrayContaining(["studentLeave.request", "ptm.booking.create"]));
    expect(guardian).not.toContain("people.leave.approve");
    for (const t of listEnabledTasks(ctxFor("teacher"))) expect(taskState(ctxFor("teacher"), t.action).enabled).toBe(true);
  });
});
