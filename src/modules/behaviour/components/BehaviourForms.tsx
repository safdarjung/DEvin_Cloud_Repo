"use client";

// Hiding these is UX only: actions re-check behaviour.write, Zod and RLS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { logIncident, voidIncident } from "@/modules/behaviour/actions";
import { StudentSearchSelect } from "@/modules/people/components/StudentSearchSelect";
import { BEHAVIOUR_CATEGORIES, BEHAVIOUR_SEVERITIES, IncidentLogSchema } from "@/modules/behaviour/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export function LogIncidentForm({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!student) {
      setError("Search for a student and pick one.");
      return;
    }
    const parsed = IncidentLogSchema.safeParse({
      studentId: fd.get("studentId"),
      category: fd.get("category"),
      severity: fd.get("severity"),
      points: Number(fd.get("points")),
      note: String(fd.get("note") ?? "") || undefined,
      occurredOn: String(fd.get("occurredOn") ?? "") || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    const form = e.currentTarget;
    start(async () => {
      const res = await logIncident(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Incident logged");
        form.reset();
        setStudent(null);
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div className="sm:col-span-2">
        <Label htmlFor="bh-student">Student</Label>
        <StudentSearchSelect institutionSlug={institutionSlug} id="bh-student" name="studentId" value={student} onChange={setStudent} />
      </div>
      <div>
        <Label htmlFor="bh-category">Category</Label>
        <Input id="bh-category" name="category" list="bh-categories" required maxLength={40} defaultValue={BEHAVIOUR_CATEGORIES[0]} />
        <datalist id="bh-categories">
          {BEHAVIOUR_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div>
        <Label htmlFor="bh-severity">Severity</Label>
        <select id="bh-severity" name="severity" className={SELECT_CLASS} defaultValue="low">
          {BEHAVIOUR_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="bh-points">Points (merit +, demerit −)</Label>
        <Input id="bh-points" name="points" type="number" step={1} min={-100} max={100} required defaultValue={0} />
      </div>
      <div>
        <Label htmlFor="bh-date">Date (default today)</Label>
        <Input id="bh-date" name="occurredOn" type="date" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="bh-note">Note</Label>
        <Input id="bh-note" name="note" maxLength={500} />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log incident"}
        </Button>
      </div>
    </form>
  );
}

export function VoidIncidentButton({ institutionSlug, incidentId }: { institutionSlug: string; incidentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Void
      </Button>
    );
  }
  const run = () =>
    start(async () => {
      const res = await voidIncident(institutionSlug, { incidentId, reason });
      if (res.ok) {
        toast.success("Incident voided");
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Input aria-label="Void reason" value={reason} maxLength={200} placeholder="Reason" onChange={(e) => setReason(e.target.value)} className="h-8 w-48" />
      <span className="flex gap-1">
        <Button type="button" size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={run}>
          {pending ? "Voiding…" : "Confirm void"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
