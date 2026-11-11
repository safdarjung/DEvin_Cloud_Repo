"use client";

// Transfer out / withdraw one student. Hard to undo: a confirm step names the student. UX gate only: actions re-check `student.write`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { transfer, withdraw } from "@/modules/lifecycle/actions";

export function ExitForm({ institutionSlug, studentId, studentName }: { institutionSlug: string; studentId: string; studentName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ kind: "transfer", reason: "", destination: "", leftOn: "", conduct: "" });
  const [review, setReview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [tc, setTc] = useState<string | null>(null);

  function confirm() {
    const base = { studentId, reason: f.reason, leftOn: f.leftOn || undefined, conduct: f.conduct || undefined };
    start(async () => {
      const res = f.kind === "transfer" ? await transfer(institutionSlug, { ...base, destinationSchool: f.destination }) : await withdraw(institutionSlug, { ...base, destinationSchool: f.destination || undefined });
      if (res.ok) {
        setTc(res.data.tcNo);
        setReview(false);
        toast.success(`${studentName} has left. Transfer certificate ${res.data.tcNo}`);
        router.refresh();
      } else {
        setReview(false);
        setErrors(res.error.fieldErrors ?? {});
        setMessage(describeActionError(res.error));
        toast.error(describeActionError(res.error));
      }
    });
  }

  if (tc) {
    return (
      <p role="status" className="text-sm">
        {studentName} has been marked as left. Transfer certificate number: <strong className="tabular-nums">{tc}</strong>.
      </p>
    );
  }
  const err = (k: string) => (errors[k]?.length ? <p role="alert" className="mt-1 text-xs text-destructive">{errors[k].join(" ")}</p> : null);
  return (
    <form
      aria-busy={pending}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        setMessage(null);
        setReview(true);
      }}
    >
      <div>
        <Label htmlFor="exit-kind">Exit type</Label>
        <select id="exit-kind" value={f.kind} disabled={review} onChange={(e) => setF({ ...f, kind: e.target.value })} className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="transfer">Transfer to another school</option>
          <option value="withdraw">Withdrawal</option>
        </select>
      </div>
      <div>
        <Label htmlFor="exit-date">Leaving date (optional, default today)</Label>
        <Input id="exit-date" type="date" value={f.leftOn} disabled={review} onChange={(e) => setF({ ...f, leftOn: e.target.value })} />
        {err("leftOn")}
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="exit-reason">Reason</Label>
        <Input id="exit-reason" value={f.reason} maxLength={500} disabled={review} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-invalid={Boolean(errors.reason?.length)} />
        {err("reason")}
      </div>
      <div>
        <Label htmlFor="exit-dest">Destination school{f.kind === "transfer" ? "" : " (optional)"}</Label>
        <Input id="exit-dest" value={f.destination} maxLength={200} disabled={review} onChange={(e) => setF({ ...f, destination: e.target.value })} aria-invalid={Boolean(errors.destinationSchool?.length)} />
        {err("destinationSchool")}
      </div>
      <div>
        <Label htmlFor="exit-conduct">Conduct (optional)</Label>
        <Input id="exit-conduct" value={f.conduct} maxLength={100} disabled={review} onChange={(e) => setF({ ...f, conduct: e.target.value })} />
        {err("conduct")}
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {message}
        </p>
      )}
      <div className="sm:col-span-2">
        {!review ? (
          <Button type="submit">Review exit</Button>
        ) : (
          <div role="alertdialog" aria-labelledby="exit-confirm" className="space-y-3 rounded-md border border-destructive/40 p-4">
            <h3 id="exit-confirm" className="text-sm font-semibold">
              {f.kind === "transfer" ? "Transfer out" : "Withdraw"} {studentName}?
            </h3>
            <p className="text-sm text-muted-foreground">This issues a transfer certificate, ends the enrolment and disables the student&apos;s portal login. Guardians with no other active child lose access too.</p>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
                {pending ? "Saving…" : `Confirm: ${f.kind === "transfer" ? "transfer out" : "withdraw"} ${studentName}`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
