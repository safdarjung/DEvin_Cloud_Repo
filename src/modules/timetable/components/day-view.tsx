// 0141 — dynamic day: the regular periods for one section or teacher on a
// date, overlaid with substitutions, calendar holidays/exam weeks and edits to
// the published timetable — each with its reason, and Undo for managers.
import { Badge } from "@/components/ui/badge";
import type { DayOverlay, DayView } from "@/modules/timetable/control.queries";
import { formatWhen } from "./change-why";
import { UndoButton } from "./control-forms";

const OVERLAY_TONE: Record<DayOverlay["kind"], "warning" | "info" | "destructive" | "secondary"> = {
  substitution: "warning",
  holiday: "destructive",
  exam: "info",
  event: "secondary",
  changed: "info",
};
const OVERLAY_LABEL: Record<DayOverlay["kind"], string> = {
  substitution: "Substitute",
  holiday: "Holiday",
  exam: "Exam",
  event: "Event",
  changed: "Changed",
};

function Overlay({ o, slug, timeZone }: { o: DayOverlay; slug: string; timeZone: string }) {
  return (
    <div className="mt-1 rounded-md border border-border bg-muted/40 p-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant={OVERLAY_TONE[o.kind]}>{OVERLAY_LABEL[o.kind]}</Badge>
        <span className="font-medium">{o.text}</span>
      </p>
      <p className="mt-0.5">
        <span className="text-muted-foreground">Reason: </span>
        {o.reason}
      </p>
      {o.who && o.when && (
        <p className="text-xs text-muted-foreground">
          By {o.who} · {formatWhen(o.when, timeZone)}
        </p>
      )}
      {o.undo && o.changeId && (
        <div className="mt-1">
          <UndoButton slug={slug} changeId={o.changeId} label={o.undo === "substitution" ? "Cancel this cover" : "Undo change"} />
        </div>
      )}
    </div>
  );
}

export function DayViewPanel({ view, slug, timeZone }: { view: DayView; slug: string; timeZone: string }) {
  if (!view.scope) return <p className="text-sm text-muted-foreground">Choose a section or a teacher to see their day.</p>;
  const teaching = view.periods.filter((p) => !p.isBreak);
  const anything = teaching.some((p) => p.regular || p.overlays.length > 0);
  return (
    <div className="space-y-3">
      {view.banners.map((b, i) => (
        <div key={i} role="status" className="rounded-md border border-border bg-card p-3 text-sm">
          <Badge variant={OVERLAY_TONE[b.kind]}>{OVERLAY_LABEL[b.kind]}</Badge> <span className="font-medium">{b.text}</span>
          <span className="block text-muted-foreground">Reason: {b.reason}</span>
        </div>
      ))}
      {view.weekday === 0 ? (
        <p className="text-sm text-muted-foreground">Sunday — no school timetable.</p>
      ) : !anything ? (
        <p className="text-sm text-muted-foreground">No periods on this day.</p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border">
          {view.periods.map((p) => (
            <li key={p.seq} className={p.isBreak ? "bg-muted/40 px-3 py-2 text-sm text-muted-foreground" : "px-3 py-2.5"}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-24 shrink-0 text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {p.startsAt}–{p.endsAt}
                </span>
                {!p.isBreak &&
                  (p.regular ? (
                    <span className="text-sm">
                      {p.regular.subject ?? "Period"} · {view.scope?.kind === "teacher" ? p.regular.section : p.regular.teacher}
                      {p.regular.room ? ` · ${p.regular.room}` : ""}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Free</span>
                  ))}
              </div>
              {p.overlays.map((o, i) => (
                <Overlay key={i} o={o} slug={slug} timeZone={timeZone} />
              ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
