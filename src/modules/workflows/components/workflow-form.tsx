"use client";

// Workflow editor over the graph schema: a trigger plus ordered steps (see form-graph.ts).
// "Describe what you want" (AI, when on for this role) and the starter templates only fill
// this form as a draft; nothing is saved until "Save". The server re-validates everything.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeActionError } from "@/lib/action-error";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";
import { WORKFLOW_DESCRIPTION_MAX } from "@/modules/ai/workflow-drafts";
import { saveWorkflow, setWorkflowStatus } from "@/modules/workflows/actions";
import { CONDITION_OPS, NOTIFY_ROLES, SECTION_METRICS, WORKFLOW_EVENTS, WORKFLOW_METRICS } from "@/modules/workflows/catalog";
import { cronFromPick, DAY_LONG, describeCron, EVENT_PHRASES, OP_WORDS, pickFromCron, SCHEDULE_FREQUENCIES, type ScheduleFrequency, type SchedulePick } from "@/modules/workflows/describe";
import { buildGraph, validateWorkflowForm, type FormErrors, type StepForm, type StepType, type WorkflowForm } from "@/modules/workflows/form-graph";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive sm:h-9";
const STEP_LABEL: Record<StepType, string> = { condition: "Check a number", notify: "Notify", agent: "Ask an agent", approval: "Wait for approval", report: "Send a report" };
const TRIGGER_LABEL: Record<string, string> = { manual: "Run by hand", schedule: "On a schedule", event: "When something happens" };
const DEFAULT_PICK: SchedulePick = { frequency: "mon_sat", day: 1, time: "16:00" };

export interface FormOptions {
  /** Catalog agents plus this school's custom agents. */
  agents: { slug: string; name: string }[];
  reports: { id: string; name: string }[];
  sections: { id: string; label: string }[];
  /** notify -> fee_defaulters needs the finance_plus module */
  feeReminders: boolean;
  /** AI on for this school and role (aiTaskOn workflow_draft). */
  aiOn: boolean;
  /** Starter templates (templates.ts) that fit this form. */
  templates: { key: string; name: string; form: WorkflowForm }[];
}

const newStep = (type: StepType, opts: FormOptions): StepForm => {
  const base = { type, label: STEP_LABEL[type] };
  switch (type) {
    case "condition":
      return { ...base, config: { metric: "", op: "gte", value: "1" } };
    case "notify":
      return { ...base, config: { audience: "roles", roles: "principal", message: "" } };
    case "agent":
      return { ...base, config: { agent: opts.agents[0]?.slug ?? "", task: "" } };
    case "approval":
      return { ...base, config: { prompt: "" } };
    case "report":
      return { ...base, config: { scheduledReportId: opts.reports[0]?.id ?? "" } };
  }
};

