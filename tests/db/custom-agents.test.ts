// 0134 — custom agents over HTTP (route + bearer pattern from
// tests/db/agents-acceptance.test.ts). The local model is mocked with
// MockLanguageModelV4 so the real agent.run → executor → scoped tools path
// runs; DB, RLS, grants, guard trigger and registry are all real.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
}));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const providers = await import("@/lib/ai/providers");
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function act(inst: TestInstitution, role: FixtureRole, name: string, input: unknown, institution = inst.slug) {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  const res = await actionsPost(
    new Request(`http://localhost/api/v1/actions/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ institution, input }),
    }),
    { params: Promise.resolve({ name }) },
  );
  return { status: res.status, body: await res.json() };
}

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function toolStep(...calls: Array<[toolName: string, input: unknown]>): StreamResult {
  return {
    stream: convertArrayToReadableStream<StreamPart>([
      { type: "stream-start", warnings: [] },
      ...calls.map(([toolName, input], i): StreamPart => ({ type: "tool-call", toolCallId: `call-${toolName}-${i}`, toolName, input: JSON.stringify(input) })),
      { type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: undefined } },
    ]),
  };
}

function textStep(text: string): StreamResult {
  return {
    stream: convertArrayToReadableStream<StreamPart>([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: text },
      { type: "text-end", id: "t1" },
      { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: "stop" } },
    ]),
  };
}

const CREATE = {
  name: "Fee collection watcher",
  summary: "Reports this term's fee collection totals.",
  instructions: "Only report collection totals. Never suggest reminders.",
  examples: ["How much have we collected this term?"],
  baseSlug: "finance",
  tools: ["finance.termCollectionSummary"],
  actions: [],
};

// The executor goes to Groq/Gemini when a key is set; these cases drive the mocked local model.
const savedCloudKeys = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
let a: TestInstitution;
let b: TestInstitution;
let customId: string;
let customSlug: string;

beforeAll(async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  a = await createTestInstitution("custom-agents-a");
  b = await createTestInstitution("custom-agents-b");
}, 120_000);

afterAll(async () => {
  Object.assign(process.env, Object.fromEntries(Object.entries(savedCloudKeys).filter(([, v]) => v !== undefined)));
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeRolesHelper();
});

describe("custom agents (0134)", () => {
  it("teacher and admin cannot create a custom agent, by action or by direct insert", async () => {
    for (const role of ["teacher", "admin"] as const) {
      const res = await act(a, role, "agent.custom.create", CREATE);
      expect(res.status, role).toBe(403);
      const direct = await a
        .clientAs(role)
        .from("agent_definitions")
        .insert({ institution_id: a.institutionId, base_slug: "finance", name: "x", summary: "x", instructions: "x", examples: [], tools: ["finance.listDefaulters"], actions: [] });
      expect(direct.error?.code, role).toBe("42501");
    }
    const [{ n }] = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${a.institutionId}::uuid and base_slug is not null`;
    expect(n).toBe(0);
  });

  it("principal creates one; the DB stamps slug and creator; a duplicate name is a conflict", async () => {
    const res = await act(a, "principal", "agent.custom.create", CREATE);
    expect(res.body.ok).toBe(true);
    customId = res.body.data.id;
    customSlug = res.body.data.slug;
    expect(customSlug).toMatch(/^custom_[0-9a-f]{32}$/);

    const [row] = await sql`select created_by, base_slug, tools from public.agent_definitions where id = ${customId}::uuid`;
    expect(row).toMatchObject({ created_by: a.users.principal.id, base_slug: "finance", tools: ["finance.termCollectionSummary"] });
    const audit = await sql`select count(*)::int as n from public.audit_events where entity_id = ${customId}::uuid and action = 'agent.custom.create'`;
    expect(audit[0].n).toBe(1);

    const dup = await act(a, "principal", "agent.custom.create", { ...CREATE, name: "fee collection WATCHER" });
    expect(dup.body.error).toMatchObject({ code: "conflict" });
  });

  it("admin of school A cannot read or modify school B's custom agent", async () => {
    const created = await act(b, "principal", "agent.custom.create", CREATE);
    expect(created.body.ok).toBe(true);
    const bId = created.body.data.id as string;

    // A's admin can read A's own custom agent (runs need it), never B's.
    const own = await a.clientAs("admin").from("agent_definitions").select("id").eq("id", customId);
    expect(own.data).toHaveLength(1);
    for (const role of ["admin", "principal"] as const) {
      const read = await a.clientAs(role).from("agent_definitions").select("id").eq("id", bId);
      expect(read.data, role).toEqual([]);
      const update = await a.clientAs(role).from("agent_definitions").update({ instructions: "hijack" }).eq("id", bId).select("id");
      expect(update.data ?? [], role).toHaveLength(0);
    }

    // Through the action: under A's slug B's row is invisible; under B's slug A's user is no member.
    const viaA = await act(a, "principal", "agent.custom.update", { ...CREATE, id: bId, instructions: "hijack" });
    expect(viaA.body.error).toMatchObject({ code: "not_found" });
    const viaB = await act(a, "principal", "agent.custom.archive", { id: bId }, b.slug);
    expect(viaB.body.ok).toBe(false);

    const [row] = await sql`select instructions, archived_at from public.agent_definitions where id = ${bId}::uuid`;
    expect(row).toMatchObject({ instructions: CREATE.instructions, archived_at: null });
  });

  it("rejects a tool outside the base agent on write", async () => {
    const res = await act(a, "principal", "agent.custom.update", { ...CREATE, id: customId, tools: ["finance.termCollectionSummary", "exams.listExams"] });
    expect(res.body.error).toMatchObject({ code: "validation_failed" });
    expect(res.body.error.fieldErrors).toHaveProperty("tools");
  });

  it("a custom agent run cannot use a tool or action outside its subset, even after a direct DB widening", async () => {
    // Simulate a stored row that skipped the Zod subset check: names outside the finance base.
    await sql`update public.agent_definitions set tools = tools || array['exams.listExams'], actions = array['library.loan.renew'] where id = ${customId}::uuid`;

    const model = new MockLanguageModelV4({
      doStream: [
        toolStep(
          ["finance_termCollectionSummary", {}],
          ["finance_listDefaulters", {}],
          ["exams_listExams", {}],
          ["propose_finance_reminders_send", {}],
          ["propose_library_loan_renew", {}],
        ),
        textStep("Collection is on track."),
      ],
    });
    vi.mocked(providers.getLocalModel).mockReturnValue(model);

    const res = await act(a, "owner", "agent.run", { slug: customSlug, task: "How much have we collected this term?" });
    expect(res.body).toMatchObject({ ok: true, data: { status: "done" } });

    const [run] = await sql`select agent_id, risk_class, proposals, log from public.agent_runs where id = ${res.body.data.runId}::uuid`;
    expect(run.agent_id).toBe(customId);
    expect(run.risk_class).toBe("read_only");
    expect(run.proposals).toEqual([]);
    const logTexts = (run.log as { text: string }[]).map((e) => e.text);
    expect(logTexts).toContain("Called finance.termCollectionSummary");
    expect(logTexts).toContain("Unknown tool finance_listDefaulters"); // in the base, not in the subset
    expect(logTexts).toContain("Unknown tool exams_listExams"); // stored, but outside the base
    expect(logTexts).toContain("Unknown tool propose_finance_reminders_send"); // base action, not in the subset
    expect(logTexts).toContain("Unknown tool propose_library_loan_renew"); // stored, but outside the base
    const jobs = await sql`select count(*)::int as n from public.jobs where institution_id = ${a.institutionId}::uuid and type = 'finance.fee_reminder'`;
    expect(jobs[0].n).toBe(0);

    // Instructions reach the model as delimited tenant config, after the rules.
    const prompt = model.doStreamCalls[0].prompt as Array<{ role: string; content: unknown }>;
    const system = String(prompt.find((m) => m.role === "system")?.content);
    expect(system).toMatch(/<school-config-[0-9a-f]{32}>Only report collection totals\. Never suggest reminders\.<\/school-config-[0-9a-f]{32}>/);
    expect(system.indexOf("<school-config-")).toBeGreaterThan(system.indexOf("Rules:"));
  });

  it("a custom agent is off while its base agent is off, and gone once deleted", async () => {
    await sql`update public.agent_definitions set is_enabled = false where institution_id = ${a.institutionId}::uuid and slug = 'finance'`;
    const off = await act(a, "owner", "agent.run", { slug: customSlug, task: "x" });
    expect(off.body.error).toMatchObject({ code: "invalid_state" });
    await sql`update public.agent_definitions set is_enabled = true where institution_id = ${a.institutionId}::uuid and slug = 'finance'`;

    const archived = await act(a, "principal", "agent.custom.archive", { id: customId });
    expect(archived.body.ok).toBe(true);
    const gone = await act(a, "owner", "agent.run", { slug: customSlug, task: "x" });
    expect(gone.body.error).toMatchObject({ code: "not_found" });

    // Archived rows are frozen, even for a direct write.
    const revive = await a.clientAs("principal").from("agent_definitions").update({ archived_at: null }).eq("id", customId);
    expect(revive.error?.message).toBe("code:invalid_state");
  });
});
