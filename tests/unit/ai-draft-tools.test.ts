// P1 (ai-roles phase 3) — src/modules/ai/kernel/draft-tools.ts: a
// capability's `drafts` action becomes a `draft_<action>` tool that only
// ever returns a draft for a person to review and save (rule 6). Uses a
// fixture capability (not added to the real catalog — P3's job) so this
// test doesn't depend on any capability existing yet.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import { getRegisteredActions, type AnyAction } from "@/lib/actions/registry";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";
import { buildDraftTools, type DraftableCapability } from "@/modules/ai/kernel/draft-tools";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

function ctxFor(role: Role, settings: Record<string, unknown> = { modules: allModulesOn() }): TenantContext {
  return {
    institution: { id: "inst-1", slug: "draft-test", name: "Draft", settings, ai_policy: "local_only", is_demo: true },
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

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const TEACHER_ID = "00000000-0000-4000-8000-000000000002";
const VALID_START_THREAD = { studentId: STUDENT_ID, counterpartId: TEACHER_ID, subject: "Homework", body: "Please see attached." };

const FIXTURE: DraftableCapability = { description: "Draft a parent message", drafts: ["messaging.startThread"] };

afterEach(() => vi.restoreAllMocks());

describe("buildDraftTools", () => {
  it("names the tool draft_<action with . -> _> and returns an action_draft, never the registered action's result", async () => {
    const registry = getRegisteredActions();
    const getSpy = vi.spyOn(registry as Map<string, AnyAction>, "get");

    const tools = await buildDraftTools(ctxFor("teacher"), [FIXTURE]);
    expect(Object.keys(tools)).toEqual(["draft_messaging_startThread"]);

    const out = await run(tools, "draft_messaging_startThread", VALID_START_THREAD);
    expect(out).toEqual({ kind: "action_draft", action: "messaging.startThread", input: VALID_START_THREAD, summary: "Draft a parent message" });
    // The registered action is never fetched to run — only schema.safeParse runs.
    expect(getSpy.mock.calls.some(([key]) => key === "messaging.startThread")).toBe(false);
  });

  it("invalid input returns plain error text instead of a draft, and never throws", async () => {
    const tools = await buildDraftTools(ctxFor("teacher"), [FIXTURE]);
    const out = await run(tools, "draft_messaging_startThread", { subject: "Missing required fields" });
    expect(typeof out).toBe("string");
    expect(out as string).toMatch(/^Invalid input:/);
  });

  it("a caller lacking the action's permission gets no tool at all", async () => {
    // accountant holds neither message.send nor any messaging permission.
    const tools = await buildDraftTools(ctxFor("accountant"), [FIXTURE]);
    expect(tools).toEqual({});
  });

  it("a capability naming an action outside DRAFTABLE_ACTIONS gets no tool for it", async () => {
    const outsideAllowList: DraftableCapability = { description: "Not allowed", drafts: ["finance.payment.record"] };
    const tools = await buildDraftTools(ctxFor("owner"), [outsideAllowList]);
    expect(tools).toEqual({});
  });
});

describe("DRAFTABLE_ACTIONS allow-list", () => {
  const forbidden = [
    /studentLeave\.(approve|reject)/i,
    /people\.leave\.(approve|reject)/i,
    /exam.*marks/i,
    /finance\.payment/i,
    /\.role/i,
    /membership/i,
    /access/i,
  ];

  it("never names an action that writes marks, payments, access, or a leave/welfare decision", () => {
    for (const action of DRAFTABLE_ACTIONS) {
      for (const pattern of forbidden) expect(action).not.toMatch(pattern);
    }
  });
});
