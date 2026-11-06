// M24-T7 — acceptance for `POST /api/ai/agent/assistant` (T6) + its tool
// set (T5) against a real Supabase instance: real RLS decides what a tool
// result contains, not a mocked Supabase client. Same real-route technique
// as `tests/db/quiz-route.test.ts` (`@/lib/supabase/server` mocked to a
// real signed-in client per role via `setActingClient`) combined with the
// scripted-model technique from `tests/unit/agents-executor.test.ts`
// (`MockLanguageModelV4` via a mocked `@/lib/ai/providers`) and the
// teacher/teacher RLS-isolation fixture from
// `tests/db/teacher-agent-attendance-scope.test.ts`. Only `@/lib/supabase/
// server` and `@/lib/ai/providers` are mocked; `streamAgent`,
// `buildAssistantTools`, `checkLimits`/`logUsage` and every registered
// query run for real, so a real `ai_usage_events` row and real RLS
// isolation are what prove the acceptance, not a stub.
//
// `mastery.heatmapBySection` is in the M24 catalog (`assistant/catalog.ts`)
// but M20's `mastery` queries are not merged into this worktree lane (see
// `.superpowers/sdd/M24-tasks/task-5-report.md`, "mastery gap"): the
// registry has no such entry here, so `buildReadTools` would silently drop
// it (never substituted, by design). The mastery scenario below fakes one
// registry/meta entry (same `Map.prototype.get` spy technique as
// `fakeEntry` in `agents-executor.test.ts`) so the *tool-eligibility and
// sources-logging* path T5/T6 own is still exercised end to end; it does
// not exercise M20's real SQL (there is none in this lane to exercise).
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";
import { ok } from "@/lib/actions/result";
import type { ActionMeta, AnyAction } from "@/lib/actions/registry";
import { getQueryMeta, getRegisteredQueries } from "@/lib/actions/define-query";
import { HeatmapQuerySchema } from "@/modules/mastery/schemas";
import { listDefaultersQuery } from "@/modules/finance/query-defs";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
}));

import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { setActingClient } from "../helpers/server-client-mock";
import { buildAssistantTools } from "@/modules/ai/assistant/tools";

const providers = await import("@/lib/ai/providers");
const { POST } = await import("@/app/api/ai/agent/assistant/route");

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeActionsHelper();
  await closeRolesHelper();
});

