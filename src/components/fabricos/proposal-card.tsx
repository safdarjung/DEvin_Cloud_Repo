"use client";

import { useState } from "react";
import { Check, PencilLine, X } from "lucide-react";
import { cn } from "cn";
import { TRUST } from "./content";

type Decision = "pending" | "approved" | "editing" | "declined";

const STATUS: Record<Decision, { text: string; cls: string }> = {
  pending: { text: "Waiting for a person", cls: "text-(color:--fos-warn)" },
  approved: { text: "Approved. Queued to send.", cls: "text-(color:--fos-ok)" },
  editing: { text: "Opened for editing. Nothing sent.", cls: "text-(color:--fos-cyan)" },
  declined: { text: "Declined. Nothing sent.", cls: "text-(color:--fos-muted)" },
};

/** Illustrative only: the buttons change this card's local state and nothing else. */
export function ProposalCard() {
  const [decision, setDecision] = useState<Decision>("pending");
  const p = TRUST.proposal;
  const s = STATUS[decision];
  const btn = "fos-btn min-h-11 px-4 text-sm";

  return (
    <div className="relative rounded-[20px] border border-(color:--fos-line-strong) bg-(color:--fos-surface) p-6 shadow-[0_40px_100px_-40px_rgb(75_82_200_/_0.6)] sm:p-8">
      <p className="fos-tag">{p.label}</p>
      <h3 className="mt-5 text-xl font-medium tracking-[-0.02em] text-(color:--fos-fg) sm:text-2xl">{p.title}</h3>
      <p className="mt-3 leading-relaxed text-(color:--fos-muted)">{p.detail}</p>

      <div className="mt-6 flex items-center gap-2 text-sm" role="status">
        <span aria-hidden className={cn("size-2 rounded-full bg-current", s.cls)} />
        <span className={s.cls}>{s.text}</span>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-(color:--fos-line) pt-6">
        <button type="button" className={cn(btn, "fos-btn-primary")} aria-pressed={decision === "approved"} onClick={() => setDecision("approved")}>
          <Check className="size-4" aria-hidden />
          Approve
        </button>
        <button type="button" className={cn(btn, "fos-btn-ghost")} aria-pressed={decision === "editing"} onClick={() => setDecision("editing")}>
          <PencilLine className="size-4" aria-hidden />
          Edit
        </button>
        <button type="button" className={cn(btn, "fos-btn-ghost")} aria-pressed={decision === "declined"} onClick={() => setDecision("declined")}>
          <X className="size-4" aria-hidden />
          Decline
        </button>
        {decision !== "pending" ? (
          <button type="button" className="ml-auto min-h-11 px-2 text-sm text-(color:--fos-muted) underline hover:text-(color:--fos-fg)" onClick={() => setDecision("pending")}>
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
