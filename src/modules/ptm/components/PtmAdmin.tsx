"use client";

// PTM admin controls. Hiding them is UX only: the actions re-check `ptm.manage`
// and the Zod schema server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createPtmEvent, publishPtmEvent } from "@/modules/ptm/actions";
import { PtmEventCreateSchema, PTM_SLOT_MINUTES } from "@/modules/ptm/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

export function PtmEventForm({ institutionSlug, sections }: { institutionSlug: string; sections: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState({ title: "", eventDate: "", dayStartsAt: "10:00", dayEndsAt: "13:00", slotMinutes: "10", bookingClosesAt: "" });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      title: form.title,
      eventDate: form.eventDate,
      dayStartsAt: form.dayStartsAt,
      dayEndsAt: form.dayEndsAt,
      slotMinutes: Number(form.slotMinutes),
      // The form is IST wall-clock; the action pins the same +05:30 offset.
      bookingClosesAt: form.bookingClosesAt ? `${form.bookingClosesAt}:00+05:30` : "",
      classSectionIds: [...picked],
    };
    const parsed = PtmEventCreateSchema.safeParse(input);
    if (!parsed.success) {
      const flat: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (flat[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
      setErrors(flat);
      return;
    }
    setErrors({});
    start(async () => {
      const res = await createPtmEvent(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("PTM event created as a draft");
        setForm({ ...form, title: "" });
        setPicked(new Set());
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
        <div className="sm:col-span-2">
          <Label htmlFor="ptm-title">Title</Label>
          <Input id="ptm-title" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={Boolean(errors.title)} />
          <FieldError errors={errors.title} />
        </div>
        <div>
          <Label htmlFor="ptm-date">Date</Label>
          <Input id="ptm-date" type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} aria-invalid={Boolean(errors.eventDate)} />
          <FieldError errors={errors.eventDate} />
        </div>
        <div>
          <Label htmlFor="ptm-slot">Slot length</Label>
          <select id="ptm-slot" className={`${SELECT_CLASS} w-full`} value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: e.target.value })}>
            {PTM_SLOT_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <FieldError errors={errors.slotMinutes} />
        </div>
        <div>
          <Label htmlFor="ptm-start">Day starts</Label>
          <Input id="ptm-start" type="time" value={form.dayStartsAt} onChange={(e) => setForm({ ...form, dayStartsAt: e.target.value })} />
          <FieldError errors={errors.dayStartsAt} />
        </div>
        <div>
          <Label htmlFor="ptm-end">Day ends</Label>
          <Input id="ptm-end" type="time" value={form.dayEndsAt} onChange={(e) => setForm({ ...form, dayEndsAt: e.target.value })} />
          <FieldError errors={errors.dayEndsAt} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ptm-closes">Booking closes (IST)</Label>
          <Input id="ptm-closes" type="datetime-local" value={form.bookingClosesAt} onChange={(e) => setForm({ ...form, bookingClosesAt: e.target.value })} aria-invalid={Boolean(errors.bookingClosesAt)} />
          <FieldError errors={errors.bookingClosesAt} />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Sections invited</legend>
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No class sections exist yet. Create sections in academics first.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {sections.map((s) => (
              <label key={s.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm has-[:checked]:border-foreground">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
        )}
        <FieldError errors={errors.classSectionIds} />
      </fieldset>

      <Button type="submit" disabled={pending || sections.length === 0}>
        {pending ? "Creating…" : "Create PTM event"}
      </Button>
    </form>
  );
}

export function PublishPtmButton({ institutionSlug, eventId }: { institutionSlug: string; eventId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await publishPtmEvent(institutionSlug, { eventId });
          if (res.ok) {
            toast.success("PTM event published");
            router.refresh();
          } else {
            toast.error(describeActionError(res.error));
          }
        })
      }
    >
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}
