"use client";

// "Where used": the question papers that copied this bank question (questionPapers.whereUsed, RLS-scoped).
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ActionResult } from "@/lib/actions/result";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import type { WhereUsedRow } from "@/modules/question-papers/queries";
import { PAPER_STATUS_LABEL } from "@/modules/question-papers/components/paper-ui";

export function WhereUsed({ institutionSlug, questionId }: { institutionSlug: string; questionId: string }) {
  const [rows, setRows] = useState<WhereUsedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const qs = new URLSearchParams({ institution: institutionSlug, input: JSON.stringify({ questionId }) });
    try {
      const r = (await (await fetch(`/api/v1/query/questionPapers.whereUsed?${qs}`)).json()) as ActionResult<WhereUsedRow[]>;
      if (r.ok) setRows(r.data);
      else setError(actionErrorMessage(r.error));
    } catch {
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">Where used</Button>
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="where-used">
        {error ? (
          <p role="alert" className="text-destructive">{error}</p>
        ) : rows === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">Not used in any question paper yet.</p>
        ) : (
          <ul className="space-y-1">
            {[...new Map(rows.map((r) => [r.paperId, r])).values()].map((r) => (
              <li key={r.paperId}>
                <Link className="underline underline-offset-2" href={`/${institutionSlug}/question-papers/${r.paperId}`}>{r.title}</Link>
                <span className="text-xs text-muted-foreground"> · {PAPER_STATUS_LABEL[r.status]}{r.examDate ? ` · ${r.examDate}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
