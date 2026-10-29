"use client";

// T-031 — 06 §W9 assign-structure dialog with optional concessions.
// `assignFeeStructure` is the real boundary (validates every id and that a
// concession's head matches a component on the structure); this dialog
// only offers the control.
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { assignFeeStructure } from "@/modules/finance/actions";
import { concessionKind, feeHead } from "@/modules/finance/schemas";
import type { PickerOption } from "@/modules/finance/queries";

interface ConcessionDraft {
  kind: string;
  head: string;
  mode: "percent" | "amount";
  value: string;
  reason: string;
}

function emptyConcession(): ConcessionDraft {
  return { kind: concessionKind.options[0], head: feeHead.options[0], mode: "percent", value: "0", reason: "" };
}

interface FeeAssignmentDialogProps {
  institutionSlug: string;
  academicYearId: string;
  feeStructures: PickerOption[];
  onAssigned?: () => void;
}

export function FeeAssignmentDialog({
  institutionSlug,
  academicYearId,
  feeStructures,
  onAssigned,
}: FeeAssignmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [feeStructureId, setFeeStructureId] = useState(feeStructures[0]?.id ?? "");
  const [concessions, setConcessions] = useState<ConcessionDraft[]>([]);

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(async () => {
    const result = await assignFeeStructure(institutionSlug, {
      studentId,
      feeStructureId,
      academicYearId,
      concessions: concessions
        .filter((c) => c.reason.trim())
        .map((c) => ({
          kind: c.kind as (typeof concessionKind.options)[number],
          head: c.head as (typeof feeHead.options)[number],
          percent: c.mode === "percent" ? Number(c.value) : undefined,
          amount: c.mode === "amount" ? Number(c.value) : undefined,
          reason: c.reason,
        })),
    });
    // Closing on success here (inside the action, not a useEffect) avoids
    // react-hooks/set-state-in-effect's cascading-render warning.
    if (result.ok) {
      onAssigned?.();
      setOpen(false);
    }
    return result;
  }, null);

  function updateConcession(index: number, patch: Partial<ConcessionDraft>) {
    setConcessions((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Assign fee structure</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign fee structure</DialogTitle>
          <DialogDescription>Concessions require a reason and are recorded with your approval.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="studentId">
              Student ID
            </label>
            <Input id="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="uuid" required />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="feeStructureId">
              Fee structure
            </label>
            <Select value={feeStructureId} onValueChange={setFeeStructureId}>
              <SelectTrigger id="feeStructureId" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {feeStructures.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Concessions</p>
            {concessions.map((c, i) => (
              <div key={i} className="grid gap-2 rounded border border-border p-2 sm:grid-cols-2">
                <Select value={c.kind} onValueChange={(v) => updateConcession(i, { kind: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {concessionKind.options.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.head} onValueChange={(v) => updateConcession(i, { head: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {feeHead.options.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.mode} onValueChange={(v) => updateConcession(i, { mode: v as "percent" | "amount" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">% of the component</SelectItem>
                    <SelectItem value="amount">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={c.value}
                  onChange={(e) => updateConcession(i, { value: e.target.value })}
                />
                <Input
                  className="sm:col-span-2"
                  placeholder="Reason (required)"
                  value={c.reason}
                  onChange={(e) => updateConcession(i, { reason: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="sm:col-span-2"
                  onClick={() => setConcessions((rows) => rows.filter((_, idx) => idx !== i))}
                >
                  Remove concession
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setConcessions((rows) => [...rows, emptyConcession()])}>
              Add concession
            </Button>
          </div>

          {state && !state.ok && (
            <p role="alert" className="text-destructive text-sm">
              {state.error.message}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !feeStructureId || !studentId.trim()}>
              {pending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
