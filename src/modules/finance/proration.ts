// T-031 — pure mirror of `app.generate_invoice`'s proration math
// (supabase/migrations/20261028000008_finance.sql, 06 §W9, 08 §2) for UI
// preview only. The server never trusts this output — every real invoice
// line comes from `public.generate_invoice`. All amounts in/out are rupees;
// internal arithmetic is integer paise (CLAUDE.md rule 8: no float drift).
// `tests/db/invoice-generation.test.ts` proves this stays in parity with
// the real SQL function on 2-3 cases.

export type FeeFrequency = "one_time" | "annual" | "term" | "quarterly" | "monthly";

export interface ProrationComponent {
  head: string;
  amount: number;
  frequency: FeeFrequency;
}

export interface ProrationConcession {
  head: string | null;
  percent: number | null;
  amount: number | null;
}

export interface ProrationLine {
  head: string;
  amount: number;
  concessionAmount: number;
}

export interface ProrationResult {
  lines: ProrationLine[];
  subtotal: number;
  concessionTotal: number;
  total: number;
}

function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function toRupees(paise: number): number {
  return paise / 100;
}

/** Mirrors `app.generate_invoice`'s `v_multiplier` case statement exactly (not actual month/quarter counts). */
export function multiplierForFrequency(frequency: FeeFrequency, isFirstInvoice: boolean, isTerm1: boolean): number {
  switch (frequency) {
    case "one_time":
      return isFirstInvoice ? 1 : 0;
    case "annual":
      return isTerm1 || isFirstInvoice ? 1 : 0;
    case "term":
      return 1;
    case "quarterly":
      return 2;
    case "monthly":
      return 6;
    default:
      return 0;
  }
}

/**
 * Mirrors the SQL per-head sum:
 * `coalesce(sum(percent is not null ? round(line*percent/100,2) : least(amount, line)), 0)`.
 * shortcut: a concession with a null `head` (whole-invoice) is ignored —
 * same shortcut as `app.generate_invoice`.
 */
function concessionPaiseForHead(lineAmountPaise: number, concessions: ProrationConcession[], head: string): number {
  let total = 0;
  for (const c of concessions) {
    if (c.head !== head) continue;
    if (c.percent != null) {
      total += Math.round((lineAmountPaise * c.percent) / 100);
    } else if (c.amount != null) {
      total += Math.min(toPaise(c.amount), lineAmountPaise);
    }
  }
  return total;
}

/** Mirrors `app.generate_invoice`'s component loop for one student/term. */
export function previewInvoice(
  components: ProrationComponent[],
  concessions: ProrationConcession[],
  isFirstInvoice: boolean,
  isTerm1: boolean,
): ProrationResult {
  let subtotalPaise = 0;
  let concessionTotalPaise = 0;
  const lines: ProrationLine[] = [];

  for (const component of components) {
    const multiplier = multiplierForFrequency(component.frequency, isFirstInvoice, isTerm1);
    if (multiplier === 0) continue;

    const lineAmountPaise = toPaise(component.amount) * multiplier;
    const concessionPaise = concessionPaiseForHead(lineAmountPaise, concessions, component.head);

    lines.push({
      head: component.head,
      amount: toRupees(lineAmountPaise),
      concessionAmount: toRupees(concessionPaise),
    });
    subtotalPaise += lineAmountPaise;
    concessionTotalPaise += concessionPaise;
  }

  return {
    lines,
    subtotal: toRupees(subtotalPaise),
    concessionTotal: toRupees(concessionTotalPaise),
    total: toRupees(subtotalPaise - concessionTotalPaise),
  };
}
