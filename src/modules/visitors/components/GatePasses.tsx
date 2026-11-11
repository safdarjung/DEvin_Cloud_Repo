"use client";

// Gate pass controls. Hiding them is UX only: the actions re-check `gatepass.manage`
// and the DB guard enforces the status transition table.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createGatePass, setGatePassStatus } from "@/modules/visitors/gate-pass.actions";
import { GatePassCreateSchema } from "@/modules/visitors/schemas";
import { FieldError, flattenIssues } from "./field";

export interface Collector {
  kind: "guardian" | "pickup";
  id: string;
  label: string;
}

export function GatePassForm({ institutionSlug, studentId, collectors }: { institutionSlug: string; studentId: string; collectors: Collector[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = collectors.find((x) => `${x.kind}:${x.id}` === picked);
    const parsed = GatePassCreateSchema.safeParse({
      studentId,
      reason,
      guardianId: c?.kind === "guardian" ? c.id : undefined,
      pickupPersonId: c?.kind === "pickup" ? c.id : undefined,
    });
    if (!parsed.success) {
      setErrors(flattenIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    start(async () => {
      const res = await createGatePass(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Gate pass requested");
        setReason("");
        setPicked("");
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <div>
        <Label htmlFor="gp-reason">Reason for leaving early</Label>
        <Input id="gp-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)} />
        <FieldError errors={errors.reason} />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Who will collect the student</legend>
        {collectors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guardian or pickup person on file. Add one in the Authorized pickup tab.</p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {collectors.map((c) => (
              <label key={`${c.kind}:${c.id}`} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm has-[:checked]:border-foreground">
                <input type="radio" name="collector" checked={picked === `${c.kind}:${c.id}`} onChange={() => setPicked(`${c.kind}:${c.id}`)} />
                {c.label}
              </label>
            ))}
          </div>
        )}
        <FieldError errors={errors.guardianId ?? errors.pickupPersonId} />
        <FieldError errors={errors.studentId} />
      </fieldset>
      <Button type="submit" disabled={pending || collectors.length === 0}>
        {pending ? "Requesting…" : "Request gate pass"}
      </Button>
    </form>
  );
}

const NEXT: Record<string, { status: "approved" | "rejected" | "cancelled" | "exited"; label: string; variant: "default" | "outline" }[]> = {
  pending: [
    { status: "approved", label: "Approve", variant: "default" },
    { status: "rejected", label: "Reject", variant: "outline" },
    { status: "cancelled", label: "Cancel", variant: "outline" },
  ],
  approved: [
    { status: "exited", label: "Mark collected", variant: "default" },
    { status: "cancelled", label: "Cancel", variant: "outline" },
  ],
};

export function GatePassActions({ institutionSlug, id, status, student }: { institutionSlug: string; id: string; status: string; student: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const options = NEXT[status] ?? [];
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {options.map((o) => (
        <Button
          key={o.status}
          size="sm"
          variant={o.variant}
          disabled={pending}
          aria-label={`${o.label} gate pass for ${student}`}
          onClick={() =>
            start(async () => {
              const res = await setGatePassStatus(institutionSlug, { id, status: o.status });
              if (res.ok) {
                toast.success(`Gate pass ${o.status}`);
                router.refresh();
              } else toast.error(describeActionError(res.error));
            })
          }
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
