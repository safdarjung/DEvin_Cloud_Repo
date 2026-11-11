"use client";

// Duty controls. Hiding them is UX only: actions re-check duty.manage / duty.swap and the definers re-check everything.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LimitedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import {
  cancelDutySwap,
  createDutyType,
  generateDutyRoster,
  requestDutySwap,
  respondDutySwap,
  setDutyAssignment,
  updateDutyType,
  type RosterResult,
} from "@/modules/duties/actions";
import type { DutyTypeRow } from "@/modules/duties/queries";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";
type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

export function DutyTypeForm({ slug, type }: { slug: string; type?: DutyTypeRow }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ name: type?.name ?? "", slots: String(type?.slotsPerDay ?? 1), active: type?.isActive ?? true });
  const id = type?.id ?? "new";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = { name: f.name, slotsPerDay: Number(f.slots) };
    run(
      () => (type ? updateDutyType(slug, { id: type.id, ...base, isActive: f.active }) : createDutyType(slug, base)),
      type ? "Duty type updated" : "Duty type added",
      () => !type && setF({ ...f, name: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor={`dn-${id}`}>Name</Label>
        <Input id={`dn-${id}`} required value={f.name} maxLength={60} placeholder="Gate, bus, lunch" onChange={(e) => setF({ ...f, name: e.target.value })} className="w-48" />
      </div>
      <div>
        <Label htmlFor={`ds-${id}`}>Slots per day</Label>
        <Input id={`ds-${id}`} type="number" min={1} max={20} required value={f.slots} onChange={(e) => setF({ ...f, slots: e.target.value })} className="w-28" />
      </div>
      {type && (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Active
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {type ? "Save" : "Add duty type"}
      </Button>
    </form>
  );
}

export function GenerateForm({ slug, today, activeTypes }: { slug: string; today: string; activeTypes: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [f, setF] = useState({ from: today, to: today });
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RosterResult | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await generateDutyRoster(slug, f);
      if (res.ok) {
        setResult(res.data);
        setConfirmed(false);
        toast.success("Roster generated");
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="g-from">From</Label>
            <Input id="g-from" type="date" required min={today} value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setConfirmed(false); }} className="w-44" />
          </div>
          <div>
            <Label htmlFor="g-to">To</Label>
            <Input id="g-to" type="date" required min={f.from} value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setConfirmed(false); }} className="w-44" />
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">How the roster is made</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Each school day, every active duty type ({activeTypes}) gets its slots filled.</li>
            <li>Sundays and school holidays are skipped. Days that already have a roster for a duty type are left alone.</li>
            <li>Teaching staff with the fewest duties in the last 60 days are picked first. Staff on approved leave are skipped.</li>
            <li>Running it again for the same dates adds nothing. The range can be at most 62 days and cannot start in the past.</li>
          </ul>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I have read the rule above and want to generate this range.
        </label>
        <Button type="submit" disabled={pending || !confirmed || activeTypes === 0}>
          {pending ? "Generating…" : "Generate roster"}
        </Button>
        {activeTypes === 0 && <p className="text-sm text-muted-foreground">Add an active duty type first.</p>}
      </form>
      {result && (
        <section aria-label="Result" className="rounded-md border p-3 text-sm">
          <p className="font-medium">Created {result.created} duties over {result.schoolDays} school days.</p>
          <p className="text-muted-foreground">
            Skipped: {result.skippedSundays} Sundays, {result.skippedHolidays} holidays, {result.skippedAlreadyRostered} already rostered.
          </p>
          {result.unfilledSlots > 0 && (
            <p className="mt-1">
              {result.unfilledSlots} slots could not be filled: not enough teaching staff were free. <LimitedBadge /> Unfilled slots cannot be filled by hand yet.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export function AssignmentAdmin({ slug, assignmentId, staff }: { slug: string; assignmentId: string; staff: { id: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [to, setTo] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1">
      <select aria-label="Reassign to" className={`${SELECT_CLASS} h-8 text-xs`} value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Reassign to…</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={pending || !to} onClick={() => run(() => setDutyAssignment(slug, { assignmentId, staffId: to }), "Duty reassigned", () => setTo(""))}>
        Move
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDutyAssignment(slug, { assignmentId, cancel: true }), "Duty cancelled")}>
        Cancel duty
      </Button>
    </span>
  );
}

export function SwapRequestForm({ slug, assignmentId, staff }: { slug: string; assignmentId: string; staff: { id: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [to, setTo] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1">
      <select aria-label="Swap with" className={`${SELECT_CLASS} h-8 text-xs`} value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Swap with…</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={pending || !to} onClick={() => run(() => requestDutySwap(slug, { assignmentId, toStaffId: to }), "Swap requested", () => setTo(""))}>
        Request swap
      </Button>
    </span>
  );
}

export function SwapRespondButtons({ slug, requestId }: { slug: string; requestId: string }) {
  const { pending, run } = useRun();
  return (
    <span className="flex gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => respondDutySwap(slug, { requestId, accept: true }), "Swap accepted")}>
        Accept
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => respondDutySwap(slug, { requestId, accept: false }), "Swap rejected")}>
        Reject
      </Button>
    </span>
  );
}

export function CancelSwapButton({ slug, requestId }: { slug: string; requestId: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelDutySwap(slug, { requestId }), "Request cancelled")}>
      Cancel request
    </Button>
  );
}
