import { afterEach, describe, expect, it, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import type { Action } from "@/lib/actions/define-action";
import { getQueryMeta, getRegisteredQueries } from "@/lib/actions/define-query";
import { getRegisteredActions, type AnyAction } from "@/lib/actions/registry";
import { fail, ok } from "@/lib/actions/result";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn, MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { navItemsFor } from "@/lib/nav";
import { queriesFor } from "@/modules/ai/assistant/catalog";
import { buildAssistantTools } from "@/modules/ai/assistant/tools";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const NONCE = "n0nce123";
const SLUG = "assistant-test";
const INSIGHT = "00000000-0000-4000-8000-000000000001";
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function ctxFor(role: Role, modules: Record<string, boolean> = {}): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: SLUG,
      name: "Assistant",
      settings: { modules: { ...allModulesOn(), ...modules } },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

function run(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  const t = tools[name];
  if (!t?.execute) throw new Error(`no tool ${name}`);
  return Promise.resolve(t.execute(input as never, { toolCallId: "call-1", messages: [], context: {} as never }));
}

/** Swap one registry entry for a fake via a spy on the shared Map's get (restored after each test). */
function fakeEntry(map: ReadonlyMap<string, AnyAction>, name: string, fake: AnyAction): void {
  const realGet = Map.prototype.get;
  vi.spyOn(map as Map<string, AnyAction>, "get").mockImplementation(function (this: Map<string, AnyAction>, key: string) {
    return key === name ? fake : realGet.call(this, key);
  });
}

const DRAFT = {
  insightId: INSIGHT,
  action: "Call parents of the five students below 75%",
  owner: "Class teacher 7A",
  rationale: "Attendance in 7A fell for three weeks in a row.",
  expectedOutcome: "7A attendance back above 85% by month end.",
};

afterEach(() => vi.restoreAllMocks());

describe("assistant tool set", () => {
  it("owner on local gets personal and aggregate reads, navigate and createTask", async () => {
    const { tools } = await buildAssistantTools(ctxFor("owner"), NONCE);
    const names = Object.keys(tools);
    expect(names).toEqual(
      expect.arrayContaining(["people_listStudents", "finance_listDefaulters", "navigate", "createTask"]),
    );
  });

  it("teacher gets no finance read tool and no createTask", async () => {
    const { tools } = await buildAssistantTools(ctxFor("teacher"), NONCE);
    const names = Object.keys(tools);
    expect(names.some((n) => n.startsWith("finance_"))).toBe(false);
    expect(names).not.toContain("createTask");
  });

  it("mastery off: no mastery_ tool, and any registered mastery query refuses when called directly", async () => {
    const ctx = ctxFor("owner", { mastery: false });
    const { tools } = await buildAssistantTools(ctx, NONCE);
    expect(Object.keys(tools).some((n) => n.startsWith("mastery_"))).toBe(false);

    for (const name of Object.keys(queriesFor()).filter((n) => n.startsWith("mastery."))) {
      const query = getRegisteredQueries().get(name) as Action<unknown> | undefined;
      if (!query) continue; // M20 queries not merged in every lane; the tool filter above still holds
      await expect(query(SLUG, {}, ctx)).resolves.toEqual({
        ok: false,
        error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE },
      });
    }
  });

  it("insights off: no createTask, no insights_ tool, and insights.riskIndicators refuses when called directly", async () => {
    const ctx = ctxFor("owner", { insights: false });
    const { tools } = await buildAssistantTools(ctx, NONCE);
    const names = Object.keys(tools);
    expect(names).not.toContain("createTask");
    expect(names.some((n) => n.startsWith("insights_"))).toBe(false);

    expect(getQueryMeta().get("insights.riskIndicators")?.module).toBe("insights");
    const query = getRegisteredQueries().get("insights.riskIndicators") as Action<unknown>;
    await expect(query(SLUG, {}, ctx)).resolves.toEqual({
      ok: false,
      error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE },
    });
  });

  it("navigate offers exactly the caller's non-Fabric nav hrefs and returns a tenant link", async () => {
    const ctx = ctxFor("owner");
    const { tools } = await buildAssistantTools(ctx, NONCE);
    const expected = navItemsFor(ctx.permissions, ctx.institution.settings)
      .filter((i) => i.group !== "Fabric")
      .map((i) => i.href);
    expect(expected.length).toBeGreaterThan(0);

    const schema = asSchema(tools.navigate.inputSchema);
    const json = (await schema.jsonSchema) as { properties: { href: { enum: string[] } } };
    expect(json.properties.href.enum).toEqual(expected);
    expect((await schema.validate!({ href: "/fabric/twin" })).success).toBe(false);
    expect((await schema.validate!({ href: "javascript:alert(1)" })).success).toBe(false);

    const out = (await run(tools, "navigate", { href: "/finance" })) as { href: string; label: string };
    expect(out).toEqual({ href: `/${SLUG}/finance`, label: "Finance" });
    expect(out.href.startsWith(`/${SLUG}/`)).toBe(true);
  });

  it("navigate is not offered when the caller has no nav item", async () => {
    const ctx = { ...ctxFor("owner"), permissions: new Set<never>() };
    const { tools } = await buildAssistantTools(ctx, NONCE);
    expect(Object.keys(tools)).not.toContain("navigate");
  });

  it("createTask returns a planned draft and never calls insight.action", async () => {
    const action = vi.fn<AnyAction>();
    fakeEntry(getRegisteredActions(), "insight.action", action);
    const { tools } = await buildAssistantTools(ctxFor("owner"), NONCE);

    await expect(run(tools, "createTask", DRAFT)).resolves.toEqual({
      kind: "task_draft",
      action: "insight.action",
      input: { ...DRAFT, status: "planned" },
      note: "Draft only. Review it and press Save to record it.",
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("createTask names the invalid fields instead of drafting", async () => {
    const { tools } = await buildAssistantTools(ctxFor("owner"), NONCE);
    await expect(run(tools, "createTask", { ...DRAFT, action: "" })).resolves.toBe("Task draft invalid: action");
    await expect(run(tools, "createTask", { ...DRAFT, action: "  ", owner: "" })).resolves.toBe(
      "Task draft invalid: action, owner",
    );
  });

  it("logs an ok read as a source and a failed read not at all", async () => {
    fakeEntry(getRegisteredQueries(), "attendance.sectionsBelowThreshold", async () => ok({ rows: [] }));
    const okSet = await buildAssistantTools(ctxFor("owner"), NONCE);
    await run(okSet.tools, "attendance_sectionsBelowThreshold", { threshold: 75 });
    expect(okSet.sources.list()).toEqual([{ query: "attendance.sectionsBelowThreshold", params: { threshold: 75 } }]);

    vi.restoreAllMocks();
    fakeEntry(getRegisteredQueries(), "attendance.sectionsBelowThreshold", async () => fail("forbidden", "nope"));
    const failSet = await buildAssistantTools(ctxFor("owner"), NONCE);
    await expect(run(failSet.tools, "attendance_sectionsBelowThreshold", { threshold: 75 })).resolves.toBe(
      "Query failed: forbidden",
    );
    await run(failSet.tools, "navigate", { href: "/finance" });
    await run(failSet.tools, "createTask", DRAFT);
    expect(failSet.sources.list()).toEqual([]);
  });

  it("every tool name is a valid provider tool name for every role and provider", async () => {
    for (const role of ["owner", "principal", "admin", "admissions", "teacher"] as const) {
      const { tools } = await buildAssistantTools(ctxFor(role), NONCE);
      for (const name of Object.keys(tools)) expect(name).toMatch(TOOL_NAME);
    }
  });
});
