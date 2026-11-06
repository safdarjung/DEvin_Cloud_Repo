// Server components for the agents workspace: runs table and run detail.
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentRun } from "@/modules/fabric/types";
import type { AgentRunDetail } from "@/modules/agents/queries";
import { RISK_LABEL, RUN_STATUS_LABEL, formatDateTime, formatPaise, runHref, runStatusVariant } from "./helpers";
import { RunDecision } from "./agent-controls";

export function RunStatusBadge({ status }: { status: AgentRun["status"] }) {
  return <Badge variant={runStatusVariant(status)}>{RUN_STATUS_LABEL[status]}</Badge>;
}

export function RunsTable({
  base,
  runs,
  agentNames,
  selectedId,
}: {
  base: string;
  runs: AgentRun[];
  agentNames: Record<string, string>;
  selectedId?: string;
}) {
  if (runs.length === 0) {
    return <EmptyState title="No runs yet" description="Run a task on an enabled agent and it will show up here." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id} data-state={r.id === selectedId ? "selected" : undefined}>
              <TableCell className="whitespace-nowrap">{agentNames[r.agent_id] ?? "Agent"}</TableCell>
              <TableCell className="max-w-48 sm:max-w-sm">
                <Link
                  href={runHref(base, r.id)}
                  className="-my-2 inline-flex min-h-11 items-center rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="line-clamp-2">{r.task}</span>
                </Link>
              </TableCell>
              <TableCell><RunStatusBadge status={r.status} /></TableCell>
              <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDateTime(r.started_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RunDetailPanel({
  institutionSlug,
  base,
  detail,
  agentName,
  canActOnRuns,
}: {
  institutionSlug: string;
  base: string;
  detail: AgentRunDetail;
  agentName: string;
  canActOnRuns: boolean;
}) {
  const { run, proposals, requestedBy, decisionNote, canDecide } = detail;
  const waiting = run.status === "awaiting_approval";
  return (
    <section aria-labelledby="run-title" className="space-y-4">
      <Link
        href={base}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> All runs
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run.status} />
          <Badge variant="outline">{RISK_LABEL[run.risk_class]}</Badge>
        </div>
        <h2 id="run-title" className="text-lg font-semibold">{agentName}: {run.task}</h2>
        <p className="text-sm text-muted-foreground">
          Requested {requestedBy ? `by ${requestedBy} ` : ""}on {formatDateTime(run.started_at)} · Cost {formatPaise(run.cost_paise)}
          {run.approver ? ` · Decided by ${run.approver}` : ""}
        </p>
      </div>

      {waiting && (
        <div role="status" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 space-y-3">
            <p className="font-medium">Awaiting human approval</p>
            <p className="text-sm">Nothing below has been executed. Approving runs the proposed actions as you; rejecting discards them.</p>
            {canDecide && canActOnRuns ? (
              <RunDecision institutionSlug={institutionSlug} runId={run.id} />
            ) : (
              <p className="text-sm text-muted-foreground">
                You cannot decide this run. {run.risk_class === "human_approved" ? "Only the owner or principal can approve it." : "Only the requester or an approver can decide it."}
              </p>
            )}
          </div>
        </div>
      )}
      {decisionNote && <p className="text-sm"><span className="font-medium">Decision note: </span>{decisionNote}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">AI-generated summary</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm"><p>{run.summary || "No summary."}</p><p className="text-xs text-muted-foreground">Suggestion only. Nothing is executed until a person approves it.</p></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposed actions</CardTitle>
          <p className="text-sm text-muted-foreground">Agents only propose. Each action is checked against your permissions when it runs.</p>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">This run proposed no actions.</p>
          ) : (
            <ul className="space-y-2">
              {proposals.map((p, i) => (
                <li key={`${p.action}-${i}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="font-medium">{p.action}</code>
                    <Badge variant={p.status === "executed" ? "success" : p.status === "failed" ? "destructive" : "secondary"}>{p.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {RISK_LABEL[p.risk_class]}{p.error_code ? ` · error: ${p.error_code}` : ""}
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(p.input, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {run.log.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Log</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {run.log.map((l, i) => (
                <li key={i} className={l.level === "error" ? "text-destructive" : undefined}>
                  <span className="text-xs text-muted-foreground">{formatDateTime(l.at)} · {l.level} · </span>
                  {l.text.length > 240 ? `${l.text.slice(0, 240)}…` : l.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
