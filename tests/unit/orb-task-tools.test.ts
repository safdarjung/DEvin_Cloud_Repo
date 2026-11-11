// Orb task bridge — the chat tools and proposal sanitising (design §3, §4 "Server
// enforcement", §7): rule-6 and generated keys never reach a card, excluded or
// switched-off tasks are unreachable through the tool and ai.proposal.start,
// guardians are pinned to their child, at most 5 cards per answer, and a chat
// request with tasks on still fits the Groq ceiling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolSet } from "ai";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { RESULT_RESERVE_TOKENS, TOKEN_CEILING, planToolBudget } from "@/lib/ai/tool-budget";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { enabledCapabilities } from "@/modules/ai/capabilities/resolve";
import { CORE_TOOLS, ID_PROVIDERS, buildChatToolset } from "@/modules/ai/kernel/handle-chat";
import { systemPromptFor } from "@/modules/ai/kernel/personas";
import { actionJsonSchema } from "@/modules/ai/tasks/derive";
import { classifiedTask, taskActionMeta } from "@/modules/ai/tasks/classified";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { setActingClient } from "../helpers/server-client-mock";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
const created = vi.hoisted(() => ({ calls: [] as { action: string; dependsOn?: string; childId?: string }[] }));
vi.mock("@/modules/ai/tasks/proposals", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/ai/tasks/proposals")>();
  return {
    ...real,
    // DB-free stand-in for the insert; the real sanitising/resolution is covered by the db and security suites.
    createProposal: vi.fn(async (ctx: TenantContext, input: { action: string; dependsOn?: string; childId?: string; source: string }) => {
      const { taskState } = await import("@/modules/ai/tasks/state");
      if (!taskState(ctx, input.action).enabled) throw new (await import("@/lib/actions/result")).AppError("forbidden", "This task is not available.");
      created.calls.push(input);
      const id = `00000000-0000-4000-8000-00000000000${created.calls.length}`;
      return { kind: "task_proposal", proposalId: id, view: { label: classifiedTask(input.action)?.label ?? input.action } } as unknown as TaskProposalOutput;
    }),
  };
});

const { pinStudent, sanitizeValues } = await import("@/modules/ai/tasks/proposals");
const { buildTaskTools, rankTasks, withTaskTools } = await import("@/modules/ai/tasks/task-tools");
const { startProposal } = await import("@/modules/ai/tasks/proposals.actions");
const { listEnabledTasks } = await import("@/modules/ai/tasks/state");

const CHILD = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

function ctxFor(role: Role, aiRoles: Record<string, unknown> = {}): TenantContext {
  const allOn = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
  const roles = Object.fromEntries(AI_ROLES.map((r) => [r, { enabled: true, cloud: true, capabilities: allOn }]));
  return {
    institution: {
      id: "inst-1",
      slug: "orb-tools",
      name: "Orb",
      settings: { modules: allModulesOn(), features: { teacher_ai_agent: true, student_ai_study: true }, ai_roles: { ...roles, ...aiRoles } },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: "guardian-1", studentId: "00000000-0000-4000-8000-0000000000a1" },
    permissions: new Set(permissionsFor(role)),
  };
}

const schemaOf = (action: string) => actionJsonSchema(taskActionMeta(action)!);

type Exec = (input: unknown, options?: unknown) => Promise<unknown>;
const exec = (tools: ToolSet, name: string) => (tools[name] as unknown as { execute: Exec }).execute;

beforeEach(() => {
  created.calls.length = 0;
});
afterEach(() => setActingClient(null));

describe("sanitising at proposal creation", () => {
  it("strips human-only (rule 6) keys and unknown keys", () => {
    const task = classifiedTask("expenses.record")!;
    const out = sanitizeValues(task, schemaOf("expenses.record"), { amount: "500", categoryId: "Stationery", note: "Chalk", junk: 1 });
    expect(out).toEqual({ categoryId: "Stationery", note: "Chalk" });
  });

  it("strips generated keys", () => {
    const task = classifiedTask("assignment.create")!;
    const out = sanitizeValues(task, schemaOf("assignment.create"), { title: "Fractions", aiGenerated: true });
    expect(out).toEqual({ title: "Fractions" });
  });

  it("strips context keys the server fills (attendance.submit sessionId)", () => {
    const task = classifiedTask("attendance.submit")!;
    expect(sanitizeValues(task, schemaOf("attendance.submit"), { sessionId: CHILD })).toEqual({});
  });
});

