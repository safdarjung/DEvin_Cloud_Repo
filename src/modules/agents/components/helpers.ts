// Pure UI helpers for the agents workspace (no server-only imports).
import type { AgentRunStatus, RiskClass } from "@/modules/fabric/types";

export const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Awaiting approval",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
};

export const RISK_LABEL: Record<RiskClass, string> = {
  read_only: "Read only",
  low_risk_reversible: "Low risk, reversible",
  user_confirmed: "Needs requester or approver sign-off",
  human_approved: "Needs owner/principal approval",
  prohibited: "Prohibited",
};

// Plain-language approval tag per action risk, shown next to each "Can suggest" item
// (RISK_LABEL above stays for the card's single "Highest risk" summary line).
export const APPROVAL_TAG: Record<RiskClass, string> = {
  read_only: "just looks, never changes anything",
  low_risk_reversible: "runs automatically, can be undone",
  user_confirmed: "you confirm",
  human_approved: "needs principal approval",
  prohibited: "never runs",
};

export type RunBadgeVariant = "warning" | "success" | "destructive" | "secondary" | "info";

export function runStatusVariant(s: AgentRunStatus): RunBadgeVariant {
  switch (s) {
    case "awaiting_approval":
      return "warning";
    case "done":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "info";
    default:
      return "secondary";
  }
}

/** Paise to rupees, e.g. 12345 -> "₹123.45". */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function runHref(base: string, runId?: string): string {
  return runId ? `${base}?run=${encodeURIComponent(runId)}` : base;
}

const dtFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dtFmt.format(d);
}
