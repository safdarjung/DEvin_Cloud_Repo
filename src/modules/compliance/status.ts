// Compliance status is computed, never stored. Same rule as public.compliance_summary (0130).
export type ComplianceStatus = "overdue" | "due_soon" | "ok";
export const DUE_SOON_DAYS = 30;

const dayNumber = (iso: string): number => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** `dueOn` and `today` are YYYY-MM-DD. Overdue: before today. Due soon: within 30 days, inclusive. */
export function complianceStatus(dueOn: string, today: string): ComplianceStatus {
  const days = dayNumber(dueOn) - dayNumber(today);
  if (days < 0) return "overdue";
  return days <= DUE_SOON_DAYS ? "due_soon" : "ok";
}