describe("guardian and student pinning", () => {
  it("a guardian's studentId is the verified chat child, whatever the model sent", async () => {
    const out = await pinStudent(ctxFor("guardian"), schemaOf("studentLeave.request"), { studentId: OTHER, reason: "Fever" }, CHILD);
    expect(out).toMatchObject({ studentId: CHILD, reason: "Fever" });
  });

  it("a student's studentId is their own record", async () => {
    const ctx = ctxFor("student");
    const out = await pinStudent(ctx, schemaOf("clubs.join"), { studentId: OTHER, clubId: "Chess" });
    expect(out.studentId).toBe(ctx.membership.studentId);
  });

  it("staff values are left alone", async () => {
    const out = await pinStudent(ctxFor("owner"), schemaOf("library.loan.issue"), { studentId: "Aarav" });
    expect(out).toEqual({ studentId: "Aarav" });
  });
});

describe("unreachable tasks", () => {
  it("excluded, unclassified and switched-off tasks are refused by propose_task", async () => {
    const off = ctxFor("owner", { owner: { enabled: true, tasks: { "library.loan.issue": false } } });
    const { tools } = buildTaskTools({ ctx: off, nonce: "n", texts: ["issue a book"] });
    for (const task of ["core.module.set", "academics.grade.upsert", "library.loan.issue", "agent.approve"]) {
      expect(await exec(tools, "propose_task")({ task, values: {} })).toMatch(/not available/);
    }
    expect(created.calls).toEqual([]);
  });

  it("excluded, unclassified and switched-off tasks are refused by ai.proposal.start", async () => {
    const off = ctxFor("owner", { owner: { enabled: true, tasks: { "library.loan.issue": false } } });
    for (const action of ["core.module.set", "academics.grade.upsert", "library.loan.issue"]) {
      const result = await startProposal(off.institution.slug, { action }, off);
      expect(result, action).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
  });

  it("a role preview gets no task tools (handle-chat passes none); a role without permission gets none of that task", () => {
    expect(listEnabledTasks(ctxFor("guardian")).map((t) => t.action)).not.toContain("library.loan.issue");
  });
});

describe("propose_task", () => {
  it("passes the guardian's child and the earlier card for `after`, and caps cards per answer", async () => {
    const { tools } = buildTaskTools({ ctx: ctxFor("guardian"), nonce: "n", texts: ["leave"], childId: CHILD });
    const propose = exec(tools, "propose_task");
    await propose({ task: "studentLeave.request", values: { reason: "Fever" } });
    await propose({ task: "ptm.booking.create", values: {}, after: 1 });
    expect(created.calls[0]).toMatchObject({ action: "studentLeave.request", childId: CHILD });
    expect(created.calls[1]?.dependsOn).toBe("00000000-0000-4000-8000-000000000001");
    expect(await propose({ task: "ptm.booking.create", values: {}, after: 4 })).toMatch(/no card number 4/);
    await propose({ task: "studentLeave.request", values: {} });
    await propose({ task: "studentLeave.request", values: {} });
    await propose({ task: "studentLeave.request", values: {} });
    expect(created.calls).toHaveLength(5);
    expect(await propose({ task: "studentLeave.request", values: {} })).toMatch(/At most 5/);
    expect(created.calls).toHaveLength(5);
  });

  it("the model gets back only 'Card shown: <label>', never ids or resolved names", async () => {
    const { tools } = buildTaskTools({ ctx: ctxFor("owner"), nonce: "n", texts: ["issue a book"] });
    const output = (await exec(tools, "propose_task")({ task: "library.loan.issue", values: { studentId: "Aarav" } })) as TaskProposalOutput;
    const toModel = (tools.propose_task as unknown as { toModelOutput: (o: { output: unknown }) => { value: string } }).toModelOutput;
    const text = toModel({ output }).value;
    expect(text).toMatch(/^Card shown: Issue a library book/);
    expect(text).not.toContain(output.proposalId);
  });
});

describe("task selection (design §3)", () => {
  it("an enabled task replaces its old draft_ tool in the chat's tool set", () => {
    const tasks = buildTaskTools({ ctx: ctxFor("owner"), nonce: "n", texts: ["issue a book"] });
    const merged = withTaskTools({ draft_library_loan_issue: {} as never, navigate: {} as never }, tasks);
    expect(Object.keys(merged).sort()).toEqual(["find_task", "navigate", "propose_task"]);
  });

  it("ranks the task the message is about first, and a clicked task loads exactly its signature", () => {
    const ctx = ctxFor("owner");
    expect(rankTasks(listEnabledTasks(ctx), ["Issue the book with accession number LIB-1 to Aarav"])[0]?.action).toBe("library.loan.issue");
    const hinted = buildTaskTools({ ctx, nonce: "abc", texts: ["anything"], taskHint: "visitors.checkIn" });
    expect(hinted.offered).toEqual(["visitors.checkIn"]);
    expect(hinted.system).toContain("<tasks-abc>");
    expect(hinted.system).toContain("visitors.checkIn: Check in a visitor");
  });

  it("a register task shows its intent form, never a roster list", () => {
    const { system } = buildTaskTools({ ctx: ctxFor("teacher"), nonce: "n", texts: ["mark 8B present except Ravi"] });
    expect(system).toContain("attendance.mark: Mark the attendance register | classSectionId:ref! date:date default:status except:list(student,status)");
  });

  // Defect from the joined orb check: in Do mode a create-mode task was filtered out and the model said the app could not do it.
  const CALENDAR = "Create a calendar event: Annual Sports Day on 20 December 2026 for the whole school";

  it("the orb mode is a preference, not a filter: a clearly matching task in another mode is still offered first", () => {
    for (const mode of ["do", "ask", "create", "manage"] as const) {
      const { offered } = buildTaskTools({ ctx: ctxFor("principal"), nonce: "n", texts: [CALENDAR], mode });
      expect(offered[0], mode).toBe("calendar.event.upsert");
    }
    const leave = buildTaskTools({ ctx: ctxFor("principal"), nonce: "n", texts: ["Approve Rudra Reddy's leave"], mode: "create" });
    expect(leave.offered).toContain("people.leave.approve");
    expect(classifiedTask("people.leave.approve")?.mode).toBe("do");
    const diary = buildTaskTools({ ctx: ctxFor("teacher"), nonce: "n", texts: ["Post a diary note for VIII-B: bring geometry boxes tomorrow"], mode: "ask" });
    expect(diary.offered[0]).toBe("diary.entry.post");
  });

  it("the current mode and group still break ties between equally matching tasks", () => {
    const twin = (action: string, mode: "do" | "create", groupId: "calendar" | "clubs") => ({ action, label: "Book a slot", mode, groupId, risk: "user_confirmed" as const });
    const tasks = [twin("a.do", "do", "calendar"), twin("b.create", "create", "clubs")];
    expect(rankTasks(tasks, ["book a slot"]).map((t) => t.action)).toEqual(["a.do", "b.create"]);
    expect(rankTasks(tasks, ["book a slot"], { mode: "create" })[0]?.action).toBe("b.create");
    expect(rankTasks(tasks, ["book a slot"], { groupId: "clubs" })[0]?.action).toBe("b.create");
    expect(rankTasks(tasks, ["hello"], { mode: "create" })).toEqual([]); // a boost never adds an unmatched task
  });

  it("tells the model to call find_task before saying the app cannot do something, even when no task matched", () => {
    const quiet = buildTaskTools({ ctx: ctxFor("principal"), nonce: "n", texts: ["hello"], mode: "do" });
    expect(quiet.offered).toEqual([]);
    expect(quiet.system).toMatch(/Call find_task with the person's words first\. Only if it finds nothing say the app cannot/);
    expect(quiet.system).toContain("name a page only if navigate gives one");
  });

  it("find_task searches every enabled task, whatever the mode", async () => {
    const { tools } = buildTaskTools({ ctx: ctxFor("principal"), nonce: "n", texts: ["hello"], mode: "do" });
    expect(await exec(tools, "find_task")({ query: CALENDAR })).toMatch(/^calendar\.event\.upsert: Add a calendar event/);
  });
});

// ---- the whole chat request with tasks on, real estimator ----------------------

async function plan(role: Role, mode: "cloud" | "local", question: string) {
  setActingClient({} as never);
  const ctx = ctxFor(role);
  const capabilities = enabledCapabilities(ctx, role).filter((k) => CAPABILITIES[k].kind === "chat_tool");
  const childId = role === "guardian" ? CHILD : undefined;
  const { tools, groups } = await buildChatToolset(ctx, { personaRole: role, capabilities, mode, nonce: "n0nce", childId });
  const tasks = buildTaskTools({ ctx, nonce: "n0nce", texts: [question], childId });
  const system = [systemPromptFor({ role, nonce: "n0nce", mode, capabilities, instructions: "", childId }), tasks.system].filter(Boolean).join("\n\n");
  const ceiling = mode === "cloud" ? TOKEN_CEILING.groq : TOKEN_CEILING.local;
  const messages: ModelMessage[] = [{ role: "user", content: question }];
  const core = [...CORE_TOOLS, ...Object.keys(tasks.tools)];
  return { plan: planToolBudget({ system, messages, tools: withTaskTools(tools, tasks), groups, core, idProviders: ID_PROVIDERS, texts: [question], ceiling }), ceiling, tasks };
}

describe("token budget with tasks on", () => {
  for (const role of AI_ROLES) {
    for (const mode of ["cloud", "local"] as const) {
      it(`${role}/${mode}: first step with the task block and both task tools fits under the ceiling`, async () => {
        const { plan: p, ceiling, tasks } = await plan(role, mode, "Mark 8B present today except Ravi, then submit, and approve Ms Rao's leave");
        expect(p.estimatedTokens).toBeLessThanOrEqual(ceiling - RESULT_RESERVE_TOKENS);
        for (const name of Object.keys(tasks.tools)) expect(p.activeTools).toContain(name);
      });
    }
  }
});

describe("cloud redaction of task cards (gateway)", () => {
  it("redacts what the model gets from a toModelOutput tool, never the card the browser gets", async () => {
    const { redactToolResults } = await import("@/lib/ai/gateway");
    const id = "f03c2b77-d3d3-50d5-8e90-123456789012"; // a real-looking id with a 12-digit run
    const card = { kind: "task_proposal", proposalId: id, view: { values: { studentId: id } } };
    const tally = { count: 0 };
    const tools = redactToolResults(
      {
        propose_task: { execute: async () => card, toModelOutput: () => ({ type: "text", value: "Card shown: call 9876543210" }) },
        plain: { execute: async () => ({ phone: "9876543210" }) },
      } as unknown as ToolSet,
      tally,
    );
    const t = tools as unknown as Record<string, { execute: () => Promise<unknown>; toModelOutput?: (o: unknown) => Promise<{ value: string }> }>;
    expect(await t.propose_task!.execute()).toEqual(card);
    expect((await t.propose_task!.toModelOutput!({ output: card })).value).toBe("Card shown: call [REDACTED_PHONE]");
    expect(await t.plain!.execute()).toEqual({ phone: "[REDACTED_PHONE]" });
    expect(tally.count).toBe(2);
  });
});

describe("relative dates", () => {
  it("today / tomorrow / yesterday become the school's calendar date; other values pass through", async () => {
    const { relativeDate } = await import("@/modules/ai/tasks/expanders");
    const ctx = ctxFor("teacher");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const shift = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    expect(relativeDate(ctx, "today")).toBe(today);
    expect(relativeDate(ctx, "Tomorrow")).toBe(shift(1));
    expect(relativeDate(ctx, "yesterday")).toBe(shift(-1));
    expect(relativeDate(ctx, "2026-12-20")).toBe("2026-12-20");
    expect(relativeDate(ctx, "next week")).toBe("next week");
  });
});