// The route goes cloud whenever a Gemini/Groq key is set (owner decision 2026-11-02); these
// acceptance cases drive the mocked local model, so run them keyless.
const savedCloudKeys = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GROQ_API_KEY: process.env.GROQ_API_KEY };
beforeAll(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
});
afterAll(() => {
  Object.assign(process.env, Object.fromEntries(Object.entries(savedCloudKeys).filter(([, v]) => v !== undefined)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

function scriptModel(...steps: StreamResult[]): void {
  vi.mocked(providers.getLocalModel).mockReturnValue(new MockLanguageModelV4({ doStream: steps }));
}

/** Same spy-on-the-shared-Map technique as `fakeEntry` in agents-executor.test.ts — restored by the global `afterEach`. */
function fakeMapEntry<V>(map: ReadonlyMap<string, V>, key: string, fake: V): void {
  const realGet = Map.prototype.get;
  vi.spyOn(map as Map<string, V>, "get").mockImplementation(function (this: Map<string, V>, k: string) {
    return k === key ? fake : realGet.call(this, k);
  });
}

function assistantRequest(institutionSlug: string, text: string): Request {
  return new Request("http://localhost/api/ai/agent/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      institutionSlug,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
    }),
  });
}

/** Parses the `data: ...` SSE lines `toUIMessageStreamResponse` emits (ai's `JsonToSseTransformStream`). */
async function streamChunks(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function toolOutputs(chunks: Array<Record<string, unknown>>): string[] {
  return chunks.filter((c) => c.type === "tool-output-available").map((c) => String(c.output));
}

function finishMetadata(chunks: Array<Record<string, unknown>>): unknown {
  return chunks.find((c) => c.type === "finish")?.messageMetadata;
}

async function waitForUsageRows(institutionId: string, feature: string, timeoutMs = 5000): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await sql`
      select id from public.ai_usage_events where institution_id = ${institutionId} and feature = ${feature}
    `;
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function todayInKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

async function createStudent(institutionId: string, admissionNo: string, firstName = "Test Student"): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, ${firstName}, '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** A second real teacher login (createTestInstitution only provisions one of each role) — copied from teacher-agent-attendance-scope.test.ts. */
async function createSecondTeacher(institutionId: string): Promise<{ userId: string; staffId: string; client: SupabaseClient }> {
  const password = "correct-horse-battery-staple";
  const email = `test-second-teacher-${crypto.randomUUID()}@test.coolskool.test`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("failed to create second teacher");

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Test teacher B', 'teacher')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${institutionId}, ${data.user.id}, 'teacher', ${staff.id})
  `;

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { userId: data.user.id, staffId: staff.id as string, client };
}

async function setAttendanceSettings(institutionId: string): Promise<void> {
  const statuses = [
    { code: "P", label: "Present", counts_present: 1, in_denominator: true },
    { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
  ];
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 3,
        'statuses', ${sql.json(statuses)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

describe("POST /api/ai/agent/assistant — acceptance under real RLS (M24-T7)", () => {
  it("principal: attendance threshold question returns the below-threshold section, with sources + a real usage row", async () => {
    const inst: TestInstitution = await createTestInstitution("assistant-acceptance-attendance");
    try {
      await setAttendanceSettings(inst.institutionId);
      const year = await createAcademicYear(inst.institutionId);
      const grade = await createGrade(inst.institutionId);
      const sectionX = await createClassSection(inst.institutionId, grade, year, { name: "X" });
      const studentOne = await createStudent(inst.institutionId, "ADM-AA-1");
      const studentTwo = await createStudent(inst.institutionId, "ADM-AA-2");
      await createEnrolment(inst.institutionId, studentOne, sectionX, year);
      await createEnrolment(inst.institutionId, studentTwo, sectionX, year);
      const session = await createAttendanceSession(inst.institutionId, sectionX, { date: todayInKolkata() });
      await createAttendanceRecord(inst.institutionId, session, studentOne, { status: "A" });
      await createAttendanceRecord(inst.institutionId, session, studentTwo, { status: "A" });

      setActingClient(inst.clientAs("principal") as unknown as SupabaseClient<Database>);
      scriptModel(
        toolStep(["attendance_sectionsBelowThreshold", {}]),
        textStep("Section VI-X is below the attendance threshold."),
      );

      const res = await POST(assistantRequest(inst.slug, "Which classes are below the attendance threshold?"));
      expect(res.status).toBe(200);

      const chunks = await streamChunks(res);
      expect(toolOutputs(chunks).some((o) => o.includes("VI-X"))).toBe(true);
      expect(finishMetadata(chunks)).toEqual({
        provider: "local",
        catalogVersion: "assistant_v1",
        sources: [{ query: "attendance.sectionsBelowThreshold", params: {} }],
      });

      const usageRows = await waitForUsageRows(inst.institutionId, "assistant");
      expect(usageRows.length).toBeGreaterThan(0);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("principal: mastery question cites mastery.heatmapBySection in sources (tool-eligibility path, M20 not in this lane)", async () => {
    const inst: TestInstitution = await createTestInstitution("assistant-acceptance-mastery");
    try {
      fakeMapEntry(getRegisteredQueries(), "mastery.heatmapBySection", (async () => ok({ rows: [] })) as AnyAction);
      fakeMapEntry(getQueryMeta(), "mastery.heatmapBySection", {
        schema: HeatmapQuerySchema,
        permission: "mastery.read",
        module: "mastery",
      } as ActionMeta);

      setActingClient(inst.clientAs("principal") as unknown as SupabaseClient<Database>);
      scriptModel(
        toolStep(["mastery_heatmapBySection", {}]),
        textStep("No section stands out as weak in maths right now."),
      );

      const res = await POST(assistantRequest(inst.slug, "Which classes have the weakest maths mastery?"));
      expect(res.status).toBe(200);

      const chunks = await streamChunks(res);
      expect(finishMetadata(chunks)).toEqual({
        provider: "local",
        catalogVersion: "assistant_v1",
        sources: [{ query: "mastery.heatmapBySection", params: {} }],
      });
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher: no finance_* tool is offered, a scripted finance_listDefaulters call leaks nothing, and the registered query is forbidden direct", async () => {
    const inst: TestInstitution = await createTestInstitution("assistant-acceptance-teacher-finance");
    try {
      const ctxA = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);

      const { tools } = await buildAssistantTools(ctxA, "local", crypto.randomUUID());
      expect(Object.keys(tools).some((name) => name.startsWith("finance_"))).toBe(false);

      scriptModel(toolStep(["finance_listDefaulters", {}]), textStep("I don't have that information."));
      const res = await POST(assistantRequest(inst.slug, "Who owes fees?"));
      expect(res.status).toBe(200);

      const chunks = await streamChunks(res);
      expect(toolOutputs(chunks).join(" ")).not.toMatch(/defaulter|outstanding fee/i);
      expect(finishMetadata(chunks)).toMatchObject({ sources: [] });

      const direct = await callAs(inst, "teacher", listDefaultersQuery, { termId: crypto.randomUUID() });
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(direct.error.code).toBe("forbidden");
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher A: a section-B attendance-patterns call never surfaces section B's student (RLS), as in the teacher-agent isolation test", async () => {
    const inst: TestInstitution = await createTestInstitution("assistant-acceptance-teacher-scope");
    let teacherB: { userId: string; staffId: string; client: SupabaseClient } | undefined;
    try {
      const year = await createAcademicYear(inst.institutionId);
      const term = await createTerm(inst.institutionId, year);
      const grade = await createGrade(inst.institutionId);
      teacherB = await createSecondTeacher(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, grade, year, { name: "B", classTeacherId: teacherB.staffId });
      const studentY = await createStudent(inst.institutionId, "ADM-SCOPE-Y", "SecretStudentY");
      await createEnrolment(inst.institutionId, studentY, sectionB, year);

      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      scriptModel(
        toolStep(["attendance_getSectionAttendancePatterns", { classSectionId: sectionB, termId: term }]),
        textStep("I don't see any students for that section."),
      );

      const res = await POST(assistantRequest(inst.slug, "Show me attendance patterns for section B."));
      expect(res.status).toBe(200);

      const chunks = await streamChunks(res);
      expect(toolOutputs(chunks).join(" ")).not.toContain("SecretStudentY");
    } finally {
      setActingClient(null);
      if (teacherB) {
        await teacherB.client.auth.signOut();
        const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
        await admin.auth.admin.deleteUser(teacherB.userId);
      }
      await inst.cleanup();
    }
  }, 30_000);

  it("institution with ai_teacher disabled: 503 ai_unavailable, no tools built, no new usage row", async () => {
    const inst: TestInstitution = await createTestInstitution("assistant-acceptance-module-off");
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,ai_teacher}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;
      setActingClient(inst.clientAs("owner") as unknown as SupabaseClient<Database>);

      const res = await POST(assistantRequest(inst.slug, "Hello"));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("ai_unavailable");

      const rows = await sql`
        select 1 from public.ai_usage_events where institution_id = ${inst.institutionId} and feature = 'assistant'
      `;
      expect(rows.length).toBe(0);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);
});
