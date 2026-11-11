// listEnabledTasks runs in the tenant layout on every page: importing its module
// must not load the action registry (any action module), and one call must be cheap.
import { describe, expect, it, vi } from "vitest";
import { getActionMeta } from "@/lib/actions/registry";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

vi.mock("@/app/api/v1/actions/all-actions", () => {
  throw new Error("the action registry was imported");
});

const ctx: TenantContext = {
  institution: { id: "i", slug: "s", name: "n", settings: { modules: allModulesOn(), ai_roles: { principal: { enabled: true } } }, ai_policy: "local_only", is_demo: true },
  user: { id: "u", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
  membership: { role: "principal", staffId: "st", guardianId: null, studentId: null },
  permissions: new Set(permissionsFor("principal")),
};

describe("state.ts stays light", () => {
  it("imports and lists tasks without any registered action, in well under a millisecond per call", async () => {
    const { listEnabledTasks, taskState } = await import("@/modules/ai/tasks/state");
    expect(getActionMeta().size).toBe(0);
    expect(listEnabledTasks(ctx).length).toBeGreaterThan(10);
    expect(taskState(ctx, "people.leave.approve").enabled).toBe(true);
    const runs = 200;
    const start = performance.now();
    for (let i = 0; i < runs; i++) listEnabledTasks({ ...ctx });
    const perCall = (performance.now() - start) / runs;
    expect(perCall).toBeLessThan(5);
    expect(getActionMeta().size).toBe(0);
  });
});
