"use client";

// Workflow editor over the graph schema: a trigger plus ordered steps (see form-graph.ts). Server re-validates everything.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { saveWorkflow } from "@/modules/workflows/actions";
import { CONDITION_OPS, NOTIFY_ROLES, WORKFLOW_EVENTS, WORKFLOW_METRICS } from "@/modules/workflows/catalog";
import { buildGraph, type StepForm, type StepType, type WorkflowForm } from "@/modules/workflows/form-graph";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";
const OPS: Record<string, string> = { gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most", eq: "equals" };
const STEP_LABEL: Record<StepType, string> = { condition: "Check a number", notify: "Notify", agent: "Ask an agent", approval: "Wait for approval", report: "Send a report" };

export interface FormOptions {
  agents: string[];
  reports: { id: string; name: string }[];
  /** notify -> fee_defaulters needs the finance_plus module */
  feeReminders: boolean;
}

const newStep = (type: StepType, opts: FormOptions): StepForm => {
  const base = { type, label: STEP_LABEL[type] };
  switch (type) {
    case "condition":
      return { ...base, config: { metric: "exams.papers_next_7_days", op: "gte", value: "1" } };
    case "notify":
      return { ...base, config: { audience: "roles", roles: "principal", message: "" } };
    case "agent":
      return { ...base, config: { agent: opts.agents[0] ?? "", task: "" } };
    case "approval":
      return { ...base, config: { prompt: "" } };
    case "report":
      return { ...base, config: { scheduledReportId: opts.reports[0]?.id ?? "" } };
  }
};

export function WorkflowEditor({ institutionSlug, id, initialName, initial, options, cancelHref }: { institutionSlug: string; id?: string; initialName: string; initial: WorkflowForm; options: FormOptions; cancelHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initialName);
  const [trigger, setTrigger] = useState(initial.trigger);
  const [steps, setSteps] = useState(initial.steps);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const kind = trigger.config.kind;
  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch, config: patch.config ?? s.config } : s)));
  const setCfg = (i: number, k: string, v: string) => setStep(i, { config: { ...steps[i]!.config, [k]: v } });

  function pickTrigger(k: string) {
    const config: Record<string, string> = k === "schedule" ? { kind: k, cron: "0 16 * * 1-6" } : k === "event" ? { kind: k, event: "attendance.absences_submitted" } : { kind: "manual" };
    setTrigger({ label: k === "manual" ? "Run by hand" : k === "event" ? "When something happens" : "On a schedule", config });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { nodes, edges } = buildGraph({ trigger, steps });
    start(async () => {
      const res = await saveWorkflow(institutionSlug, { ...(id ? { id } : {}), name, nodes, edges });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        return void toast.error(describeActionError(res.error));
      }
      setErrors({});
      toast.success("Workflow saved");
      router.push(cancelHref);
      router.refresh();
    });
  }

  const eventMetricsOk = kind === "event";
  const fe = (k: string) => errors[k]?.length ? <ul role="alert" className="mt-1 list-disc pl-4 text-xs text-destructive">{errors[k]!.map((m) => <li key={m}>{m}</li>)}</ul> : null;
  return (
    <form className="space-y-5" aria-busy={pending} onSubmit={submit}>
      <div className="max-w-md">
        <Label htmlFor="wf-name">Name</Label>
        <Input id="wf-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
        {fe("name")}
      </div>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">Starts</legend>
        <Label htmlFor="wf-trigger">Trigger</Label>
        <select id="wf-trigger" className={`${SELECT} max-w-sm`} value={kind} onChange={(e) => pickTrigger(e.target.value)}>
          <option value="manual">Run by hand</option>
          <option value="schedule">On a schedule</option>
          <option value="event">When something happens</option>
        </select>
        {kind === "schedule" && (
          <div className="max-w-sm">
            <Label htmlFor="wf-cron">Schedule (cron, e.g. 0 16 * * 1-6)</Label>
            <Input id="wf-cron" value={trigger.config.cron ?? ""} maxLength={100} onChange={(e) => setTrigger({ ...trigger, config: { kind: "schedule", cron: e.target.value } })} />
          </div>
        )}
        {kind === "event" && (
          <div className="max-w-sm">
            <Label htmlFor="wf-event">Event</Label>
            <select id="wf-event" className={SELECT} value={trigger.config.event} onChange={(e) => setTrigger({ ...trigger, config: { kind: "event", event: e.target.value } })}>
              {Object.entries(WORKFLOW_EVENTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Step {i + 1}: {STEP_LABEL[s.type]}
              </h3>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="outline" disabled={i === 0} aria-label={`Move step ${i + 1} up`} onClick={() => setSteps(steps.map((x, j) => (j === i - 1 ? steps[i]! : j === i ? steps[i - 1]! : x)))}>
                  Up
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`} onClick={() => setSteps(steps.map((x, j) => (j === i + 1 ? steps[i]! : j === i ? steps[i + 1]! : x)))}>
                  Down
                </Button>
                <Button type="button" size="sm" variant="outline" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>
            <div className="max-w-md">
              <Label htmlFor={`st-label-${i}`}>Step name</Label>
              <Input id={`st-label-${i}`} value={s.label} maxLength={60} onChange={(e) => setStep(i, { label: e.target.value })} />
            </div>
            {s.type === "condition" && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <Label htmlFor={`st-m-${i}`}>Number to check</Label>
                  <select id={`st-m-${i}`} className={SELECT} value={s.config.metric} onChange={(e) => setCfg(i, "metric", e.target.value)}>
                    {Object.entries(WORKFLOW_METRICS)
                      .filter(([, m]) => !m.event || eventMetricsOk)
                      .map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`st-o-${i}`}>Test</Label>
                  <select id={`st-o-${i}`} className={SELECT} value={s.config.op} onChange={(e) => setCfg(i, "op", e.target.value)}>
                    {CONDITION_OPS.map((o) => (
                      <option key={o} value={o}>
                        {OPS[o]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`st-v-${i}`}>Value</Label>
                  <Input id={`st-v-${i}`} inputMode="numeric" value={s.config.value} maxLength={6} onChange={(e) => setCfg(i, "value", e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-3">If the test fails, the workflow ends here.</p>
              </div>
            )}
            {s.type === "notify" && (
              <div className="space-y-2">
                <div className="max-w-sm">
                  <Label htmlFor={`st-a-${i}`}>Who</Label>
                  <select id={`st-a-${i}`} className={SELECT} value={s.config.audience} onChange={(e) => setStep(i, { config: e.target.value === "roles" ? { audience: "roles", roles: "principal", message: "" } : { audience: "fee_defaulters" } })}>
                    <option value="roles">Staff roles</option>
                    {(options.feeReminders || s.config.audience === "fee_defaulters") && <option value="fee_defaulters">Families with overdue fees (needs an approval step before it)</option>}
                  </select>
                </div>
                {s.config.audience === "roles" && (
                  <>
                    <fieldset>
                      <legend className="text-sm font-medium">Roles</legend>
                      <div className="flex flex-wrap gap-3 pt-1">
                        {NOTIFY_ROLES.map((r) => {
                          const on = (s.config.roles ?? "").split(",").includes(r);
                          return (
                            <label key={r} className="flex items-center gap-1 text-sm">
                              <input type="checkbox" checked={on} onChange={() => setCfg(i, "roles", NOTIFY_ROLES.filter((x) => (x === r ? !on : (s.config.roles ?? "").split(",").includes(x))).join(","))} />
                              {r.replace("_", " ")}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    <div>
                      <Label htmlFor={`st-msg-${i}`}>Message (use {"{count}"} once for the number found)</Label>
                      <Input id={`st-msg-${i}`} value={s.config.message ?? ""} maxLength={200} onChange={(e) => setCfg(i, "message", e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            )}
            {s.type === "agent" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`st-ag-${i}`}>Agent</Label>
                  <select id={`st-ag-${i}`} className={SELECT} value={s.config.agent} onChange={(e) => setCfg(i, "agent", e.target.value)}>
                    {options.agents.map((a) => (
                      <option key={a} value={a}>
                        {a.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`st-t-${i}`}>Task for the agent</Label>
                  <Input id={`st-t-${i}`} value={s.config.task ?? ""} maxLength={500} onChange={(e) => setCfg(i, "task", e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">The agent only drafts; a person saves any result.</p>
              </div>
            )}
            {s.type === "approval" && (
              <div className="max-w-md">
                <Label htmlFor={`st-p-${i}`}>Question to the approver</Label>
                <Input id={`st-p-${i}`} value={s.config.prompt ?? ""} maxLength={120} onChange={(e) => setCfg(i, "prompt", e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">If rejected, the workflow ends here.</p>
              </div>
            )}
            {s.type === "report" && (
              <div className="max-w-md">
                <Label htmlFor={`st-r-${i}`}>Scheduled report</Label>
                <select id={`st-r-${i}`} className={SELECT} value={s.config.scheduledReportId} onChange={(e) => setCfg(i, "scheduledReportId", e.target.value)}>
                  {options.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {(["condition", "notify", "approval"] as StepType[])
          .concat(options.agents.length ? ["agent" as StepType] : [], options.reports.length ? ["report" as StepType] : [])
          .map((t) => (
            <Button key={t} type="button" variant="outline" size="sm" onClick={() => setSteps([...steps, newStep(t, options)])}>
              Add: {STEP_LABEL[t]}
            </Button>
          ))}
      </div>
      {fe("graph")}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save workflow"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
