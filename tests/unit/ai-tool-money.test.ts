// Money a model sees is display text, never a number it must convert.
// Production bug: the prompt said "amounts are in paise: show rupees" while
// finance.collectionReport (and other tools) returned rupees, so the model
// divided rupees by 100 and reported fee totals 100x too small. Each
// money-returning read tool (assistant, chat kernel, agents and workflow
// agent steps all share agents/tools.ts readTool) is driven here with a
// stubbed query result.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import type { AnyAction } from "@/lib/actions/registry";
import { ok } from "@/lib/actions/result";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { formatINR } from "@/lib/format";
import { redact } from "@/lib/ai/redact";
import { allModulesOn } from "@/lib/modules/catalog";
import { buildAgentTools, buildReadTools, createProposalSink } from "@/modules/agents/tools";
import { plainChatText } from "@/modules/ai/chat-text";
import { systemPromptFor } from "@/modules/ai/kernel/personas";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const NONCE = "m0ney123";

const ctx: TenantContext = {
  institution: { id: "inst-1", slug: "money-test", name: "Money", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
  user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
  membership: { role: "owner", staffId: "staff-1", guardianId: null, studentId: null },
  permissions: new Set(permissionsFor("owner")),
};

function fakeQuery(name: string, data: unknown): void {
  const map = getRegisteredQueries() as Map<string, AnyAction>;
  const realGet = Map.prototype.get;
  const fake = (async () => ok(data)) as unknown as AnyAction;
  vi.spyOn(map, "get").mockImplementation(function (this: Map<string, AnyAction>, key: string) {
    return key === name ? fake : realGet.call(this, key);
  });
}

async function run(tools: ToolSet, name: string): Promise<string> {
  const t = tools[name];
  if (!t?.execute) throw new Error(`no tool ${name}`);
  const out = await t.execute({} as never, { toolCallId: "call-1", messages: [], context: {} as never });
  return String(out);
}

function numericLeaves(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numericLeaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(numericLeaves);
  return [];
}

function payloadOf(out: string): unknown {
  const match = new RegExp(`^<data-${NONCE}>(.*)</data-${NONCE}>$`, "s").exec(out);
  if (!match) throw new Error(`not a data block: ${out}`);
  return JSON.parse(match[1]);
}

interface Fixture {
  query: string;
  data: unknown;
  /** Every money value in `data`, as integer paise. */
  moneyPaise: number[];
  /** The numbers as they sit in `data` (paise or rupees): none may reach the model bare. */
  raw: number[];
  /** Counts and other non-money numbers that must stay plain numbers. */
  counts?: number[];
}

const R = (rupees: number) => Math.round(rupees * 100);

const FIXTURES: Fixture[] = [
  {
    query: "finance.termCollectionSummary",
    data: { termId: "t1", invoiceCount: 3024, duePaise: 5_893_874_000, collectedPaise: 2_963_535_000 },
    moneyPaise: [5_893_874_000, 2_963_535_000],
    raw: [5_893_874_000, 2_963_535_000],
    counts: [3024],
  },
  {
    // Rupees, not paise: the call behind the production answer.
    query: "finance.collectionReport",
    data: [{ groupKey: "g5", groupLabel: "Grade 5", invoiceCount: 3024, paymentCount: 1640, billed: 58_938_740, collected: 29_635_350, reversed: 0.5, outstanding: 29_303_389.5 }],
    moneyPaise: [R(58_938_740), R(29_635_350), R(0.5), R(29_303_389.5)],
    raw: [58_938_740, 29_635_350, 0.5, 29_303_389.5],
    counts: [3024, 1640],
  },
  {
    query: "finance.listDefaulters",
    data: [{ studentId: "s1", studentName: "A", invoiceId: "i1", invoiceNo: "INV-1", total: 25_000, paidTotal: 10_000.5, outstanding: 14_999.5, dueOn: "2026-10-01", onPlan: false }],
    moneyPaise: [R(25_000), R(10_000.5), R(14_999.5)],
    raw: [25_000, 10_000.5, 14_999.5],
  },
  {
    query: "finance.listInvoices",
    data: [{ id: "i1", invoiceNo: "INV-1", studentId: "s1", studentName: "A", status: "issued", total: 25_000, paidTotal: 7_500.25, dueOn: null }],
    moneyPaise: [R(25_000), R(7_500.25)],
    raw: [25_000, 7_500.25],
  },
  {
    query: "finance.listInvoicesForStudent",
    data: [{ id: "i1", invoiceNo: "INV-1", studentId: "s1", studentName: "A", status: "part_paid", total: 42_000, paidTotal: 21_000, dueOn: null }],
    moneyPaise: [R(42_000), R(21_000)],
    raw: [42_000, 21_000],
  },
  {
    query: "expenses.monthlyTotals",
    data: [{ month: "2026-10", totalPaise: 12_345_600 }],
    moneyPaise: [12_345_600],
    raw: [12_345_600],
  },
  {
    query: "expenses.budgetVsActual",
    data: { from: "2026-04-01", to: "2027-03-31", rows: [{ budgetId: "b", categoryId: "c", categoryName: "Power", periodStart: "2026-04-01", periodEnd: "2027-03-31", budgetPaise: 50_000_000, actualPaise: 55_000_050, overByPaise: 5_000_050 }] },
    moneyPaise: [50_000_000, 55_000_050, 5_000_050],
    raw: [50_000_000, 55_000_050, 5_000_050],
  },
  {
    query: "expenses.list",
    data: { rows: [{ id: "e", categoryId: "c", categoryName: "Power", amountPaise: 1_234_550, spentOn: "2026-10-02", description: "Bill", payee: null, reversesExpenseId: null }], total: 17, page: 1, pageSize: 25 },
    moneyPaise: [1_234_550],
    raw: [1_234_550],
    counts: [17, 25],
  },
  {
    query: "canteen.items",
    data: [{ id: "c1", name: "Idli", pricePaise: 2_550, isActive: true }],
    moneyPaise: [2_550],
    raw: [2_550],
  },
  {
    query: "canteen.daySales",
    data: { date: "2026-11-11", salesPaise: 1_250_050, purchaseCount: 412, topupPaise: 300_000, topupCount: 9, byItem: [{ itemId: "c1", name: "Idli", quantity: 40, amountPaise: 102_000 }] },
    moneyPaise: [1_250_050, 300_000, 102_000],
    raw: [1_250_050, 300_000, 102_000],
    counts: [412, 9, 40],
  },
  {
    query: "payroll.runs",
    data: [{ id: "r", month: "2026-10", status: "finalized", finalizedAt: null, payslipCount: 64, grossPaise: 1_500_000_000, netPaise: 1_350_000_000 }],
    moneyPaise: [1_500_000_000, 1_350_000_000],
    raw: [1_500_000_000, 1_350_000_000],
    counts: [64],
  },
  {
    query: "payroll.monthlyCost",
    data: [{ month: "2026-10", staffCount: 64, grossPaise: 1_500_000_000, netPaise: 1_350_000_000 }],
    moneyPaise: [1_500_000_000, 1_350_000_000],
    raw: [1_500_000_000, 1_350_000_000],
    counts: [64],
  },
  {
    query: "scholarships.summary",
    data: { byStatus: { approved: 12 }, byRule: [{ label: "Sibling", count: 12, amountPaise: 6_000_000 }], byGrade: [{ label: "Grade 5", count: 3, amountPaise: 1_500_000 }] },
    moneyPaise: [6_000_000, 1_500_000],
    raw: [6_000_000, 1_500_000],
    counts: [12, 3],
  },
  {
    query: "scholarships.rules",
    data: [{ id: "r", name: "Sibling", criteria: null, percent: null, amountPaise: 500_000, isActive: true }, { id: "r2", name: "Merit", criteria: null, percent: 10, amountPaise: null, isActive: true }],
    moneyPaise: [500_000],
    raw: [500_000],
    counts: [10],
  },
  {
    query: "feePlans.lateFeeRules",
    data: [{ feeStructureId: "f", feeStructureName: "G5", gradeName: "Grade 5", academicYearId: "y", rule: { id: "l", kind: "per_day", amount: 50, graceDays: 7, cap: 500, isActive: true } }],
    moneyPaise: [R(50), R(500)],
    raw: [50, 500],
    counts: [7],
  },
  {
    query: "feePlans.instalments",
    data: { invoiceId: "i", invoiceNo: "INV-1", total: 60_000, paidTotal: 20_000.5, parts: [{ seq: 1, dueOn: "2026-07-01", amount: 30_000, paidAmount: 20_000.5, status: "part_paid" }], lateFees: [{ chargeDate: "2026-07-09", unitSeq: 1, daysLate: 8, amount: 150 }] },
    moneyPaise: [R(60_000), R(20_000.5), R(30_000), R(150)],
    raw: [60_000, 20_000.5, 30_000, 150],
    counts: [8],
  },
  {
    // fineSoFar is integer paise with no unit in its name.
    query: "library.overdue",
    data: [{ accessionNo: "A1", title: "Book", borrowerKind: "student", borrowerId: "b", borrowerName: "A", borrowerRef: "5A", issuedOn: "2026-10-01", dueOn: "2026-10-15", daysOverdue: 27, fineSoFar: 13_500 }],
    moneyPaise: [13_500],
    raw: [13_500],
    counts: [27],
  },
  {
    // ...while a loan's fine is rupees.
    query: "library.myLoans",
    data: [{ title: "Book", accessionNo: "A1", issuedOn: "2026-10-01", dueOn: "2026-10-15", returnedOn: null, renewCount: 1, daysOverdue: 27, fine: 135 }],
    moneyPaise: [R(135)],
    raw: [135],
    counts: [27],
  },
  {
    query: "lab.feeRisk",
    data: [{ grade_id: "g", grade: "Grade 5", attendance_band: "<75%", students: 31, invoices: 31, overdue_invoices: 12, overdue_paise: 12_345_600, avg_days_overdue: 18 }],
    moneyPaise: [12_345_600],
    raw: [12_345_600],
    counts: [31, 12, 18],
  },
  {
    query: "forecasts.cards",
    data: [
      { metric: "Attendance Rate", current: 91.5, forecast: 92, unit: "pct", confidence: 0.8, direction: "up" },
      { metric: "Fee Collection", current: 2_963_535_000, forecast: 3_000_000_000, unit: "paise", confidence: 0.7, direction: "up" },
    ],
    moneyPaise: [2_963_535_000, 3_000_000_000],
    raw: [2_963_535_000, 3_000_000_000],
    counts: [91.5, 92],
  },
  {
    query: "insights.list",
    data: [{ id: "x", title: "Overdue fees grew", evidence: [{ label: "Overdue now", value: 29_303_390, unit: "₹" }, { label: "Growth", value: 12, unit: "%" }, { label: "Overdue invoices", value: 214 }] }],
    moneyPaise: [R(29_303_390)],
    raw: [29_303_390],
    counts: [12, 214],
  },
];

afterEach(() => vi.restoreAllMocks());

describe("money in read-tool results reaches the model as rupee text", () => {
  it.each(FIXTURES)("$query", async ({ query, data, moneyPaise, raw, counts = [] }) => {
    fakeQuery(query, data);
    const { tools } = await buildReadTools(ctx, { [query]: "fixture" }, NONCE);
    const out = await run(tools, query.replace(/\./g, "_"));
    const leaves = numericLeaves(payloadOf(out));

    for (const paise of moneyPaise) {
      expect(out).toContain(`"${formatINR(paise)}"`);
      // Neither 100x too small nor 100x too large anywhere in the result.
      expect(out).not.toContain(`"${formatINR(Math.round(paise / 100))}"`);
      expect(out).not.toContain(`"${formatINR(paise * 100)}"`);
    }
    for (const n of raw) expect(leaves).not.toContain(n);
    for (const n of counts) expect(leaves).toContain(n);
    expect(out).not.toMatch(/paise/i);
  });

  it("a finance agent's tool returns the same rupee text (agents and workflow agent steps)", async () => {
    fakeQuery("finance.collectionReport", FIXTURES[1].data);
    const { tools } = await buildAgentTools(ctx, "finance", createProposalSink(), NONCE);
    const out = await run(tools, "finance_collectionReport");
    expect(out).toContain('"collected":"₹2,96,35,350"');
    expect(out).toContain('"billed":"₹5,89,38,740"');
  });
});

describe("formatted amounts survive the chat pipeline unchanged", () => {
  const answer = "Collected ₹2,96,35,350 of ₹5,89,38,740 due; ₹2,93,03,390.50 outstanding.";

  it("the plain-text cleaner leaves rupee text alone", () => {
    expect(plainChatText("₹2,96,35,350")).toBe("₹2,96,35,350");
    expect(plainChatText(answer)).toBe(answer);
  });

  it("redaction leaves rupee text alone", () => {
    expect(redact("₹2,96,35,350")).toEqual({ text: "₹2,96,35,350", count: 0 });
    expect(redact(answer).text).toBe(answer);
  });

  it("the system prompt says copy amounts as given, never convert paise", () => {
    const prompt = systemPromptFor({ role: "principal", nonce: "n", mode: "cloud", capabilities: [], instructions: "" });
    expect(prompt).not.toMatch(/paise/i);
    expect(prompt).toMatch(/copy them exactly/i);
  });
});
