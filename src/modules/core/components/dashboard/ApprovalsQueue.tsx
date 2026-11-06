"use client";

// Approvals queue with inline Approve / Reject for staff and student leave.
// Hiding the buttons is UX only: both actions re-check `leave.approve` /
// `student_leave.approve` server-side and the decide_* SQL functions enforce state.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import { describeActionError } from "@/lib/action-error";
import { approveLeave, rejectLeave } from "@/modules/people/leave.actions";
import { approveStudentLeave, rejectStudentLeave } from "@/modules/student-leave/actions";
import type { ApprovalQueueItem } from "@/modules/core/approval-queue";

export function ApprovalsQueue({
  institutionSlug,
  items,
  total,
  canDecideStaffLeave,
  canDecideStudentLeave,
}: {
  institutionSlug: string;
  items: ApprovalQueueItem[];
  total: number;
  canDecideStaffLeave: boolean;
  canDecideStudentLeave: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState<ApprovalQueueItem | null>(null);
  const [note, setNote] = useState("");

  function decide(item: ApprovalQueueItem, decision: "approve" | "reject", reason?: string) {
    const input = { leaveId: item.id, ...(reason ? { note: reason } : {}) };
    const call: () => Promise<ActionResult<unknown>> =
      item.kind === "staff_leave"
        ? () => (decision === "approve" ? approveLeave(institutionSlug, input) : rejectLeave(institutionSlug, input))
        : () => (decision === "approve" ? approveStudentLeave(institutionSlug, input) : rejectStudentLeave(institutionSlug, input));
    start(async () => {
      const res = await call();
      if (res.ok) {
        toast.success(decision === "approve" ? "Leave approved" : "Leave rejected");
        setRejecting(null);
        setNote("");
        router.refresh();
      } else {
        toast.error(describeActionError(res.error));
        // Stale row (already decided / removed): refresh so the queue catches up.
        if (res.error.code === "not_found" || res.error.code === "invalid_state" || res.error.code === "conflict") router.refresh();
      }
    });
  }

  const canDecide = (i: ApprovalQueueItem) =>
    (i.kind === "staff_leave" && canDecideStaffLeave) || (i.kind === "student_leave" && canDecideStudentLeave);

  return (
    <div aria-busy={pending}>
      <ul className="divide-y">
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {i.category} · {i.age}
              </p>
              <p className="truncate text-sm font-medium">{i.title}</p>
              <p className="truncate text-xs text-muted-foreground">{i.who}</p>
            </div>
            {canDecide(i) ? (
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(i)}>
                  Reject
                </Button>
                <Button type="button" size="sm" disabled={pending} onClick={() => decide(i, "approve")}>
                  Approve
                </Button>
              </div>
            ) : i.href ? (
              <Button asChild size="sm" variant="outline">
                <Link href={i.href}>Review</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {total > items.length && <p className="pt-2 text-xs text-muted-foreground">Showing {items.length} of {total} pending items.</p>}

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && !pending && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this leave request?</DialogTitle>
            <DialogDescription>
              This rejects the request from {rejecting?.who} and cannot be undone. An optional note is kept with the decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-note">Note (optional)</Label>
            <Textarea id="reject-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting(null)}>
              Keep pending
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => rejecting && decide(rejecting, "reject", note.trim() || undefined)}>
              {pending ? "Rejecting…" : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
