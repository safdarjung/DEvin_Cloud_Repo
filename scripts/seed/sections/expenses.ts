import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #8 — demo expense register (migration 0117). Deterministic, no rng
// draws. Amounts are integer paise. recorded_by is set explicitly: the service-role
// client has no auth.uid(), so the column default would be null.
// Shape: 9 categories (1 inactive), 34 expenses Jun-Nov 2026 + 2 voids (reversing
// rows), 16 budgets (FY 2026-27 per category + Oct/Nov monthly for 4). Fuel is over
// its November budget so the budget view shows an overspend.
const CATEGORIES = [
  "Electricity",
  "Water",
  "Fuel and transport",
  "Repairs and maintenance",
  "Stationery and printing",
  "Housekeeping",
  "Events and functions",
  "Internet and phone",
  "Old canteen supplies",
] as const;
const INACTIVE = 8;

const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"] as const;
// [category, day, base paise, payee, note] — one row per month, base +0..14% by month.
const RECURRING: [number, number, number, string, string][] = [
  [0, 5, 4_250_000, "State Electricity Board", "Monthly electricity bill"],
  [1, 8, 680_000, "Municipal Water Department", "Water charges"],
  [2, 10, 1_875_050, "Sharma Fuels", "Diesel for school buses"],
  [7, 3, 349_900, "JioFiber", "Internet and phone lines"],
];
// [category, date, paise, payee | null, note]
const ONE_OFF: [number, string, number, string | null, string][] = [
  [3, "2026-06-18", 1_250_000, "Gupta Plumbing Works", "Repair of staff-room water line"],
  [3, "2026-08-22", 3_475_000, "Verma Electricals", "Rewiring of science lab"],
  [3, "2026-10-14", 820_000, "Kumar Carpentry", "Desk and bench repairs, class VI"],
  [4, "2026-06-25", 1_560_000, "Saraswati Stationers", "Exam answer sheets"],
  [4, "2026-09-12", 945_050, "Saraswati Stationers", "Printer paper and toner"],
  [5, "2026-07-01", 1_100_000, "CleanCare Services", "Deep cleaning before term"],
  [5, "2026-10-28", 450_000, null, "Cleaning supplies"],
  [6, "2026-08-15", 2_250_000, "Shubh Tent House", "Independence Day stage and chairs"],
  [6, "2026-11-05", 1_800_000, "Shubh Tent House", "Annual day rehearsal setup"],
  [8, "2026-06-10", 275_000, "Agarwal Traders", "Canteen utensils (before canteen module)"],
];
// Indices into the originals list (order: RECURRING by month, then ONE_OFF) voided with a reason.
const VOIDS: [number, string][] = [
  [RECURRING.length * MONTHS.length + 1, "Wrong amount, re-entered with the final invoice"],
  [RECURRING.length * MONTHS.length + 6, "Entered twice by mistake"],
];
const FY = { start: "2026-04-01", end: "2027-03-31" };
const FY_BUDGET_PAISE = [55_000_000, 9_000_000, 22_000_000, 12_000_000, 6_000_000, 4_500_000, 8_000_000, 4_500_000];
// [category, month, paise]
const MONTHLY_BUDGETS: [number, string, number][] = [
  [0, "2026-10", 5_000_000], [0, "2026-11", 5_000_000],
  [1, "2026-10", 750_000], [1, "2026-11", 750_000],
  [2, "2026-10", 2_000_000], [2, "2026-11", 1_500_000],
  [7, "2026-10", 400_000], [7, "2026-11", 400_000],
];
const MONTH_END: Record<string, string> = { "2026-10": "2026-10-31", "2026-11": "2026-11-30" };

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const accountant = ctx.userIdByLogin["accountant"]!;
  const principal = ctx.userIdByLogin["principal"]!;

  const categories = CATEGORIES.map((name, i) => ({ id: uuidV5("expense-category", `${inst}:${i}`), institution_id: inst, name, is_active: i !== INACTIVE }));
  await insertBatch(ctx.admin, "expense_categories", categories);

  const originals = [
    ...RECURRING.flatMap(([cat, day, base, payee, note]) =>
      MONTHS.map((month, m) => ({ cat, spent_on: `${month}-${String(day).padStart(2, "0")}`, amount_paise: base + Math.floor((base * ((m * 7 + cat * 3) % 15)) / 100), payee, note })),
    ),
    ...ONE_OFF.map(([cat, spent_on, amount_paise, payee, note]) => ({ cat, spent_on, amount_paise, payee, note })),
  ].map((e, i) => ({
    id: uuidV5("expense", `${inst}:${i}`),
    institution_id: inst,
    category_id: categories[e.cat]!.id,
    amount_paise: e.amount_paise,
    spent_on: e.spent_on,
    description: e.note,
    payee: e.payee,
    recorded_by: accountant,
  }));
  await insertBatch(ctx.admin, "expenses", originals);

  // Reversing rows exactly as public.void_expense writes them.
  const reversals = VOIDS.map(([idx, reason], i) => {
    const o = originals[idx]!;
    return { ...o, id: uuidV5("expense-void", `${inst}:${i}`), amount_paise: -o.amount_paise, description: reason, reverses_expense_id: o.id, recorded_by: principal };
  });
  await insertBatch(ctx.admin, "expenses", reversals);

  const budgets = [
    ...FY_BUDGET_PAISE.map((amount_paise, cat) => ({ cat, period_start: FY.start, period_end: FY.end, amount_paise })),
    ...MONTHLY_BUDGETS.map(([cat, month, amount_paise]) => ({ cat, period_start: `${month}-01`, period_end: MONTH_END[month]!, amount_paise })),
  ].map((b, i) => ({
    id: uuidV5("expense-budget", `${inst}:${i}`),
    institution_id: inst,
    category_id: categories[b.cat]!.id,
    period_start: b.period_start,
    period_end: b.period_end,
    amount_paise: b.amount_paise,
  }));
  await insertBatch(ctx.admin, "budgets", budgets);
}
