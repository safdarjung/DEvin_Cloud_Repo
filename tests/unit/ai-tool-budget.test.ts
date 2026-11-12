// Tool budget (src/lib/ai/tool-budget.ts): a chat request never carries the
// whole registry. Production failure this pins: one question to the owner's
// assistant sent 68 tools (~12,900 tokens) to Groq's 8,000 TPM free tier.
import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import {
  FALLBACK_TOOL_TOKENS,
  MAX_GROUPS,
  META_TOOL,
  RESULT_RESERVE_TOKENS,
  TOKEN_CEILING,
  estimateTokens,
  messagesTokens,
  planToolBudget,
  selectTools,
  toolTokens,
  trimHistory,
  type ToolGroup,
} from "@/lib/ai/tool-budget";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { enabledCapabilities } from "@/modules/ai/capabilities/resolve";
import { CORE_TOOLS, ID_PROVIDERS, buildChatToolset } from "@/modules/ai/kernel/handle-chat";
import { systemPromptFor } from "@/modules/ai/kernel/personas";
import { setActingClient } from "../helpers/server-client-mock";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

afterEach(() => setActingClient(null));

const CHILD = "00000000-0000-4000-8000-000000000001";

function fakeTool(description: string, extra = 0) {
  return tool({ description: description + " ".repeat(extra), inputSchema: z.object({ id: z.string().optional() }), execute: async () => "ok" });
}

describe("estimateTokens", () => {
  it("is chars/4, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("prices a tool by its name, description and JSON schema", () => {
    const small = toolTokens("a", fakeTool("x"));
    expect(toolTokens("a", fakeTool("x", 400))).toBe(small + 100);
  });
});

describe("describeInput (tool parameter docs sent to the model)", () => {
  it("keeps format hints but drops their long regex patterns and $schema; a field named 'pattern' survives", async () => {
    const { describeInput } = await import("@/modules/agents/tools");
    const schema = describeInput(z.object({ id: z.uuid(), at: z.iso.datetime(), pattern: z.string().regex(/^a+$/) })).jsonSchema as {
      $schema?: string;
      properties: Record<string, { format?: string; pattern?: string }>;
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.id).toEqual({ type: "string", format: "uuid" });
    expect(schema.properties.at?.format).toBe("date-time");
    expect(schema.properties.at?.pattern).toBeUndefined();
    expect(schema.properties.pattern?.pattern).toBe("^a+$");
  });
});

describe("trimHistory", () => {
  const turn = (role: "user" | "assistant", n: number): ModelMessage => ({ role, content: `${role} ${n} ${"x".repeat(400)}` });
  const history = [turn("user", 1), turn("assistant", 1), turn("user", 2), turn("assistant", 2), turn("user", 3)];

  it("keeps everything when it fits", () => {
    expect(trimHistory(history, 10_000)).toEqual(history);
  });

  it("drops the oldest turns first and never starts on an assistant turn", () => {
    const kept = trimHistory(history, messagesTokens(history.slice(2)) + 5);
    expect(kept).toEqual(history.slice(2));
    expect(trimHistory(history, messagesTokens(history.slice(3)) + 5)[0]?.role).toBe("user");
  });

  it("always keeps the latest message, even over budget", () => {
    expect(trimHistory(history, 1)).toEqual([history[4]]);
  });
});

describe("selectTools (fixture groups)", () => {
  const tools: ToolSet = {
    navigate: fakeTool("link to a page"),
    attendance_today: fakeTool("today's attendance summary"),
    fees_due: fakeTool("fee collection and dues"),
    exams_list: fakeTool("exam list"),
    big: fakeTool("huge", 4_000),
  };
  const groups: ToolGroup[] = [
    { key: "attendance_overview", label: "Attendance", description: "Today's attendance summary", tools: ["attendance_today"] },
    { key: "finance_overview", label: "Finance", description: "Fee collection, invoices", tools: ["fees_due"] },
    { key: "exam_overview", label: "Exams", description: "Exam results", tools: ["exams_list"] },
    { key: "huge", label: "Huge", description: "fees attendance exams", tools: ["big"] },
  ];

  it("is deterministic and keeps core tools", () => {
    const input = { tools, groups, core: ["navigate"], texts: ["who was absent today?"], budget: 500 };
    expect(selectTools(input)).toEqual(selectTools(input));
    expect(selectTools(input).active).toContain("navigate");
  });

  it("maps everyday words to the domain (absent -> attendance, unpaid -> finance)", () => {
    expect(selectTools({ tools, groups, core: [], texts: ["how many were absent?"], budget: 500 }).groups).toEqual(["attendance_overview"]);
    expect(selectTools({ tools, groups, core: [], texts: ["which families have unpaid dues"], budget: 500 }).groups[0]).toBe("finance_overview");
  });

  it("never exceeds the budget: a group that does not fit is skipped", () => {
    const pick = selectTools({ tools, groups, core: [], texts: ["fees attendance exams"], budget: 500 });
    expect(pick.active).not.toContain("big");
    expect(pick.tokens).toBeLessThanOrEqual(500);
  });

  it("a follow-up keeps the earlier question's topic", () => {
    expect(selectTools({ tools, groups, core: [], texts: ["and for class 8B?", "show fee dues"], budget: 500 }).groups).toContain("finance_overview");
  });

  it("falls back to the first catalog groups for a vague message", () => {
    const pick = selectTools({ tools, groups, core: ["navigate"], texts: ["hello"], budget: 5_000 });
    expect(pick.matched).toBe(false);
    expect(pick.active).toEqual(expect.arrayContaining(["navigate", "attendance_today"]));
    expect(pick.active).not.toContain("big");
  });
});

