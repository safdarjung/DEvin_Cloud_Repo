"use client";

// Staff HR controls. Hiding them is UX only: every action re-checks its permission server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { cancelLeave, approveLeave, rejectLeave, requestLeave } from "@/modules/people/leave.actions";
import { checkIn } from "@/modules/people/staff-attendance.actions";
import { assignSubstitution, cancelSubstitution } from "@/modules/timetable/substitution.actions";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

/** Runs an action, toasts the outcome, refreshes the server data, returns field errors. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  function run<T>(call: () => Promise<ActionResult<T>>, success: string, onOk?: () => void) {
    start(async () => {
      const res = await call();
      if (res.ok) {
        setErrors({});
        toast.success(success);
        onOk?.();
        router.refresh();
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(describeActionError(res.error));
      }
    });
  }
  return { pending, errors, run };
}

export function CheckInButton({ institutionSlug }: { institutionSlug: string }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" disabled={pending} onClick={() => run(() => checkIn(institutionSlug, {}), "Checked in")}>
      {pending ? "Checking in…" : "Check in"}
    </Button>
  );
}

const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid", "other"] as const;

export function LeaveRequestForm({ institutionSlug }: { institutionSlug: string }) {
  const { pending, errors, run } = useRun();
  const [form, setForm] = useState({ leaveType: "casual" as (typeof LEAVE_TYPES)[number], startDate: "", endDate: "", reason: "" });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => requestLeave(institutionSlug, form), "Leave requested", () => setForm({ ...form, reason: "" }));
      }}
    >
      <div>
        <Label htmlFor="leave-type">Leave type</Label>
        <select id="leave-type" className={SELECT_CLASS} value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value as typeof form.leaveType })}>
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <FieldError errors={errors.leaveType} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="leave-start">From</Label>
          <Input id="leave-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} aria-invalid={Boolean(errors.startDate)} />
          <FieldError errors={errors.startDate} />
        </div>
        <div>
          <Label htmlFor="leave-end">To</Label>
          <Input id="leave-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} aria-invalid={Boolean(errors.endDate)} />
          <FieldError errors={errors.endDate} />
        </div>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="leave-reason">Reason</Label>
        <Input id="leave-reason" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-invalid={Boolean(errors.reason)} />
        <FieldError errors={errors.reason} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Request leave"}
        </Button>
      </div>
    </form>
  );
}

/** Approve/reject (deciders) or cancel (own pending request). */
export function LeaveRowActions({ institutionSlug, leaveId, canDecide, canCancel }: { institutionSlug: string; leaveId: string; canDecide: boolean; canCancel: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex justify-end gap-2">
      {canDecide && (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => approveLeave(institutionSlug, { leaveId }), "Leave approved")}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectLeave(institutionSlug, { leaveId }), "Leave rejected")}>
            Reject
          </Button>
        </>
      )}
      {canCancel && (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelLeave(institutionSlug, { leaveId }), "Leave cancelled")}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function AssignSubstituteForm({
  institutionSlug,
  slotId,
  date,
  candidates,
  defaultReason,
}: {
  institutionSlug: string;
  slotId: string;
  date: string;
  candidates: { staffId: string; name: string; periodsWeek: number; maxPeriods: number; why?: string }[];
  /** Prefilled reason the class and teachers see ("Ms Iyer is on leave"); required by the action. */
  defaultReason: string;
}) {
  const { pending, errors, run } = useRun();
  const [substituteId, setSubstituteId] = useState("");
  const [note, setNote] = useState(defaultReason);
  const selectId = `sub-${slotId}`;
  const noteId = `sub-note-${slotId}`;
  if (candidates.length === 0) return <span className="text-sm text-muted-foreground">No free teacher</span>;
  const chosen = candidates.find((c) => c.staffId === substituteId);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignSubstitution(institutionSlug, { slotId, date, substituteId, note }), "Substitute assigned");
      }}
    >
      <Label htmlFor={selectId} className="sr-only">
        Substitute teacher
      </Label>
      <select id={selectId} className={`${SELECT_CLASS} min-w-44`} value={substituteId} onChange={(e) => setSubstituteId(e.target.value)} aria-invalid={Boolean(errors.substituteId)}>
        <option value="">Choose a free teacher</option>
        {candidates.map((c) => (
          <option key={c.staffId} value={c.staffId}>
            {c.name} ({c.periodsWeek}/{c.maxPeriods} periods)
          </option>
        ))}
      </select>
      <Label htmlFor={noteId} className="sr-only">
        Reason for the cover, seen by school leaders and the two teachers (the class sees only that the regular teacher is unavailable)
      </Label>
      <Input id={noteId} className="h-10 min-w-48 flex-1" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-invalid={Boolean(errors.note)} placeholder="Reason, e.g. Ms Iyer is on leave" />
      <Button type="submit" size="sm" disabled={pending || !substituteId || !note.trim()}>
        Assign
      </Button>
      {chosen?.why && <p className="w-full text-xs text-muted-foreground">Why this teacher: {chosen.why}</p>}
      <FieldError errors={errors.note} />
    </form>
  );
}

export function CancelSubstitutionButton({ institutionSlug, substitutionId }: { institutionSlug: string; substitutionId: string }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelSubstitution(institutionSlug, { substitutionId }), "Substitution cancelled")}>
      Cancel cover
    </Button>
  );
}
