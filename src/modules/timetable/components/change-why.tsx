// 0141 — "Why?" on a changed period or substitution: the latest reason, who
// and when, before -> after, and Undo for managers. A native <details>, so it
// works without JS and inside the scrolling grid.
import { Badge } from "@/components/ui/badge";
import { changeText, type ChangeRow } from "@/modules/timetable/control.queries";
import { ruleLabel } from "@/modules/timetable/suggest";
import { UndoButton } from "./control-forms";

const KIND_LABEL: Record<string, string> = {
  manual: "Manual edit",
  suggestion: "Suggestion applied",
  substitution: "Substitution",
  rollback: "Undo",
  restore: "Restore",
  publish: "Published",
  rules: "Rules",
};

export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** The body shared by the popover and the Changes list. */
export function ChangeDetail({ change, slug, timeZone, canUndo }: { change: ChangeRow; slug: string; timeZone: string; canUndo: boolean }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p>
        <span className="font-medium">Why: </span>
        {change.reason}
      </p>
      <p className="text-muted-foreground">{changeText(change)}</p>
      <p className="text-xs text-muted-foreground">
        {kindLabel(change.kind)} by {change.actorName} · {formatWhen(change.createdAt, timeZone)}
        {change.onDate ? ` · for ${change.onDate}` : ""}
      </p>
      {change.rules.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {change.rules.map((r) => (
            <Badge key={r} variant="secondary">
              {ruleLabel(r)}
            </Badge>
          ))}
        </div>
      )}
      {canUndo && <UndoButton slug={slug} changeId={change.id} />}
    </div>
  );
}

export function ChangeWhy({ change, slug, timeZone, canUndo }: { change: ChangeRow; slug: string; timeZone: string; canUndo: boolean }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="inline-flex min-h-6 cursor-pointer items-center rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Why?
      </summary>
      <div className="mt-1 w-56 max-w-full rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-sm">
        <ChangeDetail change={change} slug={slug} timeZone={timeZone} canUndo={canUndo} />
      </div>
    </details>
  );
}
