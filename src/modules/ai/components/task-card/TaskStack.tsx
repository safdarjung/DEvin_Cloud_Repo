"use client";
// Several proposals from one answer: one card at a time with "1 of 3", state of every card kept.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { canApproveAll } from "./fields";
import { useResolutions } from "./store";
import TaskCard, { type TaskCardHandle, type TaskCardProps } from "./TaskCard";

type Props = Pick<TaskCardProps, "institutionSlug" | "onResolved" | "onStart" | "compact"> & { proposals: readonly TaskProposalOutput[] };

export default function TaskStack({ proposals, institutionSlug, onResolved, onStart, compact }: Props) {
  const [index, setIndex] = useState(0);
  const [bulk, setBulk] = useState(false);
  const handles = useRef(new Map<string, TaskCardHandle | null>());
  const done = useResolutions(proposals.map((p) => p.proposalId));

  if (proposals.length === 1) {
    return <TaskCard proposal={proposals[0]} institutionSlug={institutionSlug} onResolved={onResolved} onStart={onStart} compact={compact} />;
  }

  const open = proposals.filter((p) => !done.has(p.proposalId));
  const showAll = open.length > 1 && canApproveAll(open.map((p) => p.view));

  async function approveAll() {
    setBulk(true);
    for (const p of proposals) {
      if (done.has(p.proposalId)) continue;
      const ok = await handles.current.get(p.proposalId)?.approve();
      if (!ok) break; // stop at the first card that needs attention
      await new Promise((r) => setTimeout(r, 0)); // let the next card see this approval
    }
    setBulk(false);
  }

  return (
    <section aria-label={`${proposals.length} proposed tasks`} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">{index + 1} of {proposals.length}</p>
        <div className="flex gap-1">
          <Button type="button" variant="outline" className="h-11" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</Button>
          <Button type="button" variant="outline" className="h-11" disabled={index === proposals.length - 1} onClick={() => setIndex(index + 1)}>Next</Button>
        </div>
      </div>
      {proposals.map((p, i) => (
        <div key={p.proposalId} hidden={i !== index}>
          <TaskCard
            proposal={p}
            institutionSlug={institutionSlug}
            onResolved={onResolved}
            onStart={onStart}
            compact={compact}
            controlRef={(h) => {
              handles.current.set(p.proposalId, h);
            }}
          />
        </div>
      ))}
      {showAll && (
        <Button type="button" className="h-11" onClick={approveAll} disabled={bulk}>
          {bulk ? "Approving…" : `Approve all ${open.length}`}
        </Button>
      )}
    </section>
  );
}
