import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { AI_ROLES } from "@/modules/core/schemas";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

// The browser's pure lock chain must agree with the server's taskState on every classified action.
const SETTINGS = [
  {},
  { modules: { library: false, timetable: false } },
  { ai_roles: { teacher: { enabled: false }, principal: { modes: { manage: true, do: false }, groups: { operations: false }, tasks: { "attendance.mark": false } } } },
  { modules: { library: true, ai_teacher: false }, ai_roles: { admin: { modes: { manage: true } } } },
];

describe("control centre lock chain matches taskState", () => {
  let ready: { taskState: typeof import("@/modules/ai/tasks/state").taskState; build: typeof import("@/modules/core/control-centre/model") };
  beforeAll(async () => {
    ready = { taskState: (await import("@/modules/ai/tasks/state")).taskState, build: await import("@/modules/core/control-centre/model") };
  }, 30_000);

  it.each(SETTINGS.map((s, i) => [i, s] as const))("settings #%i", async (_i, settings) => {
    const { actionVerdict } = await import("@/modules/core/control-centre/state");
    const ctx = { institution: { id: "x", slug: "x", name: "x", settings, ai_policy: {}, is_demo: false }, membership: { role: "principal" }, permissions: new Set() } as unknown as TenantContext;
    const model = ready.build.buildCcModel(ctx);
    const cc = ready.build.ccSettings(settings as never);
    const diffs: string[] = [];
    for (const a of model.actions) {
      if (a.kind !== "task") continue;
      for (const role of AI_ROLES as readonly Role[]) {
        const mine = actionVerdict(model, cc, role, a);
        const theirs = ready.taskState(ctx, a.action, role);
        if (mine.on !== theirs.enabled) diffs.push(`${a.action}/${role}: ${mine.lock} vs ${theirs.lock}`);
      }
    }
    expect(diffs.slice(0, 10)).toEqual([]);
  });
});
