"use client";

// Authorized pickup controls. Hiding them is UX only: the actions re-check `pickup.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { addPickupPerson, removePickupPerson } from "@/modules/visitors/pickup.actions";
import { PICKUP_RELATIONS, PickupAddSchema } from "@/modules/visitors/schemas";
import { FieldError, SELECT_CLASS, flattenIssues } from "./field";

export function PickupAddForm({ institutionSlug, studentId }: { institutionSlug: string; studentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState({ fullName: "", relation: "father", phone: "" });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = PickupAddSchema.safeParse({ studentId, ...form });
    if (!parsed.success) {
      setErrors(flattenIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    start(async () => {
      const res = await addPickupPerson(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Pickup person added");
        setForm({ fullName: "", relation: "father", phone: "" });
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" aria-busy={pending}>
      <div>
        <Label htmlFor="pk-name">Full name</Label>
        <Input id="pk-name" value={form.fullName} maxLength={80} onChange={(e) => setForm({ ...form, fullName: e.target.value })} aria-invalid={Boolean(errors.fullName)} />
        <FieldError errors={errors.fullName} />
      </div>
      <div>
        <Label htmlFor="pk-rel">Relation</Label>
        <select id="pk-rel" className={SELECT_CLASS} value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
          {PICKUP_RELATIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <FieldError errors={errors.relation} />
      </div>
      <div>
        <Label htmlFor="pk-phone">Mobile number</Label>
        <Input id="pk-phone" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-invalid={Boolean(errors.phone)} />
        <FieldError errors={errors.phone} />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add pickup person"}
        </Button>
      </div>
    </form>
  );
}

export function RemovePickupButton({ institutionSlug, id, name }: { institutionSlug: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Remove ${name} from pickup list`}
      onClick={() => {
        if (!window.confirm(`Remove ${name} from the authorized pickup list?`)) return;
        start(async () => {
          const res = await removePickupPerson(institutionSlug, { id });
          if (res.ok) {
            toast.success("Pickup person removed");
            router.refresh();
          } else toast.error(describeActionError(res.error));
        });
      }}
    >
      Remove
    </Button>
  );
}
