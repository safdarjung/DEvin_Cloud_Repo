// T-020 — the recheck request state machine (06 §W8), as a pure function so
// the UI (RecheckQueue/RecheckDecisionForm) and `tests/unit/recheck-state.
// test.ts` can assert it without a database. The real, authoritative gate
// is `app.guard_recheck_request_status` (20261028000022_recheck_rpcs.sql,
// BEFORE UPDATE on `recheck_requests`) — this table must stay in sync with
// that trigger's transition list; a mismatch is a bug in one of the two,
// caught by this file's test, not by a guardian hitting it in prod.
export type RecheckStatus = "submitted" | "under_review" | "approved" | "rejected" | "applied";

export const RECHECK_STATUSES: readonly RecheckStatus[] = ["submitted", "under_review", "approved", "rejected", "applied"];

const ALLOWED_TRANSITIONS: Readonly<Record<RecheckStatus, readonly RecheckStatus[]>> = {
  submitted: ["under_review"],
  under_review: ["approved", "rejected", "applied"],
  approved: [],
  rejected: [],
  applied: [],
};

export function isRecheckTransitionAllowed(from: RecheckStatus, to: RecheckStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** "submitted"/"under_review" — the one-open-request partial unique index (0009) keys on exactly these two. */
export function isRecheckRequestOpen(status: RecheckStatus): boolean {
  return status === "submitted" || status === "under_review";
}
