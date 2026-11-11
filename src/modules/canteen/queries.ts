import "server-only";
// Features-18 #10 — canteen reads. Always the signed-in user's RLS client:
// staff (canteen.manage roles) see the institution, a guardian sees linked
// children, a student sees self, everyone else sees no ledger rows. The
// balance is only ever canteen_balance() — never stored or summed here.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { startOfDayInTimezone } from "@/lib/ai/usage";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { CanteenDaySalesInput, CanteenItemListInput } from "./schemas";

const HISTORY_LIMIT = 50;
// shortcut: a day's rows are summed in TS (PostgREST aggregates are off), capped at
// DAY_ROW_CAP; move to a SQL summary function if one canteen ever sells more in a day.
const DAY_ROW_CAP = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CanteenItem {
  id: string;
  name: string;
  pricePaise: number;
  isActive: boolean;
}

export interface CanteenTransaction {
  id: string;
  kind: "topup" | "purchase";
  /** Signed: top-up > 0, purchase < 0. */
  amountPaise: number;
  itemName: string | null;
  quantity: number | null;
  note: string | null;
  createdAt: string;
}

export interface CanteenStatement {
  balancePaise: number;
  transactions: CanteenTransaction[];
}

export interface CanteenDaySales {
  date: string;
  salesPaise: number;
  purchaseCount: number;
  topupPaise: number;
  topupCount: number;
  byItem: { itemId: string; name: string; quantity: number; amountPaise: number }[];
}

function institutionTimezone(ctx: TenantContext): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  return locale.success ? locale.data.timezone : "Asia/Kolkata";
}

export function canteenToday(ctx: TenantContext): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: institutionTimezone(ctx) }).format(new Date());
}

export async function canteenItems(ctx: TenantContext, input: CanteenItemListInput = {}): Promise<CanteenItem[]> {
  const supabase = await createClient();
  let builder = supabase
    .from("canteen_items")
    .select("id, name, price_paise, is_active")
    .eq("institution_id", ctx.institution.id)
    .order("name", { ascending: true });
  if (!input.includeInactive) builder = builder.eq("is_active", true);
  const { data, error } = await builder;
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, pricePaise: r.price_paise, isActive: r.is_active }));
}

export async function canteenStatement(ctx: TenantContext, studentId: string): Promise<CanteenStatement> {
  const supabase = await createClient();
  const [balance, history] = await Promise.all([
    supabase.rpc("canteen_balance", { p_institution_id: ctx.institution.id, p_student_id: studentId }),
    supabase
      .from("canteen_transactions")
      .select("id, kind, amount_paise, quantity, note, created_at, canteen_items(name)")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (balance.error) throw balance.error;
  if (history.error) throw history.error;

  return {
    balancePaise: Number(balance.data ?? 0),
    transactions: (history.data ?? []).map((r) => ({
      id: r.id,
      kind: r.kind as CanteenTransaction["kind"],
      amountPaise: r.amount_paise,
      itemName: r.canteen_items?.name ?? null,
      quantity: r.quantity,
      note: r.note,
      createdAt: r.created_at,
    })),
  };
}

/** Totals for one institution-local day (default today): sales by item and simulated top-ups. Name-free. */
export async function canteenDaySales(ctx: TenantContext, input: CanteenDaySalesInput): Promise<CanteenDaySales> {
  const timeZone = institutionTimezone(ctx);
  const date = input.date ?? canteenToday(ctx);
  const start = startOfDayInTimezone(timeZone, new Date(`${date}T12:00:00Z`));
  const end = new Date(start.getTime() + DAY_MS);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canteen_transactions")
    .select("kind, amount_paise, item_id, quantity, canteen_items(name)")
    .eq("institution_id", ctx.institution.id)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .limit(DAY_ROW_CAP);
  if (error) throw error;

  const summary: CanteenDaySales = { date, salesPaise: 0, purchaseCount: 0, topupPaise: 0, topupCount: 0, byItem: [] };
  const byItem = new Map<string, CanteenDaySales["byItem"][number]>();
  for (const r of data ?? []) {
    if (r.kind === "topup") {
      summary.topupPaise += r.amount_paise;
      summary.topupCount += 1;
      continue;
    }
    summary.salesPaise -= r.amount_paise;
    summary.purchaseCount += 1;
    const itemId = r.item_id as string;
    const line = byItem.get(itemId) ?? { itemId, name: r.canteen_items?.name ?? "Item", quantity: 0, amountPaise: 0 };
    byItem.set(itemId, { ...line, quantity: line.quantity + (r.quantity ?? 0), amountPaise: line.amountPaise - r.amount_paise });
  }
  summary.byItem = [...byItem.values()].sort((x, y) => y.amountPaise - x.amountPaise);
  return summary;
}
