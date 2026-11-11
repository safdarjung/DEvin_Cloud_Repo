import { inr } from "@/lib/format";

/** "10%" or "₹5,000" — a rule or award holds exactly one of the two. */
export function concessionValue(percent: number | null, amountPaise: number | null): string {
  return percent != null ? `${percent}%` : inr((amountPaise ?? 0) / 100);
}
