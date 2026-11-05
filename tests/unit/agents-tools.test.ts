import { afterEach, describe, expect, it, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import { getRegisteredActions, type AnyAction } from "@/lib/actions/registry";
import { fail, ok } from "@/lib/actions/result";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { AGENT_SLUGS } from "@/modules/agents/catalog";
import { agentPermissions, buildAgentTools, createProposalSink, toolNameFor } from "@/modules/agents/tools";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const NONCE = "n0nce123";
const TERM = "00000000-0000-4000-8000-000000000001";

function ctxFor(role: Role, settings: Record<string, unknown> = { modules: allModulesOn() }): TenantContext {
  return {
    institution: { id: "inst-1", slug: "tools-test", name: "Tools", settings, ai_policy: "local_only", is_demo: true },
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

afterEach(() => vi.restoreAllMocks());

describe("agent tool builder", () => {
  it("names a registry entry with dots replaced by underscores", () => {
    expect(toolNameFor("finance.reminders.send")).toBe("finance_reminders_send");
  });

  it("finance agent gets its own read and proposal tools and nothing from exams", async () => {
    const { tools, registryNameOf } = await buildAgentTools(ctxFor("owner"), "finance", createProposalSink(), NONCE);
    const names = Object.keys(tools);
    expect(names.some((n) => n.startsWith("exam"))).toBe(false);
    expect(names).toContain("finance_listDefaulters");
    expect(names).toContain("propose_finance_reminders_send");
    expect(registryNameOf.get("finance_listDefaulters")).toBe("finance.listDefaulters");
    expect(registryNameOf.get("propose_finance_reminders_send")).toBe("finance.reminders.send");
  });

  it("does not offer finance_plus tools when that module is off", async () => {
    const ctx = ctxFor("owner", { modules: { ...allModulesOn(), finance_plus: false } });
    const { tools } = await buildAgentTools(ctx, "finance", createProposalSink(), NONCE);
    const names = Object.keys(tools);
    expect(names).not.toContain("finance_collectionReport");
    expect(names).not.toContain("propose_finance_reminders_send");
    expect(names).toContain("finance_listDefaulters");
  });

  it("does not offer a read tool whose permission the caller's role lacks", async () => {
    // teacher holds neither finance.read nor finance.structure.manage
    const { tools } = await buildAgentTools(ctxFor("teacher"), "finance", createProposalSink(), NONCE);
    expect(Object.keys(tools)).toEqual(["propose_finance_reminders_send"]);
  });

  it("every tool for every agent has a valid provider name and an object input schema", async () => {
    for (const slug of AGENT_SLUGS) {
      const { tools } = await buildAgentTools(ctxFor("owner"), slug, createProposalSink(), NONCE);
      expect(Object.keys(tools).length).toBeGreaterThan(0);
      for (const [name, t] of Object.entries(tools)) {
        expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect((await asSchema(t.inputSchema).jsonSchema).type).toBe("object");
      }
    }
  });

  it("a proposal tool records the catalog risk and never calls the action", async () => {
    const sink = createProposalSink();
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", sink, NONCE);
    const action = vi.fn<AnyAction>();
    fakeEntry(getRegisteredActions(), "finance.reminders.send", action);

    await expect(run(tools, "propose_finance_reminders_send", { termId: TERM })).resolves.toBe(
      "Proposed. A person will review it.",
    );
    expect(sink.list()).toEqual([
      { action: "finance.reminders.send", input: { termId: TERM }, risk_class: "human_approved", status: "proposed", error_code: null },
    ]);
    expect(action).not.toHaveBeenCalled();
  });

  it("refuses a 6th proposal and keeps 5", async () => {
    const sink = createProposalSink();
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", sink, NONCE);
    for (let i = 0; i < 5; i++) await run(tools, "propose_finance_reminders_send", { termId: TERM });
    await expect(run(tools, "propose_finance_reminders_send", { termId: TERM })).resolves.toBe("Proposal limit reached.");
    expect(sink.list()).toHaveLength(5);
  });

  it("refuses a proposal whose input JSON exceeds 4,000 chars", async () => {
    const sink = createProposalSink();
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", sink, NONCE);
    await expect(run(tools, "propose_finance_reminders_send", { note: "x".repeat(4_000) })).resolves.toBe("Proposal too large.");
    expect(sink.list()).toHaveLength(0);
    expect(sink.add({ action: "finance.reminders.send", input: { note: "x".repeat(4_000) }, risk_class: "human_approved" })).toBe(false);
  });

  it("a query returning fail becomes a plain string, never a throw", async () => {
    fakeEntry(getRegisteredQueries(), "finance.listDefaulters", async () => fail("forbidden", "nope"));
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", createProposalSink(), NONCE);
    await expect(run(tools, "finance_listDefaulters", { termId: TERM })).resolves.toBe("Query failed: forbidden");
  });

  it("a throwing query becomes Query failed: internal", async () => {
    fakeEntry(getRegisteredQueries(), "finance.listDefaulters", async () => {
      throw new Error("boom");
    });
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", createProposalSink(), NONCE);
    await expect(run(tools, "finance_listDefaulters", { termId: TERM })).resolves.toBe("Query failed: internal");
  });

  it("wraps read results in the nonce tag with at most 4,000 chars of payload", async () => {
    const query = vi.fn<AnyAction>(async () => ok({ rows: "y".repeat(10_000) }));
    fakeEntry(getRegisteredQueries(), "finance.listDefaulters", query);
    const { tools } = await buildAgentTools(ctxFor("owner"), "finance", createProposalSink(), NONCE);
    const out = await run(tools, "finance_listDefaulters", { termId: TERM });

    expect(query).toHaveBeenCalledWith("tools-test", { termId: TERM });
    expect(typeof out).toBe("string");
    const match = /^<data-n0nce123>([\s\S]*)<\/data-n0nce123>$/.exec(out as string);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(4_000);
    expect(match![1].startsWith('{"rows":"yyy')).toBe(true);
  });

  it("agentPermissions lists the sorted unique permissions of catalog tools and actions", async () => {
    const perms = await agentPermissions("finance");
    expect(perms).toEqual([...new Set(perms)].sort());
    expect(perms).toEqual(expect.arrayContaining(["finance.read", "finance.structure.manage", "finance.reminder.send"]));
  });
});
