// Curveball suite for the pure parts behind the App Orb's AI tools: name and
// class matching, unit-title matching, attendance arithmetic, source logging,
// the cloud query filter, result fitting, task ranking, and the propose/find
// task tools' handling of hostile task names (createProposal is stubbed; the
// db suite tests/db/orb-tools.curveball.test.ts covers the real insert).
import { describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { fitForModel } from "@/lib/ai/fit-for-model";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { ASSISTANT_QUERIES, createSourceLog, queriesFor } from "@/modules/ai/assistant/catalog";
import { unitSearchWords, unitTitleScore } from "@/modules/ai/agent/unit-match";
import { headCounts, percentageFromCounts } from "@/modules/attendance/queries";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
const created = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/modules/ai/tasks/proposals", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/ai/tasks/proposals")>();
  return { ...real, createProposal: vi.fn(async () => { created.calls += 1; throw new Error("createProposal must not run for these inputs"); }) };
});

const { normalizeLabel, numeralForms } = await import("@/modules/ai/tasks/entities");
const { relativeDate } = await import("@/modules/ai/tasks/expanders");
const { buildTaskTools, rankTasks } = await import("@/modules/ai/tasks/task-tools");
const { listEnabledTasks } = await import("@/modules/ai/tasks/state");

const INJECTIONS = ["%", "_", ",", ")", "(", '"', "\\", "*", "or=(id.not.is.null)", "a,first_name.ilike.*", "'; drop table students;--", "title.ilike.*"];
const LONG = "fractions ".repeat(2_000);

