// Free-trial clock: TRIAL_DAYS from the school's created_at. Display only; nothing is locked when it ends.
export const TRIAL_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialStatus = { state: "none" | "ended"; daysLeft: 0 } | { state: "active"; daysLeft: number };

export function trialStatus(createdAt: string | undefined, now = new Date()): TrialStatus {
  const start = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(start)) return { state: "none", daysLeft: 0 };
  const msLeft = start + TRIAL_DAYS * DAY_MS - now.getTime();
  return msLeft <= 0 ? { state: "ended", daysLeft: 0 } : { state: "active", daysLeft: Math.ceil(msLeft / DAY_MS) };
}
