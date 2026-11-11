"use client";

// Lab controls. Hiding them is UX only: actions re-check lab.book / lab.manage and RLS scopes teachers to their own rows.
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import {
  bookLab,
  cancelBooking,
  completeExperiment,
  createEquipment,
  createLab,
  logExperiment,
  recordIncident,
  updateEquipment,
  updateLab,
} from "@/modules/school-labs/actions";
import type { BookingOption, EquipmentRow, LabRow, PickerOptions } from "@/modules/school-labs/queries";
import { EQUIPMENT_CONDITIONS, EQUIPMENT_KINDS, HAZARD_CLASSES, INCIDENT_KINDS, INCIDENT_SEVERITIES, LAB_KINDS } from "@/modules/school-labs/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setFormError(null);
        toast.success(success);
        after?.();
        router.refresh();
      } else {
        const msg = describeActionError(res.error);
        setFormError(msg);
        toast.error(msg);
      }
    });
  }
  return { pending, run, formError };
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="w-full text-sm text-destructive">
      Could not save: {message}
    </p>
  ) : null;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function LabForm({ institutionSlug, lab }: { institutionSlug: string; lab?: LabRow }) {
  const { pending, run, formError } = useRun();
  const [f, setF] = useState({ name: lab?.name ?? "", kind: lab?.kind ?? "science", capacity: String(lab?.capacity ?? 30), isActive: lab?.isActive ?? true });
  const id = lab?.id ?? "new";
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const base = { name: f.name, kind: f.kind as (typeof LAB_KINDS)[number], capacity: Number(f.capacity) };
        run(() => (lab ? updateLab(institutionSlug, { id: lab.id, ...base, isActive: f.isActive }) : createLab(institutionSlug, base)), lab ? "Lab updated" : "Lab added", () => !lab && setF({ ...f, name: "" }));
      }}
    >
      <Field id={`ln-${id}`} label="Name">
        <Input id={`ln-${id}`} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-44" />
      </Field>
      <Field id={`lk-${id}`} label="Kind">
        <select id={`lk-${id}`} className={SELECT_CLASS} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {LAB_KINDS.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`lc-${id}`} label="Capacity">
        <Input id={`lc-${id}`} type="number" min={1} max={500} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} className="w-24" />
      </Field>
      {lab && (
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {lab ? "Save" : "Add lab"}
      </Button>
      <FormError message={formError} />
    </form>
  );
}

export function EquipmentForm({ institutionSlug, labs, item, defaultLabId }: { institutionSlug: string; labs: LabRow[]; item?: EquipmentRow; defaultLabId?: string }) {
  const { pending, run, formError } = useRun();
  const [f, setF] = useState({
    labId: item?.labId ?? defaultLabId ?? labs[0]?.id ?? "",
    name: item?.name ?? "",
    kind: item?.kind ?? "equipment",
    quantity: String(item?.quantity ?? 1),
    unit: item?.unit ?? "pcs",
    hazardClass: item?.hazardClass ?? "",
    expiryOn: item?.expiryOn ?? "",
    condition: item?.condition ?? "good",
  });
  const id = item?.id ?? "new";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const input = {
          labId: f.labId,
          name: f.name,
          kind: f.kind as (typeof EQUIPMENT_KINDS)[number],
          quantity: Number(f.quantity),
          unit: f.unit,
          hazardClass: (f.hazardClass || null) as (typeof HAZARD_CLASSES)[number] | null,
          expiryOn: f.expiryOn || null,
          condition: f.condition as (typeof EQUIPMENT_CONDITIONS)[number],
        };
        run(() => (item ? updateEquipment(institutionSlug, { id: item.id, ...input }) : createEquipment(institutionSlug, input)), item ? "Equipment updated" : "Equipment added", () => !item && setF({ ...f, name: "" }));
      }}
    >
      <Field id={`el-${id}`} label="Lab">
        <select id={`el-${id}`} className={SELECT_CLASS} value={f.labId} onChange={set("labId")}>
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`en-${id}`} label="Name">
        <Input id={`en-${id}`} value={f.name} maxLength={120} onChange={set("name")} className="w-44" />
      </Field>
      <Field id={`ek-${id}`} label="Kind">
        <select id={`ek-${id}`} className={SELECT_CLASS} value={f.kind} onChange={set("kind")}>
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`eq-${id}`} label="Quantity">
        <Input id={`eq-${id}`} type="number" min={0} step="any" value={f.quantity} onChange={set("quantity")} className="w-24" />
      </Field>
      <Field id={`eu-${id}`} label="Unit">
        <Input id={`eu-${id}`} value={f.unit} maxLength={20} onChange={set("unit")} className="w-20" />
      </Field>
      <Field id={`eh-${id}`} label="Hazard class">
        <select id={`eh-${id}`} className={SELECT_CLASS} value={f.hazardClass} onChange={set("hazardClass")}>
          <option value="">None</option>
          {HAZARD_CLASSES.map((h) => (
            <option key={h} value={h}>
              {humanize(h)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`ee-${id}`} label="Expiry date">
        <Input id={`ee-${id}`} type="date" value={f.expiryOn} onChange={set("expiryOn")} className="w-40" />
      </Field>
      <Field id={`ec-${id}`} label="Condition">
        <select id={`ec-${id}`} className={SELECT_CLASS} value={f.condition} onChange={set("condition")}>
          {EQUIPMENT_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {item ? "Save" : "Add equipment"}
      </Button>
      <FormError message={formError} />
    </form>
  );
}

export function BookingForm({
  institutionSlug,
  labId,
  options,
  periods,
  isManager,
  defaultDate,
  defaultPeriodId,
  minDate,
  safety,
}: {
  institutionSlug: string;
  labId: string;
  options: PickerOptions;
  periods: { id: string; name: string }[];
  isManager: boolean;
  defaultDate: string;
  defaultPeriodId?: string;
  minDate: string;
  /** Server-rendered Safety check for this lab. */
  safety: ReactNode;
}) {
  const { pending, run, formError } = useRun();
  const [f, setF] = useState({ classSectionId: "", subjectId: "", date: defaultDate, periodId: defaultPeriodId ?? periods[0]?.id ?? "", purpose: "", staffId: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => bookLab(institutionSlug, { labId, classSectionId: f.classSectionId, subjectId: f.subjectId, date: f.date, periodId: f.periodId, purpose: f.purpose, staffId: isManager && f.staffId ? f.staffId : undefined }),
          "Lab booked",
          () => setF({ ...f, purpose: "" }),
        );
      }}
    >
      {safety}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="bk-date" label="Date">
          <Input id="bk-date" type="date" min={minDate} value={f.date} onChange={set("date")} className="w-40" />
        </Field>
        <Field id="bk-period" label="Period">
          <select id="bk-period" className={SELECT_CLASS} value={f.periodId} onChange={set("periodId")}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="bk-section" label="Class section">
          <select id="bk-section" className={SELECT_CLASS} value={f.classSectionId} onChange={set("classSectionId")} required>
            <option value="">Choose</option>
            {options.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="bk-subject" label="Subject">
          <select id="bk-subject" className={SELECT_CLASS} value={f.subjectId} onChange={set("subjectId")} required>
            <option value="">Choose</option>
            {options.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        {isManager && (
          <Field id="bk-staff" label="Teacher">
            <select id="bk-staff" className={SELECT_CLASS} value={f.staffId} onChange={set("staffId")}>
              <option value="">Me</option>
              {options.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="bk-purpose" label="Purpose">
          <Input id="bk-purpose" value={f.purpose} maxLength={200} onChange={set("purpose")} className="w-56" />
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          Book lab
        </Button>
      </div>
      <FormError message={formError} />
    </form>
  );
}

export function CancelBookingButton({ institutionSlug, bookingId }: { institutionSlug: string; bookingId: string }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => cancelBooking(institutionSlug, { bookingId }), "Booking cancelled")}>
      Cancel
    </Button>
  );
}

export function ExperimentForm({ institutionSlug, bookingId }: { institutionSlug: string; bookingId: string }) {
  const { pending, run, formError } = useRun();
  const [f, setF] = useState({ title: "", notes: "" });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => logExperiment(institutionSlug, { bookingId, title: f.title, notes: f.notes }), "Experiment logged", () => setF({ title: "", notes: "" }));
      }}
    >
      <Field id="ex-title" label="Experiment title">
        <Input id="ex-title" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} className="w-64" />
      </Field>
      <Field id="ex-notes" label="Notes">
        <Input id="ex-notes" value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-72" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Log experiment
      </Button>
      <FormError message={formError} />
    </form>
  );
}

