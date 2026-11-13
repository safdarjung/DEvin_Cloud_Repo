// T4 (ai-roles) — acceptance for the unified chat kernel
// (`handleAiChat`/`src/modules/ai/kernel/handle-chat.ts`), exercised
// through the real route handlers against real RLS, same technique as
// `tests/db/assistant-acceptance.test.ts` (`@/lib/supabase/server` mocked
// to a real signed-in client per role via `setActingClient`,
// `@/lib/ai/providers` mocked to a scripted `MockLanguageModelV4`). Covers
// exactly the four scenarios named in tasks.md's T4 packet: a guardian's
// own child is allowed, another child is forbidden before any model call,
// a teacher with `generate_quiz` turned off never gets a `generateQuiz`
// tool, and a role whose AI chat is off gets `ai_unavailable` with no
// model call and no new usage row. The model is always mocked — never a
// real provider.
import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
}));

import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const providers = await import("@/lib/ai/providers");
const { POST: assistantPost } = await import("@/app/api/ai/agent/assistant/route");
const { POST: teacherPost } = await import("@/app/api/ai/agent/teacher/route");

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

// The route goes cloud whenever a Gemini/Groq key is set — these acceptance
// cases drive the mocked local model, so run them keyless (same as
// assistant-acceptance.test.ts).
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

function chatRequest(slug: string, text: string, studentId?: string): Request {
  return new Request("http://localhost/api/ai/agent/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      institutionSlug: slug,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
      ...(studentId ? { studentId } : {}),
    }),
  });
}

// T7 ("Test as role") — same request shape, with the `previewRole` field
// `handleAiChat` only honours from an `institution.settings.manage` holder.
function previewChatRequest(slug: string, text: string, previewRole: string): Request {
  return new Request("http://localhost/api/ai/agent/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      institutionSlug: slug,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
      previewRole,
    }),
  });
}

/** Parses the `data: ...` SSE lines `toUIMessageStreamResponse` emits. */
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

async function createStudent(institutionId: string, admissionNo: string, firstName = "Test Student"): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, ${firstName}, '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function guardianIdFor(inst: TestInstitution): Promise<string> {
  const [row] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  return row.guardian_id as string;
}

async function linkGuardianToChild(inst: TestInstitution, studentId: string): Promise<void> {
  const guardianId = await guardianIdFor(inst);
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'mother', true)
  `;
}

// Every role's AI chat is on by default since 2026-11-12; these acceptance
// cases still switch it on explicitly so they stay about the child-scoping gate.
async function setRoleChat(institutionId: string, role: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('ai_roles', jsonb_build_object(${role}::text, jsonb_build_object('enabled', ${enabled}::boolean)))
    where id = ${institutionId}
  `;
}
const enableRoleChat = (institutionId: string, role: string): Promise<void> => setRoleChat(institutionId, role, true);

