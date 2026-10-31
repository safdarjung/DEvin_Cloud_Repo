"use client";

// T-015 — 06 §W5 correction dialog. `correctAttendance` is the real boundary
// (RPC enforces the window/role); this dialog only offers the control —
// hiding it for a teacher outside the window is UX, not authorization.
import { Label } from "@/components/ui/label";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { Textarea } from "@/components/ui/textarea";
import { correctAttendance } from "@/modules/attendance/actions";
import type { AttendanceStatusOption } from "@/modules/attendance/queries";

interface CorrectionDialogProps {
  institutionSlug: string;
  recordId: string;
  studentName: string;
  currentStatus: string;
  statuses: AttendanceStatusOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCorrected?: (newStatus: string) => void;
}

export function CorrectionDialog({
  institutionSlug,
  recordId,
  studentName,
  currentStatus,
  statuses,
  open,
  onOpenChange,
  onCorrected,
}: CorrectionDialogProps) {
  const [newStatus, setNewStatus] = useState(
    statuses.find((s) => s.code !== currentStatus)?.code ?? currentStatus,
  );
  const [reason, setReason] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult<{ recordId: string; status: string }> | null, FormData>(
    async () => correctAttendance(institutionSlug, { recordId, newStatus, reason }),
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      onCorrected?.(state.data.status);
      onOpenChange(false);
    }
  }, [state, onCorrected, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct attendance — {studentName}</DialogTitle>
          <DialogDescription>
            Current status: {statuses.find((s) => s.code === currentStatus)?.label ?? currentStatus}. This change is logged with a reason.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div>
            <Label htmlFor="newStatus">
              New status
            </Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger id="newStatus" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="reason">
              Reason
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              required
              className="min-h-16"
            />
          </div>
          {state && !state.ok && (
            <p role="alert" className="text-destructive text-sm">
              {state.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !reason.trim() || newStatus === currentStatus}>
              {pending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
