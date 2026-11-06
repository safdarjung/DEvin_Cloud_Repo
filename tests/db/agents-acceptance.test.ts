// M22-T11 — agent workforce acceptance over HTTP (route + bearer pattern
// from tests/db/timetable-acceptance.test.ts). The local provider is
// mocked with the `ai/test` MockLanguageModelV4 (T6's own unit-test
// pattern) so the real streamAgent → tools → executeProposals path runs
// end to end; everything else (DB, RLS, registry, usage logging) is real.
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
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { createAcademicYear, createTerm, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const providers = await import("@/lib/ai/providers");

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: "owner" | "principal" | "admin" | "teacher"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
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
      ...calls.map(([toolName, input], i): StreamPart => ({
        type: "tool-call",
        toolCallId: `call-${toolName}-${i}`,
        toolName,
        input: JSON.stringify(input),
      })),
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

function useModel(...steps: StreamResult[]): void {
  vi.mocked(providers.getLocalModel).mockReturnValue(new MockLanguageModelV4({ doStream: steps }));
}

/** Poll the DB until the usage row this run produced lands (streamAgent logs usage off-band, after the stream is drained). */
async function waitForUsageRow(runId: string): Promise<{ feature: string; agent_run_id: string }> {
  for (let i = 0; i < 50; i++) {
    const rows = await sql`select feature, agent_run_id from public.ai_usage_events where agent_run_id = ${runId}::uuid`;
    if (rows.length > 0) return rows[0] as { feature: string; agent_run_id: string };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no ai_usage_events row for run ${runId} after 5s`);
}

// The executor goes to Groq/Gemini when a key is set; these cases drive the mocked local model.
const savedCloudKeys = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
beforeAll(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
});
afterAll(() => {
  Object.assign(process.env, Object.fromEntries(Object.entries(savedCloudKeys).filter(([, v]) => v !== undefined)));
});

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M22-T11 agent workforce acceptance over HTTP", () => {
  it(
    "module gate, run → awaiting_approval, approval gate, approve → done + reminder side effect, " +
      "second approve 4xx, forbidden roles, agents.runs + ai.usageSummary reflect the run",
    async () => {
      const inst = await createTestInstitution("agents-acceptance");
      try {
        const yearId = await createAcademicYear(inst.institutionId);
        const termId = await createTerm(inst.institutionId, yearId);
        await sql`update public.profiles set full_name = 'Principal Priya' where id = ${inst.users.principal.id}`;

        const ownerAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- agents module off: owner is forbidden ---------------------------
        await sql`update public.institutions set settings = jsonb_set(settings, '{modules,agents}', 'false') where id = ${inst.institutionId}`;
        const offRes = await dispatchAction("agent.run", { institution: inst.slug, input: { slug: "finance", task: "Chase fees" } }, ownerAuth);
        expect(offRes.status).toBe(403);
        const offBody = await offRes.json();
        expect(offBody).toMatchObject({ ok: false, error: { code: "forbidden" } });

        // --- agents module on: owner runs the finance agent -------------------
        await sql`update public.institutions set settings = jsonb_set(settings, '{modules,agents}', 'true') where id = ${inst.institutionId}`;
        useModel(
          toolStep(
            ["finance_listDefaulters", { termId }],
            ["exams_listExams", {}],
            ["propose_finance_reminders_send", { termId }],
          ),
          textStep("Three families owe fees; reminders proposed for review."),
        );

        const runRes = await dispatchAction(
          "agent.run",
          { institution: inst.slug, input: { slug: "finance", task: "Chase overdue fees for this term." } },
          ownerAuth,
        );
        expect(runRes.status).toBe(200);
        const runBody = await runRes.json();
        expect(runBody.ok).toBe(true);
        const runId = runBody.data.runId as string;
        expect(runBody.data.status).toBe("awaiting_approval");

        const [runRow] = await sql`select status, risk_class, log from public.agent_runs where id = ${runId}::uuid`;
        expect(runRow.status).toBe("awaiting_approval");
        expect(runRow.risk_class).toBe("human_approved");
        const logTexts = (runRow.log as { text: string }[]).map((e) => e.text);
        expect(logTexts).toContain("Called finance.listDefaulters");
        expect(logTexts).toContain("Unknown tool exams_listExams");

        const jobsBefore = await sql`select count(*)::int as n from public.jobs where institution_id = ${inst.institutionId}::uuid and type = 'finance.fee_reminder'`;
        expect(jobsBefore[0].n).toBe(0);

        // --- admin cannot approve (lacks agent.approve) -----------------------
        const adminApproveRes = await dispatchAction("agent.approve", { institution: inst.slug, input: { runId } }, adminAuth);
        expect(adminApproveRes.status).toBe(403);

        // --- principal approves: run executes, reminder side effect fires -----
        const approveRes = await dispatchAction("agent.approve", { institution: inst.slug, input: { runId } }, principalAuth);
        expect(approveRes.status).toBe(200);
        const approveBody = await approveRes.json();
        expect(approveBody).toMatchObject({ ok: true, data: { status: "done", executed: 1, failed: 0 } });

        const jobsAfter = await sql`select count(*)::int as n from public.jobs where institution_id = ${inst.institutionId}::uuid and type = 'finance.fee_reminder'`;
        expect(jobsAfter[0].n).toBe(1);

        // --- a second approve is a conflict, not a repeat success -------------
        const secondApproveRes = await dispatchAction("agent.approve", { institution: inst.slug, input: { runId } }, principalAuth);
        expect(secondApproveRes.status).toBeGreaterThanOrEqual(400);
        expect(secondApproveRes.status).toBeLessThan(500);

        // --- teacher cannot run an agent at all --------------------------------
        const teacherRunRes = await dispatchAction(
          "agent.run",
          { institution: inst.slug, input: { slug: "finance", task: "x" } },
          teacherAuth,
        );
        expect(teacherRunRes.status).toBe(403);

        // --- agents.runs reflects the decided run ------------------------------
        const runsRes = await dispatchQuery("agents.runs", inst.slug, { slug: "finance" }, ownerAuth);
        expect(runsRes.status).toBe(200);
        const runsBody = await runsRes.json();
        const listedRun = runsBody.data.find((r: { id: string }) => r.id === runId);
        expect(listedRun).toMatchObject({ approver: "Principal Priya", cost_paise: 0 });

        // --- usage: the agent run's own ai_usage_events row ---------------------
        const usageRow = await waitForUsageRow(runId);
        expect(usageRow.feature).toBe("agent.finance");

        const usageSummaryRes = await dispatchQuery("ai.usageSummary", inst.slug, {}, ownerAuth);
        expect(usageSummaryRes.status).toBe(200);
        const usageSummaryBody = await usageSummaryRes.json();
        expect(usageSummaryBody.data.totalRequests).toBeGreaterThanOrEqual(1);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