function ctxFor(role: Role): TenantContext {
  const allOn = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
  const roles = Object.fromEntries(AI_ROLES.map((r) => [r, { enabled: true, cloud: true, capabilities: allOn }]));
  return {
    institution: {
      id: "inst-1",
      slug: "orb-curve",
      name: "Orb",
      settings: { modules: allModulesOn(), features: { teacher_ai_agent: true, student_ai_study: true }, ai_roles: roles },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const exec = (tools: ToolSet, name: string) =>
  (tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute;

const STATUSES = [
  { code: "P", label: "Present", countsPresent: 1, inDenominator: true },
  { code: "H", label: "Half day", countsPresent: 0.5, inDenominator: true },
  { code: "A", label: "Absent", countsPresent: 0, inDenominator: true },
  { code: "X", label: "Excused", countsPresent: 0, inDenominator: false },
];

describe("unit title matching (teacher findCurriculumUnit)", () => {
  it("hostile text reduces to plain lower-case words; nothing PostgREST treats as syntax survives", () => {
    for (const q of INJECTIONS) {
      for (const w of unitSearchWords(q)) expect(w, q).toMatch(/^[a-z0-9ऀ-ॿ]+$/);
    }
    expect(unitSearchWords("%")).toEqual([]);
    expect(unitSearchWords("")).toEqual([]);
  });

  it("caps very long input at 8 distinct words, keeps Hindi, drops class numbers and filler", () => {
    expect(unitSearchWords(LONG)).toEqual(["fraction"]);
    expect(unitSearchWords("a b c d e f g h i j k l m n o p q r s t u v w x y z aa bb cc dd ee ff gg hh ii jj")).toHaveLength(8);
    expect(unitSearchWords("भिन्न और दशमलव")).toEqual(["भिन्न", "और", "दशमलव"]);
    expect(unitSearchWords("chapter 2 for class 8th: Acids, Bases & Salts!!")).toEqual(["acid", "base", "salt"]);
  });

  it("score is 0..1 and never NaN, even for no words", () => {
    expect(unitTitleScore("Acids, Bases and Salts", [])).toBe(0);
    expect(unitTitleScore("", ["acid"])).toBe(0);
    expect(unitTitleScore("Acids, Bases and Salts", ["acid", "base", "salt", "zinc"])).toBe(0.75);
  });
});

describe("class and name normalising (orb card pickers)", () => {
  it("'VIII-A', 'Class 8-B', 'Ms. Rao' normalise to bare letters and digits", () => {
    expect(normalizeLabel("VIII-A")).toBe("viiia");
    expect(normalizeLabel("Class 8-B")).toBe("8b");
    expect(normalizeLabel("Ms. Rao")).toBe("rao");
    expect(normalizeLabel("%),or=")).toBe("or");
  });

  it("numeral forms: 8, 8th and 8a gain their Roman form; 0, 13 and words do not invent one", () => {
    expect(numeralForms("8")).toEqual(["8", "viii"]);
    expect(numeralForms("8th")).toEqual(["8th", "viii"]);
    expect(numeralForms("8a")).toEqual(["8a", "viiia"]);
    expect(numeralForms("12")).toEqual(["12", "xii"]);
    expect(numeralForms("0")).toEqual(["0"]);
    expect(numeralForms("13")).toEqual(["13"]);
    expect(numeralForms("999")).toEqual(["999"]);
  });

  it("a Devanagari name normalises to an empty string, so every Hindi label looks identical to every other", () => {
    expect(normalizeLabel("आरव")).not.toBe("");
    expect(normalizeLabel("आरव")).not.toBe(normalizeLabel("प्रिया"));
  });

  it("number words ('eight') get no numeral form, so 'class eight A' never matches VIII-A", () => {
    expect(numeralForms("eight")).toContain("viii");
  });
});

describe("attendance arithmetic", () => {
  it("unknown status codes and not-counted statuses never make NaN or a % above 100", () => {
    const r = percentageFromCounts([{ status: "?", n: 5 }, { status: "X", n: 3 }], STATUSES);
    expect(r).toEqual({ percentage: 0, presentWeighted: 0, totalInDenominator: 0 });
    const big = percentageFromCounts([{ status: "P", n: 1_000_000 }, { status: "H", n: 1 }], STATUSES);
    expect(big.percentage).toBeLessThanOrEqual(100);
    expect(Number.isFinite(big.percentage)).toBe(true);
  });

  it("half days weigh 0.5 in the % but head counts stay whole people", () => {
    const rows = [{ status: "P", n: 3 }, { status: "H", n: 1 }, { status: "A", n: 1 }, { status: "X", n: 2 }, { status: "??", n: 1 }];
    expect(percentageFromCounts(rows, STATUSES)).toMatchObject({ percentage: 70, presentWeighted: 3.5, totalInDenominator: 5 });
    const h = headCounts(rows, STATUSES);
    expect(h).toMatchObject({ studentsMarked: 5, present: 3, halfDay: 1, absent: 1, notCounted: 3 });
    for (const v of [h.studentsMarked, h.present, h.halfDay, h.absent, h.notCounted]) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("assistant source log and cloud filter", () => {
  it("source log survives circular params, caps at 20, nulls huge params, dedupes", () => {
    const log = createSourceLog();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => log.add("q.circular", circular)).not.toThrow();
    log.add("q.big", { s: "x".repeat(2_000) });
    log.add("q.big", { s: "x".repeat(2_000) });
    for (let i = 0; i < 30; i++) log.add(`q.${i}`, { i });
    const list = log.list();
    expect(list).toHaveLength(20);
    expect(list.find((s) => s.query === "q.big")?.params).toBeNull();
    expect(list.filter((s) => s.query === "q.big")).toHaveLength(1);
  });

  it("every provider gets every assistant query (owner decision 2026-11-12)", () => {
    expect(Object.keys(queriesFor())).toHaveLength(Object.keys(ASSISTANT_QUERIES).length);
  });
});

describe("tool result fitting", () => {
  it("a 10,000-row result fits the cap, stays valid JSON, keeps totals and says it was cut", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ name: `आरव ${i}`, present: i % 2 }));
    const out = fitForModel({ total: 10_000, rows }, 4_000);
    expect(out.length).toBeLessThanOrEqual(4_000);
    const parsed = JSON.parse(out) as { truncated: string; total: number; rows: unknown[] };
    expect(parsed.total).toBe(10_000);
    expect(parsed.truncated).toMatch(/showing \d+ of 10000/);
  });

  it("NaN and Infinity never reach the model as bare tokens", () => {
    expect(fitForModel({ percentage: Number.NaN, ratio: Number.POSITIVE_INFINITY }, 4_000)).toBe('{"percentage":null,"ratio":null}');
  });
});

describe("task ranking and the propose/find tools with hostile text", () => {
  it("rankTasks never throws and returns only enabled tasks for odd texts", () => {
    const tasks = listEnabledTasks(ctxFor("teacher"));
    expect(tasks.length).toBeGreaterThan(0);
    const actions = new Set(tasks.map((t) => t.action));
    for (const text of [...INJECTIONS, "", "   ", LONG, "आज की उपस्थिति लगाओ", "\u0000\u0001", "🙂🙂🙂"]) {
      const ranked = rankTasks(tasks, [text]);
      for (const t of ranked) expect(actions.has(t.action), text.slice(0, 20)).toBe(true);
    }
    expect(rankTasks(tasks, [""])).toEqual([]);
  });

  it("propose_task: empty, path-like, very long, Hindi and rule-6 task names get text back and never reach createProposal", async () => {
    created.calls = 0;
    const { tools } = buildTaskTools({ ctx: ctxFor("teacher"), nonce: "n", texts: ["mark attendance"] });
    for (const task of ["", "../../etc/passwd", LONG.slice(0, 80), "उपस्थिति", "exam.marks.enter", "finance.payment.record", "assignment.grade", ...INJECTIONS]) {
      const out = await exec(tools, "propose_task")({ task, values: { amount: 5_000, marks: 100 } }, {});
      expect(typeof out, task).toBe("string");
      expect(out as string, task).toMatch(/not available/);
    }
    expect(created.calls).toBe(0);
  });

  it("find_task: empty, Hindi, hostile and very long queries answer in text", async () => {
    const { tools } = buildTaskTools({ ctx: ctxFor("teacher"), nonce: "n", texts: ["hello"] });
    for (const query of ["", "उपस्थिति", LONG, ...INJECTIONS]) {
      const out = await exec(tools, "find_task")({ query }, {});
      expect(typeof out, query.slice(0, 20)).toBe("string");
    }
    expect(await exec(tools, "find_task")({ query: "post a diary entry" }, {})).toContain("diary.entry.post");
  });

  it("guardian and student get no staff tasks (attendance, diary) to propose", () => {
    for (const role of ["guardian", "student"] as const) {
      const actions = listEnabledTasks(ctxFor(role)).map((t) => t.action);
      for (const staff of ["attendance.mark", "diary.entry.post", "announcement.create", "expenses.record"]) expect(actions, `${role} ${staff}`).not.toContain(staff);
    }
  });
});

describe("relative dates on cards", () => {
  it("'TOMORROW ' becomes a date; impossible and non-string dates pass through unchanged for validation", () => {
    const ctx = ctxFor("teacher");
    expect(relativeDate(ctx, " TOMORROW ")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(relativeDate(ctx, "2026-02-30")).toBe("2026-02-30");
    expect(relativeDate(ctx, 20261112)).toBe(20261112);
    expect(relativeDate(ctx, "next blue moon")).toBe("next blue moon");
  });
});
