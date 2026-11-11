"use client";

// Front-desk controls. Hiding them is UX only: the actions re-check `visitor.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { checkInVisitor, checkOutVisitor } from "@/modules/visitors/actions";
import { ID_TYPES, VISITOR_PRIVACY_NOTICE, VisitorCheckInSchema } from "@/modules/visitors/schemas";
import { FieldError, SELECT_CLASS, flattenIssues } from "./field";

const EMPTY = { fullName: "", phone: "", purpose: "", hostStaffId: "", meetingWith: "", idType: "", idLast4: "" };

export function CheckInForm({ institutionSlug, staff }: { institutionSlug: string; staff: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = VisitorCheckInSchema.safeParse({
      fullName: form.fullName,
      phone: form.phone,
      purpose: form.purpose,
      hostStaffId: form.hostStaffId || undefined,
      meetingWith: form.meetingWith || undefined,
      idType: form.idType || undefined,
      idLast4: form.idLast4 || undefined,
    });
    if (!parsed.success) {
      setErrors(flattenIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    start(async () => {
      const res = await checkInVisitor(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Visitor checked in");
        setForm(EMPTY);
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="v-name">Visitor name</Label>
          <Input id="v-name" value={form.fullName} maxLength={80} onChange={set("fullName")} aria-invalid={Boolean(errors.fullName)} />
          <FieldError errors={errors.fullName} />
        </div>
        <div>
          <Label htmlFor="v-phone">Mobile number</Label>
          <Input id="v-phone" inputMode="numeric" maxLength={10} value={form.phone} onChange={set("phone")} aria-invalid={Boolean(errors.phone)} />
          <FieldError errors={errors.phone} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="v-purpose">Purpose of visit</Label>
          <Input id="v-purpose" value={form.purpose} maxLength={120} onChange={set("purpose")} aria-invalid={Boolean(errors.purpose)} />
          <FieldError errors={errors.purpose} />
        </div>
        <div>
          <Label htmlFor="v-host">Meeting (staff)</Label>
          <select id="v-host" className={SELECT_CLASS} value={form.hostStaffId} onChange={set("hostStaffId")}>
            <option value="">Not a staff member</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <FieldError errors={errors.hostStaffId} />
        </div>
        <div>
          <Label htmlFor="v-with">Or meeting (name)</Label>
          <Input id="v-with" value={form.meetingWith} maxLength={80} onChange={set("meetingWith")} aria-invalid={Boolean(errors.meetingWith)} />
          <FieldError errors={errors.meetingWith} />
        </div>
        <div>
          <Label htmlFor="v-idtype">ID type (optional)</Label>
          <select id="v-idtype" className={SELECT_CLASS} value={form.idType} onChange={set("idType")}>
            <option value="">None</option>
            {ID_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <FieldError errors={errors.idType} />
        </div>
        <div>
          <Label htmlFor="v-id4">ID last 4 characters</Label>
          <Input id="v-id4" maxLength={4} value={form.idLast4} onChange={set("idLast4")} aria-invalid={Boolean(errors.idLast4)} />
          <FieldError errors={errors.idLast4} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{VISITOR_PRIVACY_NOTICE}</p>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking in…" : "Check in"}
      </Button>
    </form>
  );
}

export function CheckOutButton({ institutionSlug, id, name }: { institutionSlug: string; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Check out ${name}`}
      onClick={() =>
        start(async () => {
          const res = await checkOutVisitor(institutionSlug, { id });
          if (res.ok) {
            toast.success("Visitor checked out");
            router.refresh();
          } else toast.error(describeActionError(res.error));
        })
      }
    >
      {pending ? "…" : "Check out"}
    </Button>
  );
}
