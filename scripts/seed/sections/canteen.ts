import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #10 — demo canteen: 15 menu items (one off sale) and a
// 40-row ledger for 8 students (Aarav + Ananya, guardian.one's children,
// plus 3 more from each of VI-A / X-A). No ctx.rng draws, fixed uuidV5 ids.
// Dates are the last 5 school days up to the run date (IST) so "today" on
// the counter's day-sales card always has data. Rows are inserted with the
// service role (the definers are for real users); every purchase keeps the
// kind_shape check (amount = -(quantity * unit price)) and the running
// balance never goes negative — asserted below.

const ITEMS: { name: string; pricePaise: number; isActive?: boolean }[] = [
  { name: "Samosa", pricePaise: 1500 },
  { name: "Veg sandwich", pricePaise: 3000 },
  { name: "Idli (2 pcs)", pricePaise: 2500 },
  { name: "Masala dosa", pricePaise: 4000 },
  { name: "Poha", pricePaise: 2000 },
  { name: "Veg puff", pricePaise: 1800 },
  { name: "Paneer roll", pricePaise: 4500 },
  { name: "Lemon rice", pricePaise: 3500 },
  { name: "Banana", pricePaise: 800 },
  { name: "Fruit cup", pricePaise: 3000 },
  { name: "Sweet lassi", pricePaise: 2500 },
  { name: "Buttermilk", pricePaise: 1500 },
  { name: "Flavoured milk", pricePaise: 2000 },
  { name: "Veg biryani", pricePaise: 6000 },
  { name: "Cola (300 ml)", pricePaise: 2500, isActive: false }, // off sale: healthy-canteen policy
];

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** Last `count` Mon-Sat dates ending at `endIso` (inclusive), oldest first. */
function lastSchoolDays(endIso: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${endIso}T00:00:00Z`);
  while (days.length < count) {
    if (cursor.getUTCDay() !== 0) days.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

function byFirstName(a: { firstName: string }, b: { firstName: string }): number {
  return a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase());
}

export async function run(ctx: SeedContext): Promise<void> {
  const recordedBy = ctx.userIdByLogin["accountant"]!;
  const viA = [...ctx.studentsBySection["VI-A"]!].sort(byFirstName);
  const xA = [...ctx.studentsBySection["X-A"]!].sort(byFirstName);
  const named = [viA.find((s) => s.firstName === "Aarav")!, xA.find((s) => s.firstName === "Ananya")!];
  const others = [...viA, ...xA].filter((s) => !named.includes(s));
  const students = [...named, ...others.slice(0, 3), ...others.slice(-3)];

  const itemRows = ITEMS.map((item) => ({
    id: uuidV5("canteen", `item:${item.name}`),
    institution_id: ctx.institutionId,
    name: item.name,
    price_paise: item.pricePaise,
    is_active: item.isActive ?? true,
  }));
  await insertBatch(ctx.admin, "canteen_items", itemRows);
  const onSale = itemRows.filter((i) => i.is_active);

  const days = lastSchoolDays(todayIST(), 5);
  const txRows: Record<string, unknown>[] = [];
  students.forEach((student, i) => {
    const topupPaise = 50_000 + (i % 3) * 10_000; // ₹500 / ₹600 / ₹700
    let balance = topupPaise;
    txRows.push({
      id: uuidV5("canteen", `tx:${student.id}:topup`),
      institution_id: ctx.institutionId,
      student_id: student.id,
      kind: "topup",
      amount_paise: topupPaise,
      note: "Cash at office",
      recorded_by: recordedBy,
      created_at: `${days[0]}T08:15:00+05:30`,
    });
    days.slice(1).forEach((day, k) => {
      const item = onSale[(i * 3 + k) % onSale.length]!;
      const quantity = (i + k) % 3 === 0 ? 2 : 1;
      const amount = quantity * item.price_paise;
      balance -= amount;
      if (balance < 0) throw new Error(`canteen seed would overdraw student ${student.id}`);
      txRows.push({
        id: uuidV5("canteen", `tx:${student.id}:${k}`),
        institution_id: ctx.institutionId,
        student_id: student.id,
        kind: "purchase",
        amount_paise: -amount,
        item_id: item.id,
        quantity,
        unit_price_paise: item.price_paise,
        recorded_by: recordedBy,
        created_at: `${day}T10:${String(30 + i * 2).padStart(2, "0")}:00+05:30`,
      });
    });
  });
  await insertBatch(ctx.admin, "canteen_transactions", txRows);
}
