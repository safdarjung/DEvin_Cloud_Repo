"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { createExamPapers } from "@/modules/exams/actions";
import type { SectionOption, SubjectOption } from "@/modules/exams/queries";

interface PaperGridProps {
  institutionSlug: string;
  examId: string;
  sections: SectionOption[];
  subjects: SubjectOption[];
  defaultMaxMarks: number;
  defaultPassPercentage: number;
}

function cellKey(sectionId: string, subjectId: string): string {
  return `${sectionId}:${subjectId}`;
}

/** 06 §W7's "defaults max 80/pass 26.4 rounded per settings pass_percentage" — one shared max/pass% for every selected cell, computed here, sent explicitly per paper (the schema requires it; the DB doesn't know about settings). */
export function PaperGrid({ institutionSlug, examId, sections, subjects, defaultMaxMarks, defaultPassPercentage }: PaperGridProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxMarks, setMaxMarks] = useState(defaultMaxMarks);
  const [passPercentage, setPassPercentage] = useState(defaultPassPercentage);

  const passMarks = useMemo(() => Math.round(maxMarks * (passPercentage / 100) * 100) / 100, [maxMarks, passPercentage]);

  function toggle(sectionId: string, subjectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = cellKey(sectionId, subjectId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRow(sectionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const rowKeys = subjects.map((s) => cellKey(sectionId, s.id));
      const allSelected = rowKeys.every((k) => next.has(k));
      for (const key of rowKeys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  const [state, formAction, pending] = useActionState<ActionResult<{ count: number }> | null, FormData>(
    async () =>
      createExamPapers(institutionSlug, {
        examId,
        papers: [...selected].map((key) => {
          const [classSectionId, subjectId] = key.split(":");
          return { classSectionId, subjectId, maxMarks, passMarks };
        }),
      }),
    null,
  );

  if (state?.ok) {
    router.push(`/${institutionSlug}/exams/${examId}`);
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-end gap-4">
        <div>
          <label className="text-sm font-medium" htmlFor="maxMarks">
            Max marks
          </label>
          <Input
            id="maxMarks"
            type="number"
            min={1}
            value={maxMarks}
            onChange={(e) => setMaxMarks(Number(e.target.value) || 0)}
            className="w-28"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="passPercentage">
            Pass %
          </label>
          <Input
            id="passPercentage"
            type="number"
            min={0}
            max={100}
            value={passPercentage}
            onChange={(e) => setPassPercentage(Number(e.target.value) || 0)}
            className="w-28"
          />
        </div>
        <p className="text-muted-foreground text-sm">Pass marks: {passMarks}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Section</th>
              {subjects.map((subject) => (
                <th key={subject.id} className="p-2 text-left">
                  {subject.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.id} className="border-t border-border">
                <td className="p-2">
                  <button type="button" className="font-medium hover:underline" onClick={() => toggleRow(section.id)}>
                    {section.label}
                  </button>
                </td>
                {subjects.map((subject) => (
                  <td key={subject.id} className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`${section.label} ${subject.name}`}
                      checked={selected.has(cellKey(section.id, subject.id))}
                      onChange={() => toggle(section.id, subject.id)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}

      <Button type="submit" disabled={pending || selected.size === 0}>
        {pending ? "Creating…" : `Create ${selected.size} paper${selected.size === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
