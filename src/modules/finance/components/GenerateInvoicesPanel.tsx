"use client";

// T-031 — "Generate Term invoices" control (AC3). Synchronous per-student
// path through `public.generate_invoice` (packet rule 5) — the action has a
// soft time budget and reports `remaining` when it stops early; reruns are
// safe (generate_invoice is idempotent) so the UI just invites another
// click.
// Fix round 1 (code review, HIGH): no "All grades" option — the sync path
// has no deadline-safe way to cover a whole school in one request. A grade
// is required (schema enforces it too). Whole-school runs are phase 2.
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { generateTermInvoices, type GenerateTermInvoicesResult } from "@/modules/finance/actions";
import type { PickerOption } from "@/modules/finance/queries";

interface GenerateInvoicesPanelProps {
  institutionSlug: string;
  terms: PickerOption[];
  grades: PickerOption[];
}

export function GenerateInvoicesPanel({ institutionSlug, terms, grades }: GenerateInvoicesPanelProps) {
  const router = useRouter();
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");

  const [state, formAction, pending] = useActionState<ActionResult<GenerateTermInvoicesResult> | null, FormData>(
    async () => {
      const result = await generateTermInvoices(institutionSlug, { termId, gradeId });
      if (result.ok) router.refresh();
      return result;
    },
    null,
  );

  if (terms.length === 0 || grades.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
      <div>
        <label className="text-sm font-medium" htmlFor="genTermId">
          Term
        </label>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger id="genTermId" className="w-40">
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
        <label className="text-sm font-medium" htmlFor="genGradeId">
          Grade
        </label>
        <Select value={gradeId} onValueChange={setGradeId}>
          <SelectTrigger id="genGradeId" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {grades.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending || !termId || !gradeId}>
        {pending ? "Generating…" : "Generate Term invoices"}
      </Button>
      {state && (
        <p className={state.ok ? "text-sm" : "text-destructive text-sm"} role="status">
          {state.ok
            ? state.data.remaining > 0
              ? `Generated ${state.data.generated}, ${state.data.alreadyExisted} already had one, ${state.data.failed} failed — ${state.data.remaining} remaining. Run again to continue.`
              : `Generated ${state.data.generated}, ${state.data.alreadyExisted} already had one, ${state.data.failed} failed. Done.`
            : state.error.message}
        </p>
      )}
    </form>
  );
}