describe("planToolBudget recovery (more_tools)", () => {
  const groups: ToolGroup[] = Array.from({ length: 30 }, (_, i) => ({ key: `g${i}`, label: `Topic${i}`, description: `records ${i}`, tools: [`t${i}`] }));
  const tools: ToolSet = Object.fromEntries(groups.map((g, i) => [`t${i}`, fakeTool(`tool for topic${i}`, 600)]));
  const run = (t: ToolSet, name: string, input: unknown) =>
    (t[name]?.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, { toolCallId: "c", messages: [] });

  it("adds more_tools only when something was left out, and every step stays under the ceiling", async () => {
    const plan = planToolBudget({ system: "rules", messages: [{ role: "user", content: "topic3" }], tools, groups, texts: ["topic3"], ceiling: 2_000 });
    expect(plan.activeTools).toContain(META_TOOL);
    expect(plan.activeTools).toContain("t3");
    expect(plan.estimatedTokens).toBeLessThanOrEqual(2_000 - RESULT_RESERVE_TOKENS);

    expect(await run(plan.tools, META_TOOL, {})).toMatch(/g7 \(Topic7\)/);
    expect(await run(plan.tools, META_TOOL, { group: "g7" })).toMatch(/Loaded Topic7: t7/);
    const step = await plan.prepareStep({ messages: [{ role: "user", content: "topic3" }], steps: [], stepNumber: 1 } as never);
    const active = step?.activeTools ?? [];
    expect(active).toContain("t7");
    const cost = active.reduce((s, n) => s + toolTokens(n, plan.tools[n] as ToolSet[string]), 0);
    expect(cost + estimateTokens("rules") + messagesTokens([{ role: "user", content: "topic3" }])).toBeLessThanOrEqual(2_000);

    await run(plan.tools, META_TOOL, { group: "g8" });
    expect(await run(plan.tools, META_TOOL, { group: "g9" })).toMatch(/No more groups/);
  });

  it("a group loaded via more_tools brings the id lookup its tools need", async () => {
    const lookup = tool({ description: "list terms", inputSchema: z.object({}), execute: async () => "[]" });
    const needsTerm = tool({ description: "fee summary " + " ".repeat(600), inputSchema: z.object({ termId: z.string() }), execute: async () => "{}" });
    const withLookup: ToolSet = { ...tools, terms: lookup, fees: needsTerm };
    const fixtureGroups = [...groups, { key: "fees", label: "Fees", description: "fees", tools: ["fees"] }];
    const plan = planToolBudget({
      system: "rules", messages: [{ role: "user", content: "topic3" }], tools: withLookup, groups: fixtureGroups,
      idProviders: { termId: ["terms"] }, texts: ["topic3"], ceiling: 2_000,
    });
    await run(plan.tools, META_TOOL, { group: "fees" });
    const step = await plan.prepareStep({ messages: [{ role: "user", content: "topic3" }], steps: [], stepNumber: 1 } as never);
    expect(step?.activeTools).toEqual(expect.arrayContaining(["fees", "terms"]));
  });

  it("sends a small tool set whole, without the meta-tool (agent runs)", () => {
    const small = { a: fakeTool("a"), b: fakeTool("b") };
    const plan = planToolBudget({ system: "s", messages: [{ role: "user", content: "x" }], tools: small, texts: ["x"], ceiling: 5_500 });
    expect(plan.activeTools.sort()).toEqual(["a", "b"]);
    expect(plan.tools).not.toHaveProperty(META_TOOL);
  });
});

// ---- full real registry -----------------------------------------------------

