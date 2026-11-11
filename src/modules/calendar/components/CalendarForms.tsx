"use client";

// Calendar controls. Hiding them is UX only: actions re-check academics.manage and the Zod schema.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { deleteCalendarEvent, upsertCalendarEvent } from "@/modules/calendar/actions";
import type { CalendarEventRow } from "@/modules/calendar/queries";
import { CALENDAR_AUDIENCES, CALENDAR_EVENT_KINDS } from "@/modules/calendar/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

export function EventForm({ institutionSlug, years, event }: { institutionSlug: string; years: { id: string; label: string }[]; event?: CalendarEventRow }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({
    academicYearId: years[0]?.id ?? "",
    kind: event?.kind ?? ("event" as CalendarEventRow["kind"]),
    title: event?.title ?? "",
    description: event?.description ?? "",
    startsOn: event?.startsOn ?? "",
    endsOn: event?.endsOn ?? "",
    audience: event?.audience ?? ("all" as CalendarEventRow["audience"]),
  });
  const id = event?.id ?? "new";
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  // Holidays are school-wide (schema rule), so the audience is forced rather than left to fail.
  const audience = f.kind === "holiday" ? "all" : f.audience;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            upsertCalendarEvent(institutionSlug, {
              id: event?.id,
              academicYearId: f.academicYearId,
              kind: f.kind,
              title: f.title,
              description: f.description || undefined,
              startsOn: f.startsOn,
              endsOn: f.endsOn || f.startsOn,
              audience,
            }),
          event ? "Event updated" : "Event added",
          () => !event && setF({ ...f, title: "", description: "", startsOn: "", endsOn: "" }),
        );
      }}
    >
      <div>
        <Label htmlFor={`ek-${id}`}>Type</Label>
        <select id={`ek-${id}`} className={SELECT_CLASS} value={f.kind} onChange={(e) => set({ kind: e.target.value as typeof f.kind })}>
          {CALENDAR_EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`et-${id}`}>Title</Label>
        <Input id={`et-${id}`} value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} className="w-56" />
      </div>
      <div>
        <Label htmlFor={`es-${id}`}>Starts</Label>
        <Input id={`es-${id}`} type="date" value={f.startsOn} onChange={(e) => set({ startsOn: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor={`ee-${id}`}>Ends</Label>
        <Input id={`ee-${id}`} type="date" value={f.endsOn} min={f.startsOn} onChange={(e) => set({ endsOn: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor={`ea-${id}`}>Audience</Label>
        <select id={`ea-${id}`} className={SELECT_CLASS} value={audience} disabled={f.kind === "holiday"} onChange={(e) => set({ audience: e.target.value as typeof f.audience })}>
          {CALENDAR_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {a === "all" ? "Everyone" : "Staff only"}
            </option>
          ))}
        </select>
      </div>
      {years.length > 1 && !event && (
        <div>
          <Label htmlFor={`ey-${id}`}>Academic year</Label>
          <select id={`ey-${id}`} className={SELECT_CLASS} value={f.academicYearId} onChange={(e) => set({ academicYearId: e.target.value })}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="w-full">
        <Label htmlFor={`ed-${id}`}>Details (optional)</Label>
        <Input id={`ed-${id}`} value={f.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !f.title.trim() || !f.startsOn || !f.academicYearId}>
        {event ? "Save" : "Add event"}
      </Button>
    </form>
  );
}

export function DeleteEventButton({ institutionSlug, event }: { institutionSlug: string; event: Pick<CalendarEventRow, "id" | "title"> }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Delete ${event.title}`}
      onClick={() => {
        if (window.confirm(`Delete "${event.title}"?`)) run(() => deleteCalendarEvent(institutionSlug, { id: event.id }), "Event deleted");
      }}
    >
      Delete
    </Button>
  );
}
