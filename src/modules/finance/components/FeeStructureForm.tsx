"use client";

// T-031 — 06 §W9 fee structure form. One `upsertFeeStructure` call on
// submit for the structure + all its components (packet: components upsert
// by head, so re-saving the same set updates rather than duplicating).
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { upsertFeeStructure } from "@/modules/finance/actions";
import { feeFrequency, feeHead } from "@/modules/finance/schemas";
import type { FeeStructureDetail, PickerOption } from "@/modules/finance/queries";

interface FeeStructureFormProps {
  institutionSlug: string;
  academicYears: PickerOption[];
  grades: PickerOption[];
  initial?: FeeStructureDetail;
}

interface ComponentDraft {
  head: string;
  amount: string;
  frequency: string;
  appliesToNewOnly: boolean;
}

function emptyComponent(): ComponentDraft {
  return { head: feeHead.options[0], amount: "0", frequency: feeFrequency.options[2], appliesToNewOnly: false };
}

export function FeeStructureForm({ institutionSlug, academicYears, grades, initial }: FeeStructureFormProps) {
  const [academicYearId, setAcademicYearId] = useState(initial?.academicYearId ?? academicYears[0]?.id ?? "");
  const [gradeId, setGradeId] = useState(initial?.gradeId ?? grades[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [components, setComponents] = useState<ComponentDraft[]>(
    initial?.components.map((c) => ({ head: c.head, amount: String(c.amount), frequency: c.frequency, appliesToNewOnly: c.appliesToNewOnly })) ?? [
      emptyComponent(),
    ],
  );

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(async () => {
    return upsertFeeStructure(institutionSlug, {
      id: initial?.id,
      academicYearId,
      gradeId,
      name,
      components: components.map((c) => ({
        head: c.head as (typeof feeHead.options)[number],
        amount: Number(c.amount),
        frequency: c.frequency as (typeof feeFrequency.options)[number],
        appliesToNewOnly: c.appliesToNewOnly,
      })),
    });
  }, null);

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setComponents((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-sm font-medium" htmlFor="academicYearId">
            Academic year
          </label>
          <Select value={academicYearId} onValueChange={setAcademicYearId}>
            <SelectTrigger id="academicYearId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {academicYears.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="gradeId">
            Grade
          </label>
          <Select value={gradeId} onValueChange={setGradeId}>
            <SelectTrigger id="gradeId" className="w-full">
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
        <div>
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Components</p>
        {components.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Select value={c.head} onValueChange={(v) => updateComponent(i, { head: v })}>
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
            <Input
              type="number"
              min="0"
              step="0.01"
              value={c.amount}
              onChange={(e) => updateComponent(i, { amount: e.target.value })}
            />
            <Select value={c.frequency} onValueChange={(v) => updateComponent(i, { frequency: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {feeFrequency.options.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => setComponents((rows) => rows.filter((_, idx) => idx !== i))}
              disabled={components.length === 1}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setComponents((rows) => [...rows, emptyComponent()])}>
          Add component
        </Button>
      </div>

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}

      <Button type="submit" disabled={pending || !name.trim() || !academicYearId || !gradeId}>
        {pending ? "Saving…" : "Save structure"}
      </Button>
    </form>
  );
}
