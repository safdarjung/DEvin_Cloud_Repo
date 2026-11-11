"use client";

// Payroll controls. Hiding them is UX only: every action re-checks
// `payroll.manage`, and the definers re-check owner/accountant and run state.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { inr } from "@/lib/format";
import { finalizePayrollRun, generatePayrollRun, saveSalaryStructure } from "@/modules/payroll/actions";
import { componentTotals, MAX_SALARY_COMPONENTS, PayrollRunGenerateSchema, SalaryStructureSaveSchema, type SalaryComponent } from "@/modules/payroll/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Row = { name: string; kind: SalaryComponent["kind"]; rupees: string };

const toPaise = (rupees: string): number => Math.round(Number(rupees) * 100);

export function GenerateRunForm({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = PayrollRunGenerateSchema.safeParse({ month });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Pick a month.");
    setError(null);
    start(async () => {
      const res = await generatePayrollRun(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Draft payroll ready for review");
        router.push(`/${institutionSlug}/payroll/runs/${res.data.runId}`);
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor="payroll-month">Month</Label>
        <Input id="payroll-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-invalid={Boolean(error)} />
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate draft"}
      </Button>
    </form>
  );
}

/** Rebuilds a draft month's payslips from the current salary structures. */
export function RebuildRunButton({ institutionSlug, month }: { institutionSlug: string; month: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await generatePayrollRun(institutionSlug, { month });
          if (res.ok) {
            toast.success("Draft rebuilt from current salary structures");
            router.refresh();
          } else {
            toast.error(describeActionError(res.error));
          }
        })
      }
    >
      {pending ? "Rebuilding…" : "Rebuild draft"}
    </Button>
  );
}

export function FinalizeRunButton({ institutionSlug, runId, label, payslipCount }: { institutionSlug: string; runId: string; label: string; payslipCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={payslipCount === 0}>
        Finalize
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize payroll for {label}?</DialogTitle>
            <DialogDescription>
              {payslipCount} payslips become final and visible to staff. They can never be edited or deleted, and this month cannot be generated again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Keep as draft
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await finalizePayrollRun(institutionSlug, { runId });
                  if (res.ok) {
                    toast.success("Payroll finalized");
                    setOpen(false);
                    router.refresh();
                  } else {
                    toast.error(describeActionError(res.error));
                  }
                })
              }
            >
              {pending ? "Finalizing…" : "Finalize payroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SalaryStructureEditor({
  institutionSlug,
  staffId,
  staffName,
  components,
}: {
  institutionSlug: string;
  staffId: string;
  staffName: string;
  components: SalaryComponent[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial: Row[] = components.length
    ? components.map((c) => ({ name: c.name, kind: c.kind, rupees: String(c.amountPaise / 100) }))
    : [{ name: "Basic", kind: "earning", rupees: "" }];
  const [rows, setRows] = useState<Row[]>(initial);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const parsedRows = rows.map((r) => ({ name: r.name, kind: r.kind, amountPaise: toPaise(r.rupees) }));
  const totals = componentTotals(parsedRows.map((r) => ({ ...r, amountPaise: Number.isFinite(r.amountPaise) ? r.amountPaise : 0 })));

  function save() {
    const parsed = SalaryStructureSaveSchema.safeParse({ staffId, components: parsedRows });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the components.");
    setError(null);
    start(async () => {
      const res = await saveSalaryStructure(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success(`Salary saved for ${staffName}`);
        setOpen(false);
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setRows(initial);
          setError(null);
          setOpen(true);
        }}
      >
        {components.length ? "Edit" : "Set salary"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Salary structure · {staffName}</DialogTitle>
            <DialogDescription>Monthly amounts in rupees. Gross is the sum of earnings; net is gross less deductions. Changes apply to the next draft run.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                <Input aria-label={`Component ${i + 1} name`} value={r.name} maxLength={60} onChange={(e) => update(i, { name: e.target.value })} className="col-span-2 sm:col-span-1" />
                <select aria-label={`Component ${i + 1} type`} className={SELECT_CLASS} value={r.kind} onChange={(e) => update(i, { kind: e.target.value as Row["kind"] })}>
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </select>
                <Input aria-label={`Component ${i + 1} amount in rupees`} type="number" inputMode="decimal" min={0} step="0.01" value={r.rupees} onChange={(e) => update(i, { rupees: e.target.value })} />
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove component ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" disabled={rows.length >= MAX_SALARY_COMPONENTS} onClick={() => setRows((rs) => [...rs, { name: "", kind: "earning", rupees: "" }])}>
              <Plus className="size-4" aria-hidden /> Add component
            </Button>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm tabular-nums">
            <div>
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="font-medium">{inr(totals.grossPaise / 100)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Deductions</dt>
              <dd>{inr(totals.deductionsPaise / 100)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Net</dt>
              <dd className="font-medium">{inr(totals.netPaise / 100)}</dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save salary"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print
    </Button>
  );
}
