import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import type { AttemptStatus, ReleasePolicy, TestStatus } from "@/modules/online-tests/schemas";

export const TEST_STATUS_LABEL: Record<TestStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  evaluating: "Evaluating",
  published: "Results published",
  cancelled: "Cancelled",
};
export const TEST_STATUS_VARIANT: Record<TestStatus, "secondary" | "warning" | "success" | "outline" | "default" | "info" | "destructive"> = {
  draft: "secondary",
  scheduled: "info",
  open: "success",
  closed: "warning",
  evaluating: "warning",
  published: "default",
  cancelled: "outline",
};
export const ATTEMPT_LABEL: Record<AttemptStatus, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  auto_submitted: "Auto-submitted",
  evaluated: "Evaluated",
};
export const RELEASE_LABEL: Record<ReleasePolicy, string> = {
  never: "Never",
  after_close: "When the test closes",
  after_publish: "When results are published",
};

const dt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
export const fmtDateTime = (iso: string) => dt.format(new Date(iso));
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "-" : String(Math.round(n * 100) / 100));

/** Unwraps an ActionResult; shows one toast and returns null on failure. */
export async function run<T>(result: Promise<ActionResult<T>>): Promise<T | null> {
  const r = await result;
  if (!r.ok) {
    toast.error(actionErrorMessage(r.error));
    return null;
  }
  return r.data;
}

/** Local date-time input value for an ISO instant. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export const SELECT_CLASS = "h-11 w-full rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** The window decides availability (0150): a scheduled test inside opens..closes is open even though its status stays "scheduled". */
export const inWindow = (t: { status: string; opensAt: string; closesAt: string }, now: number) =>
  (t.status === "scheduled" || t.status === "open") && Date.parse(t.opensAt) <= now && now < Date.parse(t.closesAt);
export const effectiveStatus = <T extends { status: TestStatus; opensAt: string; closesAt: string }>(t: T, now: number): TestStatus => (inWindow(t, now) ? "open" : t.status);
export const nowMs = () => Date.now();
