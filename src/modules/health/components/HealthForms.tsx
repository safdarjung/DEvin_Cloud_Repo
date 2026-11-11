"use client";

// Staff health forms. Hiding is UX only: actions re-check `health.write` and the Zod schemas.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { addHealthVisit, addVaccination, saveHealthProfile } from "@/modules/health/actions";
import { BLOOD_GROUPS, VISIT_OUTCOMES } from "@/modules/health/schemas";
import type { HealthProfile } from "@/modules/health/queries";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useSubmit(done: string, reset?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (call: () => Promise<Result>) =>
    start(async () => {
      const res = await call();
      if (res.ok) {
        setErrors({});
        toast.success(done);
        reset?.();
        router.refresh();
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(describeActionError(res.error));
      }
    });
  return { pending, errors, run };
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  ) : null;
}

export function ProfileForm({ institutionSlug, studentId, profile }: { institutionSlug: string; studentId: string; profile: HealthProfile | null }) {
  const { pending, errors, run } = useSubmit("Health profile saved");
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const blood = String(f.get("bloodGroup") ?? "");
    run(() =>
      saveHealthProfile(institutionSlug, {
        studentId,
        bloodGroup: blood ? (blood as (typeof BLOOD_GROUPS)[number]) : null,
        allergies: String(f.get("allergies") ?? ""),
        conditions: String(f.get("conditions") ?? ""),
        emergencyNote: String(f.get("emergencyNote") ?? ""),
      }),
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
      <div>
        <Label htmlFor="hp-blood">Blood group</Label>
        <select id="hp-blood" name="bloodGroup" className={SELECT_CLASS} defaultValue={profile?.bloodGroup ?? ""}>
          <option value="">Not recorded</option>
          {BLOOD_GROUPS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <FieldError errors={errors.bloodGroup} />
      </div>
      {(
        [
          ["allergies", "Allergies", profile?.allergies],
          ["conditions", "Conditions", profile?.conditions],
          ["emergencyNote", "Emergency note", profile?.emergencyNote],
        ] as const
      ).map(([name, label, value]) => (
        <div key={name}>
          <Label htmlFor={`hp-${name}`}>{label}</Label>
          <Textarea id={`hp-${name}`} name={name} maxLength={500} rows={2} defaultValue={value ?? ""} />
          <FieldError errors={errors[name]} />
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

export function VisitForm({ institutionSlug, studentId }: { institutionSlug: string; studentId: string }) {
  const [key, setKey] = useState(0);
  const { pending, errors, run } = useSubmit("Visit recorded", () => setKey((k) => k + 1));
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(() =>
      addHealthVisit(institutionSlug, {
        studentId,
        complaint: String(f.get("complaint") ?? ""),
        treatment: String(f.get("treatment") ?? ""),
        outcome: String(f.get("outcome")) as (typeof VISIT_OUTCOMES)[number],
      }),
    );
  }
  return (
    <form key={key} onSubmit={submit} className="space-y-3" aria-busy={pending}>
      <div>
        <Label htmlFor="hv-complaint">Complaint</Label>
        <Input id="hv-complaint" name="complaint" maxLength={300} required />
        <FieldError errors={errors.complaint} />
      </div>
      <div>
        <Label htmlFor="hv-treatment">Treatment</Label>
        <Textarea id="hv-treatment" name="treatment" maxLength={500} rows={2} />
        <FieldError errors={errors.treatment} />
      </div>
      <div>
        <Label htmlFor="hv-outcome">Outcome</Label>
        <select id="hv-outcome" name="outcome" className={SELECT_CLASS} defaultValue="returned_to_class">
          {VISIT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add visit"}
      </Button>
    </form>
  );
}

export function VaccinationForm({ institutionSlug, studentId }: { institutionSlug: string; studentId: string }) {
  const [key, setKey] = useState(0);
  const { pending, errors, run } = useSubmit("Vaccination recorded", () => setKey((k) => k + 1));
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dose = String(f.get("dose") ?? "").trim();
    run(() =>
      addVaccination(institutionSlug, {
        studentId,
        vaccine: String(f.get("vaccine") ?? ""),
        dose: dose || undefined,
        administeredOn: String(f.get("administeredOn") ?? ""),
        notes: String(f.get("notes") ?? ""),
      }),
    );
  }
  return (
    <form key={key} onSubmit={submit} className="space-y-3" aria-busy={pending}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="vx-vaccine">Vaccine</Label>
          <Input id="vx-vaccine" name="vaccine" maxLength={80} required />
          <FieldError errors={errors.vaccine} />
        </div>
        <div>
          <Label htmlFor="vx-dose">Dose</Label>
          <Input id="vx-dose" name="dose" maxLength={20} />
          <FieldError errors={errors.dose} />
        </div>
        <div>
          <Label htmlFor="vx-date">Given on</Label>
          <Input id="vx-date" name="administeredOn" type="date" required />
          <FieldError errors={errors.administeredOn} />
        </div>
      </div>
      <div>
        <Label htmlFor="vx-notes">Notes</Label>
        <Input id="vx-notes" name="notes" maxLength={300} />
        <FieldError errors={errors.notes} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add vaccination"}
      </Button>
    </form>
  );
}