function FieldError({ errors, k }: { errors: FormErrors; k: string }) {
  const list = errors[k];
  if (!list?.length) return null;
  return (
    <ul id={`err-${k}`} role="alert" className="mt-1 list-disc pl-4 text-xs text-destructive">
      {list.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

/** Props that tie a control to its inline error. */
const invalid = (errors: FormErrors, k: string) => (errors[k]?.length ? { "aria-invalid": true, "aria-describedby": `err-${k}` } : {});

function SchedulePicker({ cron, onChange, errors }: { cron: string; onChange: (cron: string) => void; errors: FormErrors }) {
  const pick = pickFromCron(cron);
  if (!pick) {
    return (
      <div className="max-w-sm space-y-1">
        <p className="text-sm">{describeCron(cron)}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(cronFromPick(DEFAULT_PICK))}>
          Use the schedule picker
        </Button>
      </div>
    );
  }
  const set = (patch: Partial<SchedulePick>) => onChange(cronFromPick({ ...pick, ...patch }));
  return (
    <div className="space-y-1">
      <div className="grid max-w-xl gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor="wf-freq">How often</Label>
          <select id="wf-freq" className={SELECT} value={pick.frequency} onChange={(e) => set({ frequency: e.target.value as ScheduleFrequency })} {...invalid(errors, "trigger.cron")}>
            {Object.entries(SCHEDULE_FREQUENCIES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {pick.frequency === "weekly" && (
          <div>
            <Label htmlFor="wf-day">Day</Label>
            <select id="wf-day" className={SELECT} value={pick.day} onChange={(e) => set({ day: Number(e.target.value) })}>
              {DAY_LONG.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="wf-time">Time (IST)</Label>
          <Input id="wf-time" type="time" step={300} value={pick.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Runs: {describeCron(cron)}</p>
      <FieldError errors={errors} k="trigger.cron" />
    </div>
  );
}

function DescribeBox({ institutionSlug, current, onDraft }: { institutionSlug: string; current: { name: string; form: WorkflowForm }; onDraft: (name: string, form: WorkflowForm) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refine = current.form.steps.length > 0;

  async function draft() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<{ name: string; form: WorkflowForm } & AiProviderMeta>("/api/ai/workflow-draft", {
      institutionSlug,
      description: text,
      ...(refine ? { currentDraft: { name: current.name, ...current.form } } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return void toast.error(res.message);
    }
    onDraft(res.data.name, res.data.form);
    toast.success("Draft ready. Review each step below, then save.");
  }

  return (
    <section aria-labelledby="wf-describe-title" className="space-y-2 rounded-lg border border-dashed p-3">
      <Label id="wf-describe-title" htmlFor="wf-describe" className="text-sm font-semibold">
        Describe what you want
      </Label>
      <Textarea
        id="wf-describe"
        maxLength={WORKFLOW_DESCRIPTION_MAX}
        className="min-h-20"
        placeholder={refine ? "e.g. Also tell the principal when more than 5 are absent" : "e.g. Number of absent students in class X A today"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || !text.trim()} onClick={draft}>
          {busy ? "Drafting…" : refine ? "Change the draft with AI" : "Draft with AI"}
        </Button>
        <span className="text-xs text-muted-foreground">AI fills the form below. Nothing is saved until you save it.</span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export function WorkflowEditor({ institutionSlug, id, initialName, initial, options, cancelHref }: { institutionSlug: string; id?: string; initialName: string; initial: WorkflowForm; options: FormOptions; cancelHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initialName);
  const [trigger, setTrigger] = useState(initial.trigger);
  const [steps, setSteps] = useState(initial.steps);
  const [errors, setErrors] = useState<FormErrors>({});
  const kind = trigger.config.kind;
  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch, config: patch.config ?? s.config } : s)));
  const setCfg = (i: number, k: string, v: string) => setStep(i, { config: { ...steps[i]!.config, [k]: v } });
  const move = (i: number, to: number) => setSteps(steps.map((x, j) => (j === to ? steps[i]! : j === i ? steps[to]! : x)));

  function load(nextName: string, form: WorkflowForm) {
    setName(nextName);
    setTrigger(form.trigger);
    setSteps(form.steps);
    setErrors({});
  }

  function pickTrigger(k: string) {
    const config: Record<string, string> = k === "schedule" ? { kind: k, cron: cronFromPick(DEFAULT_PICK) } : k === "event" ? { kind: k, event: "attendance.absences_submitted" } : { kind: "manual" };
    setTrigger({ label: TRIGGER_LABEL[k] ?? "Run by hand", config });
  }

  function setMetric(i: number, metric: string) {
    const { section, ...rest } = steps[i]!.config;
    const perSection = (SECTION_METRICS as readonly string[]).includes(metric);
    setStep(i, { config: { ...rest, metric, ...(perSection ? { section: section ?? options.sections[0]?.id ?? "" } : {}) } });
  }

  function save(turnOn: boolean) {
    const form = { trigger, steps };
    const local = validateWorkflowForm(name, form);
    if (Object.keys(local).length) {
      setErrors(local);
      return void toast.error("Fix the highlighted fields first.");
    }
    const { nodes, edges } = buildGraph(form);
    start(async () => {
      const res = await saveWorkflow(institutionSlug, { ...(id ? { id } : {}), name: name.trim(), nodes, edges });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        return void toast.error(describeActionError(res.error));
      }
      setErrors({});
      if (turnOn) {
        const on = await setWorkflowStatus(institutionSlug, { id: res.data.id, status: "active" });
        if (!on.ok) toast.error(`Saved, but not turned on: ${describeActionError(on.error)}`);
        else toast.success(kind === "manual" ? "Saved and turned on. Use Run now to run it." : "Saved and turned on.");
      } else {
        toast.success(res.data.steps === 0 ? "Saved as an empty draft. Add a step before turning it on." : "Saved as a draft.");
      }
      router.push(cancelHref);
      router.refresh();
    });
  }

  const eventMetricsOk = kind === "event";
  const empty = steps.length === 0;
  return (
    <form
      className="space-y-5"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      {options.aiOn && <DescribeBox institutionSlug={institutionSlug} current={{ name, form: { trigger, steps } }} onDraft={load} />}
      {!id && options.templates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Or start from a ready-made workflow:</p>
          <div className="flex flex-wrap gap-2">
            {options.templates.map((t) => (
              <Button key={t.key} type="button" variant="outline" size="sm" onClick={() => load(t.name, t.form)}>
                {t.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="max-w-md">
        <Label htmlFor="wf-name">Name</Label>
        <Input id="wf-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} {...invalid(errors, "name")} />
        <FieldError errors={errors} k="name" />
      </div>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">Starts</legend>
        <Label htmlFor="wf-trigger">Trigger</Label>
        <select id="wf-trigger" className={`${SELECT} max-w-sm`} value={kind} onChange={(e) => pickTrigger(e.target.value)}>
          <option value="manual">By hand (Run now)</option>
          <option value="schedule">On a schedule</option>
          <option value="event">When something happens</option>
        </select>
        {kind === "schedule" && <SchedulePicker cron={trigger.config.cron ?? ""} errors={errors} onChange={(cron) => setTrigger({ ...trigger, config: { kind: "schedule", cron } })} />}
        {kind === "event" && (
          <div className="max-w-sm">
            <Label htmlFor="wf-event">Event</Label>
            <select id="wf-event" className={SELECT} value={trigger.config.event} onChange={(e) => setTrigger({ ...trigger, config: { kind: "event", event: e.target.value } })}>
              {Object.keys(WORKFLOW_EVENTS).map((k) => (
                <option key={k} value={k}>
                  {EVENT_PHRASES[k as keyof typeof EVENT_PHRASES]}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      {empty && (
        <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          No steps yet. You can save this as an empty draft, but it cannot be turned on or run until it has at least one step.
        </p>
      )}
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const k = (f: string) => `steps.${i}.${f}`;
          const perSection = (SECTION_METRICS as readonly string[]).includes(s.config.metric ?? "");
          return (
            <li key={i} className="space-y-2 rounded-md border bg-card p-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Step {i + 1}: {STEP_LABEL[s.type]}
                </h3>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={i === 0} aria-label={`Move step ${i + 1} up`} onClick={() => move(i, i - 1)}>
                    Up
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`} onClick={() => move(i, i + 1)}>
                    Down
                  </Button>
                  <Button type="button" size="sm" variant="outline" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              </div>
              <FieldError errors={errors} k={`steps.${i}`} />
              <div className="max-w-md">
                <Label htmlFor={`st-label-${i}`}>Step name</Label>
                <Input id={`st-label-${i}`} value={s.label} maxLength={60} onChange={(e) => setStep(i, { label: e.target.value })} {...invalid(errors, k("label"))} />
                <FieldError errors={errors} k={k("label")} />
              </div>
              {s.type === "condition" && (
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <Label htmlFor={`st-m-${i}`}>Number to check</Label>
                    <select id={`st-m-${i}`} className={SELECT} value={s.config.metric ?? ""} onChange={(e) => setMetric(i, e.target.value)} {...invalid(errors, k("metric"))}>
                      <option value="">Choose…</option>
                      {Object.entries(WORKFLOW_METRICS)
                        .filter(([key, m]) => !m.event || eventMetricsOk || key === s.config.metric)
                        .map(([key, m]) => (
                          <option key={key} value={key}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                    <FieldError errors={errors} k={k("metric")} />
                  </div>
                  {perSection && (
                    <div className="sm:col-span-2">
                      <Label htmlFor={`st-sec-${i}`}>Section</Label>
                      <select id={`st-sec-${i}`} className={SELECT} value={s.config.section ?? ""} onChange={(e) => setCfg(i, "section", e.target.value)} {...invalid(errors, k("section"))}>
                        <option value="">Choose…</option>
                        {options.sections.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.label}
                          </option>
                        ))}
                      </select>
                      <FieldError errors={errors} k={k("section")} />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <Label htmlFor={`st-o-${i}`}>Continue when the number</Label>
                    <select id={`st-o-${i}`} className={SELECT} value={s.config.op ?? ""} onChange={(e) => setCfg(i, "op", e.target.value)} {...invalid(errors, k("op"))}>
                      {CONDITION_OPS.map((o) => (
                        <option key={o} value={o}>
                          {OP_WORDS[o]}
                        </option>
                      ))}
                    </select>
                    <FieldError errors={errors} k={k("op")} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor={`st-v-${i}`}>Value</Label>
                    <Input id={`st-v-${i}`} inputMode="numeric" value={s.config.value ?? ""} maxLength={6} onChange={(e) => setCfg(i, "value", e.target.value)} {...invalid(errors, k("value"))} />
                    <FieldError errors={errors} k={k("value")} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-4">The run shows the number it measured. If the test fails, the workflow ends here. To just see the number, use “is at least 0”.</p>
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
                      <fieldset aria-describedby={errors[k("roles")]?.length ? `err-${k("roles")}` : undefined}>
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
                        <FieldError errors={errors} k={k("roles")} />
                      </fieldset>
                      <div>
                        <Label htmlFor={`st-msg-${i}`}>Message (use {"{count}"} once for the number found)</Label>
                        <Input id={`st-msg-${i}`} value={s.config.message ?? ""} maxLength={200} onChange={(e) => setCfg(i, "message", e.target.value)} {...invalid(errors, k("message"))} />
                        <FieldError errors={errors} k={k("message")} />
                      </div>
                    </>
                  )}
                </div>
              )}
              {s.type === "agent" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`st-ag-${i}`}>Agent</Label>
                    <select id={`st-ag-${i}`} className={SELECT} value={s.config.agent ?? ""} onChange={(e) => setCfg(i, "agent", e.target.value)} {...invalid(errors, k("agent"))}>
                      <option value="">Choose…</option>
                      {options.agents.map((a) => (
                        <option key={a.slug} value={a.slug}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <FieldError errors={errors} k={k("agent")} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor={`st-t-${i}`}>Task for the agent</Label>
                    <Input id={`st-t-${i}`} value={s.config.task ?? ""} maxLength={500} onChange={(e) => setCfg(i, "task", e.target.value)} {...invalid(errors, k("task"))} />
                    <FieldError errors={errors} k={k("task")} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">The agent only drafts; a person starts its run and saves any result.</p>
                </div>
              )}
              {s.type === "approval" && (
                <div className="max-w-md">
                  <Label htmlFor={`st-p-${i}`}>Question to the approver</Label>
                  <Input id={`st-p-${i}`} value={s.config.prompt ?? ""} maxLength={120} onChange={(e) => setCfg(i, "prompt", e.target.value)} {...invalid(errors, k("prompt"))} />
                  <FieldError errors={errors} k={k("prompt")} />
                  <p className="mt-1 text-xs text-muted-foreground">If rejected, the workflow ends here.</p>
                </div>
              )}
              {s.type === "report" && (
                <div className="max-w-md">
                  <Label htmlFor={`st-r-${i}`}>Scheduled report</Label>
                  <select id={`st-r-${i}`} className={SELECT} value={s.config.scheduledReportId} onChange={(e) => setCfg(i, "scheduledReportId", e.target.value)} {...invalid(errors, k("scheduledReportId"))}>
                    {options.reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <FieldError errors={errors} k={k("scheduledReportId")} />
                </div>
              )}
            </li>
          );
        })}
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
      <FieldError errors={errors} k="steps" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={empty ? "default" : "outline"} disabled={pending}>
          {pending ? "Saving…" : empty ? "Save empty draft" : "Save as draft"}
        </Button>
        {!empty && (
          <Button type="button" disabled={pending} onClick={() => save(true)}>
            {pending ? "Saving…" : "Save and turn on"}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
