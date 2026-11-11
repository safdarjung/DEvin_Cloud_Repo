import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { AGENT_SLUGS } from "@/modules/agents/catalog";
import type { Workflow, WorkflowRun } from "@/modules/fabric/types";
import { reportList } from "@/modules/reports/queries";
import { DecideRunForm, WorkflowRowControls } from "@/modules/workflows/components/workflow-controls";
import { WorkflowEditor, type FormOptions } from "@/modules/workflows/components/workflow-form";
import { formFromGraph, type WorkflowForm } from "@/modules/workflows/form-graph";
import { workflowList, workflowRuns } from "@/modules/workflows/queries";

export const metadata: Metadata = { title: "Workflows" };

const SECTIONS = [
  { id: "workflows", label: "Workflows" },
  { id: "runs", label: "Runs" },
];
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const STATUS_VARIANT: Record<string, "success" | "outline" | "destructive" | "secondary"> = { active: "success", draft: "outline", paused: "secondary", disabled: "outline", done: "success", failed: "destructive", running: "secondary", awaiting_approval: "secondary" };
const EMPTY_FORM: WorkflowForm = { trigger: { label: "Run by hand", config: { kind: "manual" } }, steps: [] };

// Workflows: read needs `workflow.read` (the page floor); every control needs `workflow.manage`.
// The engine is real. Agent steps only queue the existing agents module (drafts, no direct writes); no model call lives here.
export default async function WorkflowsPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ section?: string; edit?: string }> }) {
  const { institution: slug } = await params;
  const { section, edit } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "workflows");
  if (!hasPermission(ctx, "workflow.read")) throw new AppError("forbidden", "You do not have access to workflows.");
  const canManage = hasPermission(ctx, "workflow.manage");
  const active = section === "runs" ? "runs" : "workflows";
  return (
    <div className="space-y-4">
      <PageHeader title="Workflows" description="Automations that check numbers, notify people, ask agents and wait for approval." compact />
      <SectionSwitcher basePath={`/${slug}/fabric/workflows`} sections={SECTIONS} activeId={active} />
      {active === "runs" ? <RunsTab ctx={ctx} slug={slug} canManage={canManage} /> : <WorkflowsTab ctx={ctx} slug={slug} canManage={canManage} edit={edit} />}
    </div>
  );
}

async function formOptions(ctx: TenantContext): Promise<FormOptions> {
  const reports =
    isModuleEnabled(ctx, "scheduled_reports") && hasPermission(ctx, "report.schedule")
      ? await reportList(ctx).then((r) => r.map((x) => ({ id: x.id, name: x.name }))).catch(() => [])
      : [];
  return { agents: isModuleEnabled(ctx, "agents") ? [...AGENT_SLUGS] : [], reports, feeReminders: isModuleEnabled(ctx, "finance_plus") };
}

async function WorkflowsTab({ ctx, slug, canManage, edit }: { ctx: TenantContext; slug: string; canManage: boolean; edit?: string }) {
  const rows = await workflowList(ctx, {}).catch((e) => {
    console.error("workflows list failed:", e instanceof Error ? e.message : e);
    return null;
  });
  const base = `/${slug}/fabric/workflows`;
  if (canManage && edit && rows) {
    const wf = edit === "new" ? undefined : rows.find((w) => w.id === edit);
    const form = wf ? formFromGraph(wf.nodes as never, wf.edges as never) : EMPTY_FORM;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{wf ? `Edit ${wf.name}` : "New workflow"}</CardTitle>
        </CardHeader>
        <CardContent>
          {wf && wf.status === "active" ? (
            <p role="alert" className="text-sm">
              Pause this workflow before editing it. <Link className="underline" href={base}>Back</Link>
            </p>
          ) : form === null ? (
            <p role="alert" className="text-sm">
              This workflow uses a graph shape the form cannot edit. <Link className="underline" href={base}>Back</Link>
            </p>
          ) : (
            <WorkflowEditor institutionSlug={slug} id={wf?.id} initialName={wf?.name ?? ""} initial={form} options={await formOptions(ctx)} cancelHref={base} />
          )}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {canManage && (
        <Button asChild>
          <Link href={`${base}?edit=new`}>New workflow</Link>
        </Button>
      )}
      {rows === null ? (
        <ErrorState title="Could not load workflows" description="Refresh to try again." />
      ) : rows.length === 0 ? (
        <EmptyState title="No workflows yet" description={canManage ? "Create the first one." : "Nothing has been set up."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Starts</TableHead>
                  <TableHead className="hidden md:table-cell">Steps</TableHead>
                  {canManage && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[w.status] ?? "outline"}>{humanize(w.status)}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{triggerText(w)}</TableCell>
                    <TableCell className="hidden md:table-cell">{w.nodes.filter((n) => n.type !== "trigger" && n.type !== "end").map((n) => n.label).join(" → ") || "—"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <WorkflowRowControls institutionSlug={slug} id={w.id} name={w.name} status={w.status} editHref={`${base}?edit=${w.id}`} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function triggerText(w: Workflow): string {
  const t = w.trigger;
  return t.type === "manual" ? "By hand" : t.type === "schedule" ? `Schedule ${t.config}` : humanize(String(t.config));
}

async function RunsTab({ ctx, slug, canManage }: { ctx: TenantContext; slug: string; canManage: boolean }) {
  const [wfR, runsR] = await Promise.allSettled([workflowList(ctx, {}), workflowRuns(ctx, { limit: 50 })]);
  for (const r of [wfR, runsR]) if (r.status === "rejected") console.error("workflow runs fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  if (runsR.status === "rejected") return <ErrorState title="Could not load runs" description="Refresh to try again." />;
  const workflows = new Map((wfR.status === "fulfilled" ? wfR.value : []).map((w) => [w.id, w]));
  if (runsR.value.length === 0) return <EmptyState title="No runs yet" description="Runs appear here once a workflow starts." />;
  return (
    <ul className="space-y-3">
      {runsR.value.map((r) => (
        <RunCard key={r.id} run={r} wf={workflows.get(r.workflow_id)} slug={slug} canDecide={canManage} />
      ))}
    </ul>
  );
}

function RunCard({ run, wf, slug, canDecide }: { run: WorkflowRun; wf?: Workflow; slug: string; canDecide: boolean }) {
  const node = (id: string) => wf?.nodes.find((n) => n.id === id);
  const waiting = run.status === "awaiting_approval";
  const prompt = run.steps.map((s) => node(s.node_id)).find((n) => n?.type === "approval" && run.steps.find((s) => s.node_id === n.id)?.status !== "done")?.config?.prompt;
  return (
    <li>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {wf?.name ?? "Deleted workflow"}
            <Badge variant={STATUS_VARIANT[run.status] ?? "outline"}>{humanize(run.status)}</Badge>
            <span className="text-xs font-normal text-muted-foreground">{dateTimeFmt.format(new Date(run.started_at))}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {run.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {run.steps.map((s, i) => (
                <li key={`${s.node_id}-${i}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{humanize(s.status)}</Badge>
                  <span className="font-medium">{node(s.node_id)?.label ?? s.node_id}</span>
                  {s.note && <span className="text-muted-foreground">{s.note}</span>}
                </li>
              ))}
            </ol>
          )}
          {waiting && canDecide && <DecideRunForm institutionSlug={slug} runId={run.id} prompt={prompt ?? "Approve this run?"} />}
          {waiting && !canDecide && <p className="text-sm text-muted-foreground">Waiting for an approver.</p>}
        </CardContent>
      </Card>
    </li>
  );
}
