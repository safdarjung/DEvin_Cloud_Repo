"use client";

// Promote a whole year: map each from-section to a to-section (or graduate), review, then confirm.
// Promotion is hard to undo, so the final button names the student count. UX gate only: the action re-checks `academics.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { promote } from "@/modules/lifecycle/actions";
import type { PromotionPlan } from "@/modules/lifecycle/queries";

export function PromoteForm({ institutionSlug, fromYearId, toYearId, plan, suggested }: { institutionSlug: string; fromYearId: string; toYearId: string; plan: PromotionPlan; suggested: Record<string, string | null> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<Record<string, string | null>>(suggested);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moving = plan.from.filter((s) => target[s.id]);
  const graduating = plan.from.filter((s) => !target[s.id]);
  const count = (list: typeof plan.from) => list.reduce((n, s) => n + s.students, 0);
  const label = (id: string | null) => plan.to.find((t) => t.id === id)?.label ?? "Graduate (leave school roll)";

  function confirm() {
    start(async () => {
      const res = await promote(institutionSlug, { fromYearId, toYearId, mappings: plan.from.map((s) => ({ fromSectionId: s.id, toSectionId: target[s.id] ?? null })) });
      if (res.ok) {
        setError(null);
        setReview(false);
        toast.success(`Promoted ${res.data.promoted}, graduated ${res.data.graduated}${res.data.skippedStudentIds.length ? `, skipped ${res.data.skippedStudentIds.length} already enrolled` : ""}`);
        router.refresh();
      } else {
        setError(describeActionError(res.error));
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <div className="space-y-4" aria-busy={pending}>
      <table className="w-full text-sm">
        <caption className="sr-only">Promotion mapping</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">From section</th>
            <th className="py-1 pr-3 text-right font-medium">Students</th>
            <th className="py-1 font-medium">Moves to</th>
          </tr>
        </thead>
        <tbody>
          {plan.from.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className="py-2 pr-3 font-medium">{s.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.students}</td>
              <td className="py-2">
                <select
                  aria-label={`Target for ${s.label}`}
                  value={target[s.id] ?? ""}
                  disabled={review}
                  onChange={(e) => setTarget({ ...target, [s.id]: e.target.value || null })}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Graduate (leave school roll)</option>
                  {plan.to.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!review ? (
        <Button type="button" onClick={() => setReview(true)} disabled={count(plan.from) === 0}>
          Review promotion
        </Button>
      ) : (
        <div role="alertdialog" aria-labelledby="promote-confirm" className="space-y-3 rounded-md border border-destructive/40 p-4">
          <h3 id="promote-confirm" className="text-sm font-semibold">
            Promote {count(moving)} student{count(moving) === 1 ? "" : "s"} and graduate {count(graduating)}?
          </h3>
          <ul className="list-disc pl-5 text-sm">
            {plan.from.filter((s) => s.students > 0).map((s) => (
              <li key={s.id}>
                {s.label} ({s.students}) to {label(target[s.id] ?? null)}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">This creates new enrolments and closes the old ones. It cannot be undone from this page.</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
              {pending ? "Promoting…" : `Promote ${count(moving)} + graduate ${count(graduating)}`}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
