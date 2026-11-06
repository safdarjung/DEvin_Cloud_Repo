"use client";

// F-UI-04 — edits one existing intervention plan (insight_actions kind
// 'intervention', M20). No "create" control here: app.guard_intervention's
// RLS (0093) blocks a direct authenticated INSERT on purpose — only the gap
// detector job proposes new plans (mastery/detector.ts), staff review/
// update them. "Assign owner" is omitted the same way: owner_staff_id isn't
// in updateIntervention's column grant.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateIntervention } from "@/modules/mastery/actions";
import type { InterventionPlan } from "@/modules/fabric/types";

const NEXT_STATUS: Record<InterventionPlan["status"], InterventionPlan["status"][]> = {
  proposed: ["proposed", "active", "closed"],
  active: ["active", "review", "closed"],
  review: ["review", "active", "closed"],
  closed: ["closed"],
};

export function InterventionEditor({
  institutionSlug,
  plan,
  canEdit,
}: {
  institutionSlug: string;
  plan: InterventionPlan;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = plan.status === "closed" || !canEdit;

  function save(patch: { steps?: InterventionPlan["steps"]; status?: InterventionPlan["status"] }) {
    start(async () => {
      const result = await updateIntervention(institutionSlug, { id: plan.id, ...patch });
      if (result.ok) {
        toast.success("Plan updated.");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Restricted record — only this student&apos;s class teacher, the principal, or the owner can view or edit this plan.</span>
      </div>

      <p className="text-sm">
        <span className="font-medium">Goal: </span>
        {plan.goal}
      </p>
      <p className="text-xs text-muted-foreground">
        Owner: {plan.owner} · Review by {plan.review_date}
      </p>

      <ul className="space-y-1.5">
        {plan.steps.map((step, i) => (
          <li key={step.title} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`Mark step "${step.title}" ${step.done ? "not done" : "done"}`}
              checked={step.done}
              disabled={locked || pending}
              onChange={(e) =>
                save({ steps: plan.steps.map((s, j) => (j === i ? { ...s, done: e.target.checked } : s)) })
              }
              className="size-4"
            />
            <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.title}</span>
            <span className="text-xs text-muted-foreground">due {step.due}</span>
          </li>
        ))}
      </ul>

      <Select value={plan.status} disabled={locked || pending} onValueChange={(v) => save({ status: v as InterventionPlan["status"] })}>
        <SelectTrigger className="w-40" aria-label="Plan status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NEXT_STATUS[plan.status].map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
