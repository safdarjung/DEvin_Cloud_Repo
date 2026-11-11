"use client";

// Agent card + run-decision controls. Hiding them is UX only: the actions
// re-check agent.run / agent.approve / canDecideRun server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Check, Pencil, Play, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveAgentRun, archiveCustomAgent, rejectAgentRun, runAgent, setAgentEnabled } from "@/modules/agents/actions";
import { CustomAgentDialog, type CustomAgentValues } from "./custom-agent-form";
import { APPROVAL_TAG, RISK_LABEL, formatPaise, runHref } from "./helpers";

export interface AgentCardAction {
  description: string;
  risk: keyof typeof RISK_LABEL;
}

export interface AgentCardData {
  slug: string;
  name: string;
  role: string;
  summary: string;
  toolDescriptions: string[];
  cardActions: AgentCardAction[];
  examples: string[];
  maxRisk: keyof typeof RISK_LABEL;
  enabled: boolean;
  runs30d: number;
  errorRatePct: number;
  costPaise30d: number;
  /** Set for a school's own agent (0134): edit/delete use it; runs go through the same run dialog. */
  custom?: CustomAgentValues & { id: string };
}

export function AgentCard({
  institutionSlug,
  runsBase,
  agent,
  canRun,
  canToggle,
}: {
  institutionSlug: string;
  runsBase: string;
  agent: AgentCardData;
  canRun: boolean;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const slug = agent.slug;

  function submitTask(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      setError(null);
      setFieldErrors(undefined);
      const res = await runAgent(institutionSlug, { slug, task });
      if (res.ok) {
        // A failed run is still ok:true (the run row exists); say so instead of "finished".
        if (res.data.status === "failed") toast.error(res.data.summary || "The agent could not finish this run.");
        else toast.success(res.data.status === "awaiting_approval" ? "Run is waiting for human approval" : "Agent run finished");
        setOpen(false);
        setTask("");
        router.push(runHref(runsBase, res.data.runId));
        router.refresh();
      } else {
        setFieldErrors(res.error.fieldErrors);
        setError(res.error.message);
        toast.error(res.error.message);
      }
    });
  }

  function toggle() {
    start(async () => {
      const res = await setAgentEnabled(institutionSlug, { slug, enabled: !agent.enabled });
      if (res.ok) {
        toast.success(`${agent.name} ${agent.enabled ? "disabled" : "enabled"}`);
        router.refresh();
      } else toast.error(res.error.message);
    });
  }

  function archive() {
    const custom = agent.custom;
    if (!custom || !window.confirm(`Delete "${agent.name}"? Its past runs stay in the run history.`)) return;
    start(async () => {
      const res = await archiveCustomAgent(institutionSlug, { id: custom.id });
      if (res.ok) {
        toast.success(`${agent.name} deleted`);
        router.refresh();
      } else toast.error(res.error.message);
    });
  }

  function runExample(example: string) {
    setTask(example);
    setOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" aria-hidden /> {agent.name}
          </CardTitle>
          <div className="flex shrink-0 gap-1">
            {agent.custom && <Badge variant="info">Custom</Badge>}
            <Badge variant={agent.enabled ? "success" : "secondary"}>{agent.enabled ? "Enabled" : "Disabled"}</Badge>
          </div>
        </div>
        <p className="text-sm font-medium">{agent.summary}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Runs (30d)</dt><dd className="font-medium">{agent.runs30d}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Errors</dt><dd className="font-medium">{agent.errorRatePct}%</dd></div>
          <div><dt className="text-xs text-muted-foreground">Cost (30d)</dt><dd className="font-medium">{formatPaise(agent.costPaise30d)}</dd></div>
        </dl>

        <div>
          <p className="text-xs font-medium">Looks at</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {agent.toolDescriptions.length === 0 && <li>Nothing yet</li>}
            {agent.toolDescriptions.map((desc) => (
              <li key={desc}>{desc}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-medium">Can suggest</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {agent.cardActions.length === 0 && <li>No changes — it reads records and recommends; people decide.</li>}
            {agent.cardActions.map((a) => (
              <li key={a.description}>
                {a.description} <span className="text-muted-foreground/80">({APPROVAL_TAG[a.risk]})</span>
              </li>
            ))}
          </ul>
        </div>

        {agent.examples.length > 0 && (
          <div>
            <p className="text-xs font-medium">Try asking</p>
            <ul className="m-0 flex list-none flex-wrap gap-2 pl-0">
              {agent.examples.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    disabled={!agent.enabled || pending}
                    onClick={() => runExample(example)}
                    className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canRun && (
            <Button type="button" disabled={!agent.enabled || pending} onClick={() => setOpen(true)}>
              <Play aria-hidden /> Run task
            </Button>
          )}
          {canToggle && (
            <Button type="button" variant="outline" disabled={pending} onClick={toggle} aria-label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`}>
              {agent.enabled ? "Disable" : "Enable"}
            </Button>
          )}
          {canToggle && agent.custom && (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(true)} aria-label={`Edit ${agent.name}`}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={archive} aria-label={`Delete ${agent.name}`}>
                <Trash2 aria-hidden /> Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
      {agent.custom && (
        <CustomAgentDialog institutionSlug={institutionSlug} initial={agent.custom} open={editing} onOpenChange={setEditing} />
      )}

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run {agent.name}</DialogTitle>
            <DialogDescription>
              Describe the task. The agent only proposes changes; anything risky waits for a person to approve it.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitTask}>
            <div>
              <Label htmlFor={`task-${agent.slug}`}>Task</Label>
              <Textarea
                id={`task-${agent.slug}`}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={4}
                maxLength={500}
                required
                aria-invalid={!!fieldErrors?.task}
                aria-describedby={fieldErrors?.task ? `task-${agent.slug}-err` : undefined}
              />
              {fieldErrors?.task && (
                <p id={`task-${agent.slug}-err`} role="alert" className="mt-1 text-sm text-destructive">{fieldErrors.task.join(" ")}</p>
              )}
            </div>
            {error && !fieldErrors?.task && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Running…" : "Run"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function RunDecision({ institutionSlug, runId }: { institutionSlug: string; runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(kind: "approve" | "reject") {
    start(async () => {
      setError(null);
      const fn = kind === "approve" ? approveAgentRun : rejectAgentRun;
      const res = await fn(institutionSlug, { runId, ...(note.trim() ? { note: note.trim() } : {}) });
      if (res.ok) {
        toast.success(kind === "approve" ? "Run approved" : "Run rejected");
        router.refresh();
      } else {
        setError(res.error.fieldErrors?.note?.join(" ") ?? res.error.message);
        toast.error(res.error.message);
      }
    });
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div>
        <Label htmlFor="decision-note">Note (optional)</Label>
        <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => decide("approve")}>
          <Check aria-hidden /> Approve and execute
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => decide("reject")}>
          <X aria-hidden /> Reject
        </Button>
      </div>
    </div>
  );
}