async function enableChatCapability(institutionId: string, role: string, capability: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'ai_roles', jsonb_build_object(${role}::text, jsonb_build_object('capabilities', jsonb_build_object('generate_quiz', ${capability})))
    )
    where id = ${institutionId}
  `;
}

describe("handleAiChat — role/guardian acceptance (ai-roles T4)", () => {
  it("guardian: own child's conversation succeeds (studentId verified against guardian_students)", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-guardian-own");
    try {
      await enableRoleChat(inst.institutionId, "guardian");
      const child = await createStudent(inst.institutionId, "ADM-GOK-1", "OwnChild");
      await linkGuardianToChild(inst, child);

      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("Your child is doing well."));

      const res = await assistantPost(chatRequest(inst.slug, "How is my child doing?", child));
      expect(res.status).toBe(200);
      const chunks = await streamChunks(res);
      expect(chunks.some((c) => c.type === "text-delta" && String(c.delta).includes("doing well"))).toBe(true);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian: a student that is not their child is forbidden before any model call", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-guardian-other");
    try {
      await enableRoleChat(inst.institutionId, "guardian");
      const strangerChild = await createStudent(inst.institutionId, "ADM-GOK-2", "StrangerChild");
      // Deliberately never linked via guardian_students.

      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("should never run"));

      const res = await assistantPost(chatRequest(inst.slug, "How is this student doing?", strangerChild));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
      expect(providers.getLocalModel).not.toHaveBeenCalled();
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  // 2026-11-13: no studentId now covers every linked child (orb fix); a guardian
  // with no linked child is refused before the model.
  it("guardian with no linked child and no studentId is forbidden, never reaching the model", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-guardian-missing");
    try {
      await enableRoleChat(inst.institutionId, "guardian");
      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("should never run"));

      const res = await assistantPost(chatRequest(inst.slug, "How is my child doing?"));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
      expect(providers.getLocalModel).not.toHaveBeenCalled();
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher: generate_quiz capability off means no generateQuiz tool, even when the model tries to call it", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-teacher-quiz-off");
    try {
      await enableChatCapability(inst.institutionId, "teacher", false);

      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      scriptModel(
        toolStep(["generateQuiz", { curriculumUnitId: crypto.randomUUID(), difficulty: "easy", questionCount: 5 }]),
        textStep("I can't generate a quiz right now."),
      );

      const res = await teacherPost(chatRequest(inst.slug, "Generate a quiz for photosynthesis."));
      expect(res.status).toBe(200);
      const chunks = await streamChunks(res);
      // The tool was never in the set streamText saw, so no quiz draft (with its
      // "defaultTitle"/"questions" shape) can appear in any tool output.
      expect(toolOutputs(chunks).join(" ")).not.toMatch(/defaultTitle|"questions"/);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("teacher: generate_quiz capability on keeps the generateQuiz tool available", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-teacher-quiz-on");
    try {
      await enableChatCapability(inst.institutionId, "teacher", true);

      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("Sure, tell me which unit."));

      const res = await teacherPost(chatRequest(inst.slug, "Hi"));
      expect(res.status).toBe(200);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("role disabled (accountant chat switched off): ai_unavailable, no model call, no usage row", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-disabled");
    try {
      await setRoleChat(inst.institutionId, "accountant", false);
      setActingClient(inst.clientAs("accountant") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("should never run"));

      const res = await assistantPost(chatRequest(inst.slug, "Hello"));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("ai_unavailable");
      expect(providers.getLocalModel).not.toHaveBeenCalled();

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

// T7 — "Test as role": `previewRole` is only honoured from a caller holding
// `institution.settings.manage`, runs as the caller's own RLS/permissions,
// and never exposes a previewed role's own-data tools (no own student/child
// to scope them to in a preview).
describe("handleAiChat — previewRole (ai-roles T7)", () => {
  it("a teacher sending previewRole is forbidden before any model call", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-preview-forbidden");
    try {
      setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
      scriptModel(textStep("should never run"));

      const res = await assistantPost(previewChatRequest(inst.slug, "Hello", "student"));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
      expect(providers.getLocalModel).not.toHaveBeenCalled();
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);

  it("a principal previewing student gets the student persona but no own-data tool (study is all 'own')", async () => {
    const inst: TestInstitution = await createTestInstitution("ai-chat-roles-preview-student");
    try {
      await enableRoleChat(inst.institutionId, "student");

      setActingClient(inst.clientAs("principal") as unknown as SupabaseClient<Database>);
      scriptModel(
        toolStep(["findMyCurriculumUnit", { query: "fractions" }]),
        textStep("I can't look that up from here."),
      );

      const res = await assistantPost(previewChatRequest(inst.slug, "Find the fractions unit.", "student"));
      expect(res.status).toBe(200);
      const chunks = await streamChunks(res);
      // findMyCurriculumUnit is `study_curriculum` (data: "own") — dropped from
      // every preview, so the tool never ran and produced no output chunk.
      expect(toolOutputs(chunks).length).toBe(0);
      expect(chunks.some((c) => c.type === "text-delta" && String(c.delta).includes("can't look that up"))).toBe(true);
    } finally {
      setActingClient(null);
      await inst.cleanup();
    }
  }, 30_000);
});
