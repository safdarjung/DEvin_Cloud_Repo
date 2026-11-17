// T-027 — pure transition tables (06 §W4). No DB/IO here so these are unit
// testable in isolation; the SQL functions in
// 20261028000016_admissions_transitions.sql enforce the same rules again at
// the DB layer (defense in depth, same shape as attendance's status codes).

/** `settings.admissions.stages` is a free string[] per institution (05 §4.1); this is the shipped default order, not a closed enum. */
export const DEFAULT_ENQUIRY_STAGES = [
  "new",
  "contacted",
  "visit_scheduled",
  "application_sent",
  "converted",
  "closed",
] as const;

export type EnquiryStage = string;

/** Stages that are no longer open work: counted by "open enquiries" nowhere. */
export const CLOSED_ENQUIRY_STAGES: readonly string[] = ["converted", "closed"];

/** Sum of enquiries still being worked (excludes converted and closed). */
export function countOpenEnquiries(stages: Record<string, number>): number {
  return Object.entries(stages).reduce((sum, [k, n]) => (CLOSED_ENQUIRY_STAGES.includes(k) ? sum : sum + (typeof n === "number" ? n : 0)), 0);
}

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "interaction_scheduled"
  | "offered"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "enrolled";

export type ApplicationDecision = "offer" | "reject" | "accept" | "withdraw";

/**
 * 06 §W4: enquiry stages move freely (including backward) between any two
 * configured stages, EXCEPT that `converted` may never be left once reached,
 * and may only be reached through `convertEnquiryToApplication` (never a
 * plain status update) — both `from` and `to` must be configured stages.
 */
export function canTransitionEnquiry(from: EnquiryStage, to: EnquiryStage, validStages: readonly string[]): boolean {
  if (!validStages.includes(from) || !validStages.includes(to)) return false;
  if (from === to) return false;
  if (from === "converted") return false;
  if (to === "converted") return false;
  return true;
}

interface DecisionRule {
  from: readonly ApplicationStatus[];
  to: ApplicationStatus;
}

// 06 §W4 diagram: offer is reachable from under_review or
// interaction_scheduled; reject only from under_review; accept/withdraw only
// from offered. `enrolled` is reached only via enrolApplicant (T-028), not
// decideApplication, and is intentionally absent here.
const DECISION_RULES: Record<ApplicationDecision, DecisionRule> = {
  offer: { from: ["under_review", "interaction_scheduled"], to: "offered" },
  reject: { from: ["under_review"], to: "rejected" },
  accept: { from: ["offered"], to: "accepted" },
  withdraw: { from: ["offered"], to: "withdrawn" },
};

export function canDecide(from: ApplicationStatus, decision: ApplicationDecision): boolean {
  return DECISION_RULES[decision].from.includes(from);
}

export function nextStatusForDecision(decision: ApplicationDecision): ApplicationStatus {
  return DECISION_RULES[decision].to;
}

/**
 * submitted -> under_review is a plain RLS write (app.guard_application_decision
 * only guards moves INTO offered/accepted/rejected/withdrawn), so no decide RPC:
 * it is what unlocks offer/reject, which require under_review or interaction_scheduled.
 */
export function canStartReview(from: ApplicationStatus): boolean {
  return from === "submitted";
}
