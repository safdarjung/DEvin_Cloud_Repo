"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { approveStudentLeave, rejectStudentLeave } from "@/modules/student-leave/actions";

export interface PendingLeave {
  id: string;
  studentName: string;
  classSection: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
}

const dateLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (iso: string) => dateLabel.format(new Date(`${iso}T00:00:00Z`));

/** Pending student leave requests with approve and reject (reject asks for confirmation and an optional note). */
export function StudentLeaveReview({ institutionSlug, requests }: { institutionSlug: string; requests: PendingLeave[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState<PendingLeave | null>(null);
  const [note, setNote] = useState("");

  function decide(leave: PendingLeave, approve: boolean) {
    start(async () => {
      const result = approve
        ? await approveStudentLeave(institutionSlug, { leaveId: leave.id })
        : await rejectStudentLeave(institutionSlug, { leaveId: leave.id, ...(note.trim() ? { note: note.trim() } : {}) });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success(`${approve ? "Approved" : "Rejected"} leave for ${leave.studentName}`);
      setRejecting(null);
      setNote("");
      router.refresh();
    });
  }

  if (requests.length === 0) return <EmptyState title="No leave requests waiting" />;

  return (
    <>
      <ul className="divide-y">
        {requests.map((r) => (
          <li key={r.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {r.studentName} <span className="text-xs font-normal text-muted-foreground">{r.classSection}</span>
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} to ${fmt(r.endDate)}`} · {r.days} day{r.days === 1 ? "" : "s"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{r.reason}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide(r, true)} disabled={pending}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNote("");
                  setRejecting(r);
                }}
                disabled={pending}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this leave request?</DialogTitle>
            <DialogDescription>
              {rejecting?.studentName} ({rejecting?.classSection}) will be marked as not approved. Add a note so the family knows why.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} maxLength={500} placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => rejecting && decide(rejecting, false)}>
              {pending ? "Rejecting…" : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
