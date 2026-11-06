"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelStudentLeave, requestStudentLeave } from "@/modules/student-leave/actions";

export function LeaveRequestForm({ institutionSlug, studentId, today }: { institutionSlug: string; studentId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      setErrors({});
      const result = await requestStudentLeave(institutionSlug, {
        studentId,
        startDate: String(fd.get("startDate") ?? ""),
        endDate: String(fd.get("endDate") ?? ""),
        reason: String(fd.get("reason") ?? ""),
      });
      if (result.ok) {
        toast.success("Leave request sent to the class teacher.");
        form.reset();
        router.refresh();
      } else {
        setErrors(result.error.fieldErrors ?? {});
        toast.error(result.error.message);
      }
    });
  };

  const err = (name: string) => errors[name]?.[0];

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="leave-start">From</Label>
          <Input id="leave-start" name="startDate" type="date" required min={today} defaultValue={today} aria-invalid={!!err("startDate")} className="min-h-10" />
          {err("startDate") && <p className="text-xs text-destructive">{err("startDate")}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="leave-end">To (inclusive)</Label>
          <Input id="leave-end" name="endDate" type="date" required min={today} defaultValue={today} aria-invalid={!!err("endDate")} className="min-h-10" />
          {err("endDate") && <p className="text-xs text-destructive">{err("endDate")}</p>}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="leave-reason">Reason</Label>
        <Textarea id="leave-reason" name="reason" required maxLength={500} rows={3} aria-invalid={!!err("reason")} />
        {err("reason") && <p className="text-xs text-destructive">{err("reason")}</p>}
      </div>
      <Button type="submit" className="min-h-10 w-full sm:w-fit" disabled={pending}>
        {pending ? "Sending…" : "Request leave"}
      </Button>
    </form>
  );
}

export function CancelLeaveButton({ institutionSlug, leaveId }: { institutionSlug: string; leaveId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const result = await cancelStudentLeave(institutionSlug, { leaveId });
      if (result.ok) {
        toast.success("Leave request cancelled.");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });

  return (
    <Button type="button" size="sm" variant="outline" className="min-h-10" disabled={pending} onClick={run}>
      {pending ? "Cancelling…" : "Cancel request"}
    </Button>
  );
}
