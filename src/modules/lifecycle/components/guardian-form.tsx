"use client";

// Link a new guardian to a student. UX gate only: the action re-checks `student.write`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { linkGuardian } from "@/modules/people/actions";

const RELATIONSHIPS = ["father", "mother", "legal_guardian", "grandparent", "other"] as const;

export function GuardianForm({ institutionSlug, studentId, studentName }: { institutionSlug: string; studentId: string; studentName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const empty = { fullName: "", phone: "", email: "", relationship: "mother", isPrimary: false };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const err = (k: string) => (errors[k]?.length ? <p role="alert" className="mt-1 text-xs text-destructive">{errors[k].join(" ")}</p> : null);

  return (
    <form
      aria-busy={pending}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await linkGuardian(institutionSlug, {
            studentId,
            relationship: f.relationship as (typeof RELATIONSHIPS)[number],
            isPrimary: f.isPrimary,
            guardian: { fullName: f.fullName, phone: f.phone, email: f.email.trim() || undefined },
          });
          if (res.ok) {
            setErrors({});
            setF(empty);
            toast.success(`${res.data.created ? "Guardian added" : "Existing guardian linked"} to ${studentName}`);
            router.refresh();
          } else {
            setErrors(res.error.fieldErrors ?? {});
            toast.error(describeActionError(res.error));
          }
        });
      }}
    >
      <div>
        <Label htmlFor="g-name">Guardian name</Label>
        <Input id="g-name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} aria-invalid={Boolean(errors.guardian?.length)} />
      </div>
      <div>
        <Label htmlFor="g-phone">Mobile number</Label>
        <Input id="g-phone" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-invalid={Boolean(errors.guardian?.length)} />
      </div>
      <div>
        <Label htmlFor="g-email">Email (optional)</Label>
        <Input id="g-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={Boolean(errors.guardian?.length)} />
      </div>
      <div>
        <Label htmlFor="g-rel">Relationship</Label>
        <select id="g-rel" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      {err("guardian")}
      <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary contact
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Linking…" : "Link guardian"}
        </Button>
      </div>
    </form>
  );
}
