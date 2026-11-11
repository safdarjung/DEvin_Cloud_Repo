// A run's recorded steps (status, step name, result note) and its times. Presentational only:
// used by the Runs tab (server) and the Run now / decision result dialogs (client).
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import type { WorkflowRun } from "@/modules/fabric/types";
import { EVENT_PHRASES } from "@/modules/workflows/describe";

// The engine records the trigger kind or event key as the trigger step's note; the label already says it.
const TRIGGER_NOTE: Record<string, string> = { manual: "", schedule: "", ...EVENT_PHRASES };
const noteText = (note?: string): string | undefined => (note !== undefined && Object.hasOwn(TRIGGER_NOTE, note) ? TRIGGER_NOTE[note] : note);

export const RUN_STATUS_VARIANT: Record<string, "success" | "outline" | "destructive" | "secondary"> = {
  done: "success",
  failed: "destructive",
  running: "secondary",
  awaiting_approval: "secondary",
  skipped: "outline",
};

const RUN_STATUS_TEXT: Record<string, string> = { done: "Done", failed: "Failed", running: "Running", awaiting_approval: "Waiting for approval" };
export const runStatusText = (status: string): string => RUN_STATUS_TEXT[status] ?? humanize(status);

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const istTime = (iso: string): string => timeFmt.format(new Date(iso));

export function RunTimes({ startedAt, finishedAt }: { startedAt: string; finishedAt: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      Started {istTime(startedAt)}
      {finishedAt ? ` · finished ${istTime(finishedAt)}` : ""} (IST)
    </p>
  );
}

/** `labels`: node id -> step name from the workflow; `_run` is the run itself (e.g. an invalid graph). */
export function RunSteps({ steps, labels }: { steps: WorkflowRun["steps"]; labels: Record<string, string> }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">No steps recorded yet.</p>;
  return (
    <ol className="space-y-1.5 text-sm">
      {steps.map((s, i) => (
        <li key={`${s.node_id}-${i}`} className="flex flex-wrap items-baseline gap-2">
          <Badge variant={RUN_STATUS_VARIANT[s.status] ?? "outline"}>{runStatusText(s.status)}</Badge>
          <span className="font-medium">{s.node_id === "_run" ? "Run" : labels[s.node_id] ?? s.node_id}</span>
          {noteText(s.note) && <span className="text-muted-foreground">{noteText(s.note)}</span>}
        </li>
      ))}
    </ol>
  );
}
