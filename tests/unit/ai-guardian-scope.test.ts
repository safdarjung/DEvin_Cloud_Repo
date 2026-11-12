// features-18 §E — a guardian's AI reaches the new modules only for their own
// child: the kernel (handleAiChat) refuses a studentId that is not theirs and
// re-binds every studentId-taking read tool to the verified child, whatever
// the model sends. Real registry, real buildReadTools; only the tenant
// context, the child list, the model and one query handler are faked.
import { afterEach, describe, expect, it, vi } from "vitest";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

const CHILD_A = "00000000-0000-4000-8000-00000000000a";
const CHILD_B = "00000000-0000-4000-8000-00000000000b";

const getTenantContextMock = vi.fn();
const streamChatMock = vi.fn();
const listMyChildrenMock = vi.fn(async () => [{ id: CHILD_A }]);

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: (...a: unknown[]) => getTenantContextMock(...a) }));
vi.mock("@/lib/ai/gateway", () => ({ streamChat: (...a: unknown[]) => streamChatMock(...a) }));
vi.mock("@/modules/people/queries", async () => ({
  ...(await vi.importActual<typeof import("@/modules/people/queries")>("@/modules/people/queries")),
  listMyChildren: () => listMyChildrenMock(),
}));

vi.mock("@/modules/ai/agent/student-tools", () => ({ studentTools: async () => ({}) }));
vi.mock("@/modules/ai/student-preferences", () => ({ getStudentPreferences: async () => undefined }));

const { handleAiChat } = await import("@/modules/ai/kernel/handle-chat");
const { getRegisteredQueries } = await import("@/lib/actions/define-query");
await import("@/app/api/v1/query/all-queries");

function guardianCtx(): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "demo",
      name: "Demo",
      settings: { modules: allModulesOn(), ai_roles: { guardian: { enabled: true } } },
      ai_policy: "local_only",
      is_demo: false,
    },
    user: { id: "user-1", profile: { fullName: "Parent", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "guardian", staffId: null, guardianId: "guardian-1", studentId: null },
    permissions: new Set(permissionsFor("guardian")),
  };
}

function chat(studentId: string): Request {
  return new Request("http://localhost/api/ai/agent/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ institutionSlug: "demo", studentId, messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Any achievements?" }] }] }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("guardian AI — own child only", () => {
  it("a student who is not their child is refused before any tool is built or model called", async () => {
    getTenantContextMock.mockResolvedValue(guardianCtx());
    const res = await handleAiChat(chat(CHILD_B));
    expect((await res.json()).error.code).toBe("forbidden");
    expect(streamChatMock).not.toHaveBeenCalled();
  });

  it("gets the new own-data tools, no staff-wide ones, and every studentId is pinned to the verified child", async () => {
    getTenantContextMock.mockResolvedValue(guardianCtx());
    streamChatMock.mockResolvedValue({ ok: false, error: { code: "ai_unavailable", message: "stop" } });
    const seen: unknown[] = [];
    const fake = vi.fn(async (_slug: string, input: unknown) => {
      seen.push(input);
      return { ok: true, data: [] };
    });
    const registry = getRegisteredQueries() as Map<string, unknown>;
    const realGet = Map.prototype.get;
    vi.spyOn(registry, "get").mockImplementation(function (this: Map<string, unknown>, key: string) {
      return key === "achievements.portfolio" ? fake : realGet.call(this, key);
    });

    await handleAiChat(chat(CHILD_A));
    const tools = streamChatMock.mock.calls[0]![0].tools as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>;
    const names = Object.keys(tools);

    for (const t of ["achievements_portfolio", "resources_forStudent", "library_myLoans", "form_mine", "helpdesk_myTickets", "safety_alerts"]) expect(names).toContain(t);
    for (const t of ["helpdesk_tickets", "clubs_members", "achievements_list", "canteen_statement", "health_profile", "behaviour_incidents", "schoolLabs_labs"]) {
      expect(names).not.toContain(t);
    }

    await tools.achievements_portfolio!.execute({ studentId: CHILD_B }, { toolCallId: "c1", messages: [] });
    expect(seen).toEqual([{ studentId: CHILD_A }]);
  });
});

describe("own-record tools need no id from the model", () => {
  function studentCtx(): TenantContext {
    const ctx = guardianCtx();
    return {
      ...ctx,
      institution: { ...ctx.institution, settings: { modules: allModulesOn(), ai_roles: { student: { enabled: true } } } },
      membership: { role: "student", staffId: null, guardianId: null, studentId: CHILD_A },
      permissions: new Set(permissionsFor("student")),
    };
  }

  async function toolsFor(ctx: TenantContext, body: Request, query: string, seen: unknown[]) {
    getTenantContextMock.mockResolvedValue(ctx);
    streamChatMock.mockResolvedValue({ ok: false, error: { code: "ai_unavailable", message: "stop" } });
    const registry = getRegisteredQueries() as Map<string, unknown>;
    const realGet = Map.prototype.get;
    vi.spyOn(registry, "get").mockImplementation(function (this: Map<string, unknown>, key: string) {
      return key === query ? async (_slug: string, input: unknown) => (seen.push(input), { ok: true, data: [] }) : realGet.call(this, key);
    });
    await handleAiChat(body);
    return streamChatMock.mock.calls[0]![0].tools as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>;
  }

  it("a student's weak-area tool runs on their own record when the model sends no id or a made-up one", async () => {
    const seen: unknown[] = [];
    const req = new Request("http://localhost/api/ai/agent/student", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ institutionSlug: "demo", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Make a one-week study plan for my weakest units." }] }] }),
    });
    const tools = await toolsFor(studentCtx(), req, "mastery.gapsForStudent", seen);
    await tools.mastery_gapsForStudent!.execute({}, { toolCallId: "c1", messages: [] });
    await tools.mastery_gapsForStudent!.execute({ studentId: "00000000-0000-0000-0000-000000000000" }, { toolCallId: "c2", messages: [] });
    expect(seen).toEqual([{ studentId: CHILD_A }, { studentId: CHILD_A }]);
  });

  it("a guardian's child tool called with no id gets the verified child", async () => {
    const seen: unknown[] = [];
    const tools = await toolsFor(guardianCtx(), chat(CHILD_A), "achievements.portfolio", seen);
    await tools.achievements_portfolio!.execute({}, { toolCallId: "c1", messages: [] });
    expect(seen).toEqual([{ studentId: CHILD_A }]);
  });
});
