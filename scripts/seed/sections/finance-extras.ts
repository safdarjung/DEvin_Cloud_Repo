import { createHash } from "node:crypto";
import type { SeedContext } from "../lib/context.ts";
import { asUser, demoUsers, fakeJob, isoDay } from "../lib/util.ts";
import { feeReminder } from "../../../src/modules/jobs/handlers/finance.fee_reminder.ts";

// Everything here goes through the code that owns the table, never around it:
// fee_reminders: the real `finance.fee_reminder` handler (invoice-list mode), which also creates
//   the notifications and delivery attempts. Only invoices whose primary guardian has a portal
//   login are reminded, so volume follows the number of guardian accounts in the tenant.
// payment_reversals: `void_payment` as the principal (writes the reversal, ledger entries, audit).
// online_payment_intents: `create_payment_intent` as the accountant (simulated provider), then
//   `record_online_payment` for the paid ones; the unreconciled ones had the invoice settled at the
//   counter first, so the late online capture has nowhere to land.
// late_fee_charges: not seeded here; fee-plans' engine already fills it (apply_late_fees sweeps
//   every overdue invoice and edits invoice totals, so a direct insert would corrupt them).
// Each part is skipped on rerun once its own marker rows exist, because these calls change
// invoice status and a second pass would pick different invoices.

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const REMINDER_OFFSETS = [-28, -21, -14, -7, -2];

/** Invoices of students with no guardian login: safe to settle/reverse without touching the named demo families. */
const NON_DEMO = (inst: string) => `
  i.institution_id = '${inst}' and not exists (
    select 1 from public.guardian_students gs
    join public.memberships m on m.guardian_id = gs.guardian_id and m.role = 'guardian'
    where gs.student_id = i.student_id)`;

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const accountant = users["accountant"]!;
  const principal = users["principal"]!;

  // ---- fee_reminders ----
  const [{ n: existingReminders }] = await ctx.sql<{ n: number }[]>`select count(*)::int as n from public.fee_reminders where institution_id = ${inst}`;
  if (existingReminders === 0) {
    const candidates = await ctx.sql<{ id: string }[]>`
      select i.id from public.invoices i
      join public.guardian_students gs on gs.student_id = i.student_id and gs.is_primary
      join public.memberships m on m.guardian_id = gs.guardian_id and m.role = 'guardian' and m.status = 'active'
      where i.institution_id = ${inst} and i.status in ('issued', 'part_paid') and i.due_on < current_date
      order by i.id limit 200`;
    const ids = candidates.map((c) => c.id);
    for (const offset of REMINDER_OFFSETS) {
      if (ids.length === 0) break;
      const asOf = isoDay(offset);
      await feeReminder(fakeJob("finance.fee_reminder", inst, { invoice_ids: ids, as_of: asOf }, `fee_reminders:seed:${asOf}`), { admin: ctx.admin });
    }
  }

  // ---- online_payment_intents ----
  const [{ n: existingIntents }] = await ctx.sql<{ n: number }[]>`
    select count(*)::int as n from public.online_payment_intents where institution_id = ${inst} and idempotency_key like 'seed-intent:%'`;
  if (existingIntents === 0) {
    const open = await ctx.sql.unsafe<{ id: string; outstanding: string }[]>(
      `select i.id, (i.total - i.paid_total)::text as outstanding from public.invoices i
       where ${NON_DEMO(inst)} and i.status in ('issued', 'part_paid') and i.total - i.paid_total >= 100
       order by i.id limit 12`,
    );
    const states = ["created", "created", "created", "created", "created", "created", "paid", "paid", "paid", "paid", "unreconciled", "unreconciled"] as const;
    for (const [i, inv] of open.entries()) {
      const state = states[i]!;
      const outstanding = Number(inv.outstanding);
      const amount = state === "created" ? Math.max(1, Math.floor(outstanding / 2)) : outstanding;
      const key = `seed-intent:${i}`;
      const orderId = `sim_order_${md5(key)}`;
      await asUser(ctx.sql, accountant, async (tx) => {
        await tx`select public.create_payment_intent(${inv.id}::uuid, ${amount}::numeric, 'simulated', ${orderId}, ${key})`;
        if (state === "unreconciled") {
          await tx`select public.record_payment(${inv.id}::uuid, ${outstanding}::numeric, 'cash', 'Settled at counter', now(), ${`seed-counter:${i}`})`;
        }
      });
      if (state !== "created") {
        await ctx.sql`select public.record_online_payment(${orderId}, ${`sim_pay_${md5(`pay${key}`).slice(0, 14)}`}, ${Math.round(amount * 100)}::bigint, 'upi')`;
      }
    }
  }

  // ---- payment_reversals ----
  const [{ n: existingReversals }] = await ctx.sql<{ n: number }[]>`
    select count(*)::int as n from public.payment_reversals where institution_id = ${inst} and idempotency_key like 'seed-reversal:%'`;
  if (existingReversals === 0) {
    const pay = async (mode: string, limit: number, offset: number) =>
      ctx.sql.unsafe<{ id: string }[]>(
        `select p.id from public.payments p join public.invoices i on i.id = p.invoice_id
         join public.receipts r on r.payment_id = p.id
         where ${NON_DEMO(inst)} and p.mode ${mode} and i.status <> 'cancelled'
           and not exists (select 1 from public.payment_reversals pr where pr.payment_id = p.id)
           and not exists (select 1 from public.online_payment_intents oi where oi.payment_id = p.id)
         order by p.id limit ${limit} offset ${offset}`,
      );
    const cheques = await pay("= 'cheque'", 4, 0);
    const others = await pay("<> 'cheque'", 8, 0);
    const plan: { id: string; kind: "void" | "refund" | "cheque_bounce"; reason: string }[] = [
      ...cheques.map((p) => ({ id: p.id, kind: "cheque_bounce" as const, reason: "Cheque returned by bank: insufficient funds." })),
      ...others.slice(0, 4).map((p) => ({ id: p.id, kind: "void" as const, reason: "Entered against the wrong invoice by the counter." })),
      ...others.slice(4).map((p) => ({ id: p.id, kind: "refund" as const, reason: "Duplicate payment received; refunded to the parent." })),
    ];
    for (const [i, p] of plan.entries()) {
      await asUser(ctx.sql, principal, (tx) => tx`select public.void_payment(${p.id}::uuid, ${p.kind}, ${p.reason}, ${`seed-reversal:${i}`})`);
    }
  }
}
