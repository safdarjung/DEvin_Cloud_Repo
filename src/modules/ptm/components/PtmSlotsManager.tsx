"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnimatedList } from "@/components/widgets/viz";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { addPtmSlots, removePtmSlot } from "@/modules/ptm/actions";
import type { PtmScheduleRow } from "@/modules/ptm/queries";
import { PtmBriefButton } from "@/modules/ai/components/PtmBriefButton";

/** A teacher's own slots for one published PTM event: add a time range, remove a slot, see who booked. */
export function PtmSlotsManager({
  institutionSlug,
  eventId,
  dayStartsAt,
  dayEndsAt,
  slots,
  canBrief = false,
}: {
  institutionSlug: string;
  eventId: string;
  dayStartsAt: string;
  dayEndsAt: string;
  slots: PtmScheduleRow[];
  /** features-18 §C: ptm_brief capability on for this role. */
  canBrief?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(dayStartsAt);
  const [to, setTo] = useState(dayEndsAt);
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    start(async () => {
      const result = await addPtmSlots(institutionSlug, { eventId, from, to });
      if (!result.ok) {
        const message = actionErrorMessage(result.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(result.data.added === 0 ? "Those slots already exist" : `Added ${result.data.added} slot${result.data.added === 1 ? "" : "s"}`);
      router.refresh();
    });
  }

  function remove(slot: PtmScheduleRow) {
    start(async () => {
      const result = await removePtmSlot(institutionSlug, { slotId: slot.slotId });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success(`Removed ${slot.startsAt} slot`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="space-y-1 text-xs text-muted-foreground">
          From
          <Input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} className="tabular-nums" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          To
          <Input type="time" required value={to} onChange={(e) => setTo(e.target.value)} className="tabular-nums" />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add slots"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no slots for this meeting yet. Add a time range above to open bookings.</p>
      ) : (
        <AnimatedList className="space-y-0 divide-y" ariaLabel="My slots">
          {slots.map((s) => (
            <div key={s.slotId} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
              <span className="tabular-nums">
                {s.startsAt} to {s.endsAt}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {s.booking ? (
                  <span className="truncate">
                    {s.booking.studentName} <span className="text-xs text-muted-foreground">{s.booking.sectionName}</span>
                  </span>
                ) : (
                  <Badge variant="outline">Open</Badge>
                )}
                {s.booking && canBrief && (
                  <PtmBriefButton institutionSlug={institutionSlug} studentId={s.booking.studentId} studentName={s.booking.studentName} />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(s)}
                  disabled={pending || s.booking !== null}
                  title={s.booking ? "Booked slots can't be removed here; the parent's booking would be deleted" : undefined}
                >
                  Remove
                </Button>
              </span>
            </div>
          ))}
        </AnimatedList>
      )}
    </div>
  );
}