function ctxFor(role: Role): TenantContext {
  const allOn = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
  const aiRoles = Object.fromEntries(AI_ROLES.map((r) => [r, { enabled: true, cloud: true, capabilities: allOn }]));
  return {
    institution: {
      id: "inst-1",
      slug: "budget-test",
      name: "Budget",
      settings: { modules: allModulesOn(), features: { teacher_ai_agent: true, student_ai_study: true }, ai_roles: aiRoles },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: "guardian-1", studentId: "student-1" },
    permissions: new Set(permissionsFor(role)),
  };
}

async function realPlan(role: Role, mode: "cloud" | "local", question: string) {
  setActingClient({} as never); // teacher/student tool builders open a client; nothing is queried here
  const ctx = ctxFor(role);
  const capabilities = enabledCapabilities(ctx, role).filter((k) => CAPABILITIES[k].kind === "chat_tool");
  const childId = role === "guardian" ? CHILD : undefined;
  const { tools, groups } = await buildChatToolset(ctx, { personaRole: role, capabilities, mode, nonce: "n0nce", childId });
  const system = systemPromptFor({ role, nonce: "n0nce", mode, capabilities, instructions: "", childId });
  const ceiling = mode === "cloud" ? TOKEN_CEILING.groq : TOKEN_CEILING.local;
  const messages: ModelMessage[] = [{ role: "user", content: question }];
  const plan = planToolBudget({ system, messages, tools, groups, core: CORE_TOOLS, idProviders: ID_PROVIDERS, texts: [question], ceiling });
  return { plan, tools, ceiling, system, messages };
}

describe("tool budget with the full real registry", () => {
  for (const role of AI_ROLES) {
    for (const mode of ["cloud", "local"] as const) {
      it(`${role}/${mode}: first step fits under the ceiling, minus room for one tool result`, async () => {
        const { plan, ceiling } = await realPlan(role, mode, "Give me a full overview of everything");
        expect(plan.estimatedTokens).toBeLessThanOrEqual(ceiling - RESULT_RESERVE_TOKENS);
      });
    }
  }

  it("a typical question stays near 3,000 tokens a step, so a 2-step answer fits Groq's 8,000 TPM", async () => {
    for (const [role, question] of [
      ["owner", "How many students were absent today?"],
      ["principal", "Which fees are still unpaid this term?"],
      ["teacher", "How is Aarav's attendance pattern this term?"],
      ["admin", "Any timetable clashes this week?"],
    ] as const) {
      const { plan } = await realPlan(role, "cloud", question);
      expect(plan.estimatedTokens, `${role}: ${question}`).toBeLessThanOrEqual(3_000);
    }
  });

  it("the owner's full cloud registry alone is over the Groq ceiling (why the budget exists)", async () => {
    const { tools, system } = await realPlan("owner", "cloud", "hi");
    const total = Object.entries(tools).reduce((s, [n, d]) => s + toolTokens(n, d), 0) + estimateTokens(system);
    expect(total).toBeGreaterThan(TOKEN_CEILING.groq);
  });

  it("'How many students were absent today?' picks the attendance tools", async () => {
    const { plan } = await realPlan("owner", "cloud", "How many students were absent today?");
    expect(plan.groups[0]).toBe("attendance_overview");
    expect(plan.activeTools).toContain("attendance_attendanceTodaySummary");
  });

  it("a fees question picks the finance tools, which default to the current term, and the term list", async () => {
    const cloud = await realPlan("owner", "cloud", "Which fees are still unpaid this term?");
    expect(cloud.plan.groups[0]).toBe("finance_overview");
    expect(cloud.plan.activeTools).toEqual(expect.arrayContaining(["finance_termCollectionSummary", "finance_listTermOptions"]));
    const local = await realPlan("principal", "local", "Who has not paid fees?");
    expect(local.plan.activeTools).toContain("finance_listDefaulters");
  });

  it("'hello' falls back to a small default set plus navigate and more_tools", async () => {
    const { plan, tools } = await realPlan("owner", "cloud", "hello");
    expect(plan.activeTools).toEqual(expect.arrayContaining([META_TOOL, "navigate"]));
    expect(plan.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    const cost = (names: string[]) => names.reduce((s, n) => s + toolTokens(n, (plan.tools[n] ?? tools[n]) as ToolSet[string]), 0);
    expect(cost(plan.activeTools)).toBeLessThanOrEqual(cost([META_TOOL, "navigate"]) + FALLBACK_TOOL_TOKENS);
  });

  it("a teacher's student question brings findStudent along (studentId lookup)", async () => {
    const { plan } = await realPlan("teacher", "cloud", "How is Aarav's attendance pattern this term?");
    expect(plan.activeTools).toEqual(expect.arrayContaining(["getAttendancePattern", "findStudent"]));
  });
});
