"use client";

// T-031 — "Generate Term invoices" control (AC3). Synchronous per-student
// path through `public.generate_invoice` (packet rule 5) — the action has a
// soft time budget and reports `remaining` when it stops early; reruns are
// safe (generate_invoice is idempotent) so the UI just invites another
// click.
// Fix round 1 (code review, HIGH): no "All grades" option — the sync path
// has no deadline-safe way to cover a whole school in one request.
// T-031 phase 2: "All grades" is back, now routed through
// `public.enqueue_term_invoices` (job queue) instead of the synchronous
// per-student loop; picking a specific grade still uses the sync path.
import { Label } from "@/components/ui/label";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { generateTermInvoices, type EnqueueTermInvoicesResult, type GenerateTermInvoicesResult } from "@/modules/finance/actions";
import type { PickerOption } from "@/modules/finance/queries";

const ALL_GRADES = "__all__";

interface GenerateInvoicesPanelProps {
  institutionSlug: string;
  terms: PickerOption[];
  grades: PickerOption[];
}

export function GenerateInvoicesPanel({ institutionSlug, terms, grades }: GenerateInvoicesPanelProps) {
  const router = useRouter();
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [gradeId, setGradeId] = useState(ALL_GRADES);

  const [state, formAction, pending] = useActionState<
    ActionResult<GenerateTermInvoicesResult | EnqueueTermInvoicesResult> | null,
    FormData
  >(async () => {
    const result = await generateTermInvoices(institutionSlug, {
      termId,
      gradeId: gradeId === ALL_GRADES ? undefined : gradeId,
    });
    if (result.ok) router.refresh();
    return result;
  }, null);

  if (terms.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:flex-row sm:flex-wrap sm:items-end">
      <div>
        <Label className="mb-1 block" htmlFor="genTermId">
          Term
        </Label>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger id="genTermId" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {terms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mb-1 block" htmlFor="genGradeId">
          Grade
        </Label>
        <Select value={gradeId} onValueChange={setGradeId}>
          <SelectTrigger id="genGradeId" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GRADES}>All grades</SelectItem>
            {grades.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending || !termId}>
        {pending ? "Generating…" : "Generate Term invoices"}
      </Button>
      {state && (
        <p className={state.ok ? "text-sm sm:basis-full" : "text-destructive text-sm sm:basis-full"} role={state.ok ? "status" : "alert"}>
          {state.ok
            ? state.data.mode === "enqueued"
              ? "Queued — invoices will be generated in the background."
              : state.data.remaining > 0
                ? `Generated ${state.data.generated}, ${state.data.alreadyExisted} already had one, ${state.data.failed} failed — ${state.data.remaining} remaining. Run again to continue.`
                : `Generated ${state.data.generated}, ${state.data.alreadyExisted} already had one, ${state.data.failed} failed. Done.`
            : state.error.message}
        </p>
      )}
    </form>
  );
}