export function CompleteExperimentButton({ institutionSlug, id, completed }: { institutionSlug: string; id: string; completed: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => completeExperiment(institutionSlug, { id, completed: !completed }), completed ? "Marked not completed" : "Marked completed")}>
      {completed ? "Reopen" : "Mark completed"}
    </Button>
  );
}

export function IncidentForm({ institutionSlug, labs, bookings, isManager }: { institutionSlug: string; labs: LabRow[]; bookings: BookingOption[]; isManager: boolean }) {
  const { pending, run, formError } = useRun();
  const [f, setF] = useState({ labId: labs[0]?.id ?? "", bookingId: "", kind: "breakage", severity: "low", description: "", cost: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // A chosen booking fixes the lab (the database requires they match).
  const booking = bookings.find((b) => b.id === f.bookingId);
  const labId = booking?.labId ?? f.labId;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => recordIncident(institutionSlug, { labId, bookingId: f.bookingId || undefined, kind: f.kind as (typeof INCIDENT_KINDS)[number], severity: f.severity as (typeof INCIDENT_SEVERITIES)[number], description: f.description, cost: f.cost }),
          "Incident recorded",
          () => setF({ ...f, description: "", cost: "" }),
        );
      }}
    >
      <Field id="in-booking" label={isManager ? "Booking (optional)" : "Your booking"}>
        <select id="in-booking" className={SELECT_CLASS} value={f.bookingId} onChange={set("bookingId")} required={!isManager}>
          <option value="">{isManager ? "No booking" : "Choose"}</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </Field>
      {!booking && (
        <Field id="in-lab" label="Lab">
          <select id="in-lab" className={SELECT_CLASS} value={f.labId} onChange={set("labId")}>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="in-kind" label="Kind">
        <select id="in-kind" className={SELECT_CLASS} value={f.kind} onChange={set("kind")}>
          {INCIDENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="in-sev" label="Severity">
        <select id="in-sev" className={SELECT_CLASS} value={f.severity} onChange={set("severity")}>
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="in-desc" label="What happened">
        <Input id="in-desc" value={f.description} maxLength={1000} onChange={set("description")} className="w-72" />
      </Field>
      <Field id="in-cost" label="Cost in rupees (optional)">
        <Input id="in-cost" inputMode="decimal" value={f.cost} onChange={set("cost")} placeholder="250.50" className="w-32" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Record incident
      </Button>
      <FormError message={formError} />
    </form>
  );
}
