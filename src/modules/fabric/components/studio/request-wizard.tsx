"use client";

// F-UI-12 (live-fabric studio lane) — intake wizard: Problem, Context, Terms.
// Role/system/integration chips are simplified to comma-separated text
// fields (no multi-chip input exists in this codebase yet) — smallest
// complete change; split/trimmed/filtered before submit.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { humanize } from "@/lib/format";
import { submitStudioRequest } from "@/modules/fabric/studio.actions";
import { STUDIO_BUDGET_RANGES } from "@/modules/fabric/studio.schemas";

const STEPS = ["Problem", "Context", "Terms"] as const;

const EMPTY_FORM = {
  title: "",
  problem: "",
  desiredOutcome: "",
  userRoles: "",
  existingSystems: "",
  integrations: "",
  constraints: "",
  budgetRange: "unknown" as (typeof STUDIO_BUDGET_RANGES)[number],
  timeline: "",
  successCriteria: "",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function stepValid(step: number, form: typeof EMPTY_FORM): boolean {
  if (step === 0) return form.title.trim().length > 0 && form.problem.trim().length > 0 && form.desiredOutcome.trim().length > 0;
  if (step === 2) return form.timeline.trim().length > 0 && form.successCriteria.trim().length > 0;
  return true;
}

export function RequestWizard({ institutionSlug, base }: { institutionSlug: string; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setStep(0);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function submit() {
    start(async () => {
      setError(null);
      const res = await submitStudioRequest(institutionSlug, {
        title: form.title,
        problem: form.problem,
        desiredOutcome: form.desiredOutcome,
        userRoles: splitList(form.userRoles),
        existingSystems: splitList(form.existingSystems),
        integrations: splitList(form.integrations),
        constraints: form.constraints,
        budgetRange: form.budgetRange,
        timeline: form.timeline,
        successCriteria: form.successCriteria,
      });
      if (!res.ok) {
        setError(res.error.message);
        toast.error(res.error.message);
        return;
      }
      toast.success("Request submitted");
      close();
      router.push(`${base}?request=${res.data.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New request
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New studio request</DialogTitle>
            <DialogDescription>
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </DialogDescription>
          </DialogHeader>
          <nav aria-label="Wizard progress" className="flex gap-1">
            {STEPS.map((label, i) => (
              <span
                key={label}
                aria-current={i === step ? "step" : undefined}
                className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </nav>

          {step === 0 && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="sr-title">Title</Label>
                <Input id="sr-title" value={form.title} maxLength={200} required onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-problem">Problem</Label>
                <Textarea id="sr-problem" rows={3} value={form.problem} maxLength={2000} required onChange={(e) => setForm((f) => ({ ...f, problem: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-outcome">Desired outcome</Label>
                <Textarea
                  id="sr-outcome"
                  rows={3}
                  value={form.desiredOutcome}
                  maxLength={2000}
                  required
                  onChange={(e) => setForm((f) => ({ ...f, desiredOutcome: e.target.value }))}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="sr-roles">User roles (comma separated)</Label>
                <Input id="sr-roles" value={form.userRoles} onChange={(e) => setForm((f) => ({ ...f, userRoles: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-systems">Existing systems (comma separated)</Label>
                <Input id="sr-systems" value={form.existingSystems} onChange={(e) => setForm((f) => ({ ...f, existingSystems: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-integrations">Integrations needed (comma separated)</Label>
                <Input id="sr-integrations" value={form.integrations} onChange={(e) => setForm((f) => ({ ...f, integrations: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-constraints">Constraints</Label>
                <Textarea id="sr-constraints" rows={2} value={form.constraints} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, constraints: e.target.value }))} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="sr-budget">Budget range</Label>
                <Select value={form.budgetRange} onValueChange={(v) => setForm((f) => ({ ...f, budgetRange: v as typeof f.budgetRange }))}>
                  <SelectTrigger id="sr-budget" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDIO_BUDGET_RANGES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {humanize(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sr-timeline">Timeline</Label>
                <Input id="sr-timeline" value={form.timeline} maxLength={100} required onChange={(e) => setForm((f) => ({ ...f, timeline: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="sr-success">Success criteria</Label>
                <Textarea
                  id="sr-success"
                  rows={2}
                  value={form.successCriteria}
                  maxLength={1000}
                  required
                  onChange={(e) => setForm((f) => ({ ...f, successCriteria: e.target.value }))}
                />
              </div>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!stepValid(step, form)}>
                Next
              </Button>
            ) : (
              <Button type="button" onClick={submit} disabled={pending || !stepValid(step, form)}>
                {pending ? "Submitting…" : "Submit request"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
