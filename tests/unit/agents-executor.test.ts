import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import { getRegisteredActions, type AnyAction } from "@/lib/actions/registry";
import { ok } from "@/lib/actions/result";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import type { AgentProposal } from "@/modules/agents/catalog";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

vi.mock("@/lib/ai/providers", () => ({
  getLocalModel: vi.fn(),
  getCloudModel: vi.fn(async () => "cloud-model-handle"),
  localModelId: vi.fn(() => "qwen3:4b-instruct-2507-q4_K_M"),
  cloudModelId: vi.fn(() => "claude-sonnet-5"),
}));

vi.mock("@/lib/ai/usage", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  logUsage: vi.fn(async () => {}),
  acquireConcurrencySlot: vi.fn(() => true),
  releaseConcurrencySlot: vi.fn(() => {}),
  aiSettingsFor: vi.fn(() => ({
    daily_token_quota: 200000,
    per_user_per_minute: 10,
    max_concurrent_local: 2,
    max_concurrent_cloud: 4,
  })),
}));

const { decideOutcome, executeAgentRun, executeProposals } = await import("@/modules/agents/executor");
const providers = await import("@/lib/ai/providers");
const usage = await import("@/lib/ai/usage");

const RUN_ID = "00000000-0000-4000-8000-0000000000aa";

function ownerCtx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "exec-test", name: "Exec", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Owner", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "owner", staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor("owner")),
  };
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

function useModel(...steps: StreamResult[]): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({ doStream: steps });
  vi.mocked(providers.getLocalModel).mockReturnValue(model);
  return model;
}

/** Swap one registry entry for a fake via a spy on the shared Map's get (restored after each test). */
function fakeEntry(map: ReadonlyMap<string, AnyAction>, name: string, fake: AnyAction): void {
  const realGet = Map.prototype.get;
  vi.spyOn(map as Map<string, AnyAction>, "get").mockImplementation(function (this: Map<string, AnyAction>, key: string) {
    return key === name ? fake : realGet.call(this, key);
  });
}

function fakeAction(name: string) {
  const spy = vi.fn(async () => ok({ id: "x" }));
  fakeEntry(getRegisteredActions(), name, spy);
  return spy;
}

function proposal(action: string, risk: AgentProposal["risk_class"]): AgentProposal {
  return { action, input: {}, risk_class: risk, status: "proposed", error_code: null };
}

const texts = (log: { text: string }[]) => log.map((e) => e.text);

// These cases drive the mocked local model; with a Groq/Gemini key the executor goes to the cloud.
const savedCloudKeys = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usage.checkLimits).mockResolvedValue({ ok: true });
  vi.mocked(usage.acquireConcurrencySlot).mockReturnValue(true);
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedCloudKeys)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("decideOutcome", () => {
  it.each([
    ["no proposals", true, [], "done", "read_only"],
    ["only low risk", true, [proposal("announcement.create", "low_risk_reversible")], "done", "low_risk_reversible"],
    ["user confirmed", true, [proposal("maintenance.assign", "user_confirmed")], "awaiting_approval", "user_confirmed"],
    ["human approved", true, [proposal("finance.reminders.send", "human_approved")], "awaiting_approval", "human_approved"],
    [
      "mixed low and human",
      true,
      [proposal("announcement.create", "low_risk_reversible"), proposal("announcement.publish", "human_approved")],
      "awaiting_approval",
      "human_approved",
    ],
    ["model failure", false, [proposal("finance.reminders.send", "human_approved")], "failed", "read_only"],
  ] as const)("%s", (_label, isOk, proposals, status, riskClass) => {
    expect(decideOutcome({ ok: isOk, proposals: [...proposals] })).toEqual({ status, riskClass });
  });
});

describe("executeAgentRun", () => {
  it("read tool then text → done, read_only, summary is the model text, usage linked to the run", async () => {
    const query = vi.fn(async () => ok({ rows: [] }));
    fakeEntry(getRegisteredQueries(), "finance.listDefaulters", query);
    const model = useModel(toolStep(["finance_listDefaulters", {}]), textStep("  Three families owe fees.  "));

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "finance", task: "Who owes fees?" });

    expect(out.status).toBe("done");
    expect(out.riskClass).toBe("read_only");
    expect(out.summary).toBe("Three families owe fees.");
    expect(out.proposals).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(texts(out.log)).toContain("Called finance.listDefaulters");
    expect(texts(out.log).at(-1)).toBe("Finished: done");
    // the task reaches the model only inside its nonce tag, never in the log
    const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(prompt).toMatch(/<task-[0-9a-f]{32}>Who owes fees\?<\/task-[0-9a-f]{32}>/);
    expect(JSON.stringify(out.log)).not.toContain("Who owes fees");
    expect(model.doStreamCalls[0].maxOutputTokens).toBe(1024);
    await vi.waitFor(() =>
      expect(usage.logUsage).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: RUN_ID, feature: "agent.finance", ok: true })),
    );
  });

  it("one human_approved proposal → awaiting_approval and nothing executes", async () => {
    const action = fakeAction("finance.reminders.send");
    useModel(toolStep(["propose_finance_reminders_send", { termId: "t" }]), textStep("Reminders proposed."));

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "finance", task: "Chase fees" });

    expect(out.status).toBe("awaiting_approval");
    expect(out.riskClass).toBe("human_approved");
    expect(out.proposals).toEqual([
      { action: "finance.reminders.send", input: { termId: "t" }, risk_class: "human_approved", status: "proposed", error_code: null },
    ]);
    expect(action).not.toHaveBeenCalled();
    expect(texts(out.log)).toContain("Proposed finance.reminders.send (human_approved)");
  });

  it("only low_risk_reversible proposals → executed as the requester, then done", async () => {
    const action = fakeAction("announcement.create");
    useModel(toolStep(["propose_announcement_create", { title: "Sports day" }]), textStep("Draft made."));

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "communication", task: "Draft a notice" });

    expect(out.status).toBe("done");
    expect(out.riskClass).toBe("low_risk_reversible");
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("exec-test", { title: "Sports day" });
    expect(out.proposals[0]).toMatchObject({ status: "executed", error_code: null });
    expect(texts(out.log)).toContain("Executed announcement.create");
  });

  it("mixed low and human proposals → awaiting_approval and nothing executes", async () => {
    const create = fakeAction("announcement.create");
    useModel(
      toolStep(["propose_announcement_create", { title: "a" }], ["propose_announcement_publish", { id: "b" }]),
      textStep("Two proposals."),
    );

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "communication", task: "Announce" });

    expect(out.status).toBe("awaiting_approval");
    expect(out.riskClass).toBe("human_approved");
    expect(out.proposals.map((p) => p.status)).toEqual(["proposed", "proposed"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("an unknown tool call does not fail the run and is logged as warn", async () => {
    useModel(toolStep(["exams_listExams", {}]), textStep("Nothing to report."));

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "finance", task: "x" });

    expect(out.status).toBe("done");
    expect(out.log).toContainEqual(expect.objectContaining({ level: "warn", text: "Unknown tool exams_listExams" }));
  });

  it("provider unavailable → failed with the fixed summary and no proposals", async () => {
    vi.mocked(providers.getLocalModel).mockImplementation(() => {
      throw new Error("no local engine");
    });

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "finance", task: "x" });

    expect(out).toMatchObject({ status: "failed", riskClass: "read_only", summary: "The AI service was not available.", proposals: [] });
    expect(texts(out.log)).toEqual(["Model unavailable (ai_unavailable)", "Finished: failed"]);
  });

  it("timeout → failed, proposals dropped, nothing executes", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const action = fakeAction("announcement.create");
    useModel(toolStep(["propose_announcement_create", { title: "a" }]), textStep("done"));

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "communication", task: "x" });

    expect(out.status).toBe("failed");
    expect(out.proposals).toEqual([]);
    expect(action).not.toHaveBeenCalled();
    expect(texts(out.log)).toContain("Run stopped (timeout)");
  });

  it("stream error → failed, proposals dropped", async () => {
    const action = fakeAction("announcement.create");
    useModel(toolStep(["propose_announcement_create", { title: "a" }]), {
      stream: convertArrayToReadableStream<StreamPart>([{ type: "error", error: new Error("boom") }]),
    });

    const out = await executeAgentRun(ownerCtx(), { runId: RUN_ID, slug: "communication", task: "x" });

    expect(out.status).toBe("failed");
    expect(out.proposals).toEqual([]);
    expect(action).not.toHaveBeenCalled();
    expect(texts(out.log)).toContain("Run stopped (error)");
  });
});

describe("executeProposals", () => {
  it("skips an action outside the agent's catalog and records failures by code", async () => {
    const reminders = fakeAction("finance.reminders.send");
    reminders.mockResolvedValueOnce({ ok: false, error: { code: "invalid_state", message: "no" } } as never);

    const out = await executeProposals(ownerCtx(), "finance", [
      proposal("announcement.create", "low_risk_reversible"),
      proposal("finance.reminders.send", "human_approved"),
    ]);

    expect(out.proposals).toEqual([
      expect.objectContaining({ action: "announcement.create", status: "skipped", error_code: "not_allowed" }),
      expect.objectContaining({ action: "finance.reminders.send", status: "failed", error_code: "invalid_state" }),
    ]);
    expect(texts(out.log)).toContain("Failed finance.reminders.send (invalid_state)");
  });

  it("a throwing action becomes failed/internal", async () => {
    fakeAction("finance.reminders.send").mockRejectedValueOnce(new Error("kaboom"));

    const out = await executeProposals(ownerCtx(), "finance", [proposal("finance.reminders.send", "human_approved")]);

    expect(out.proposals[0]).toMatchObject({ status: "failed", error_code: "internal" });
  });
});
