import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Workflow } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState, ErrorState } from "@/components/states";
import { BarList } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { ACTION_RISK, AGENT_CATALOG, scopedSpec, type AgentSlug } from "@/modules/agents/catalog";
import { agentDefinitions, agentRunDetail, agentRuns } from "@/modules/agents/queries";
import { AgentCard } from "@/modules/agents/components/agent-controls";
import { CreateAgentButton } from "@/modules/agents/components/custom-agent-form";
import { RunDetailPanel, RunsTable } from "@/modules/agents/components/agent-view";

export const metadata: Metadata = { title: "AI workforce" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "agent.run");

  const base = `/${slug}/fabric/agents`;
  // Creating/editing agents is the same gate as enabling them (agent.approve, owner/principal).
  const canManage = hasPermission(ctx, "agent.approve");
  const header = (
    <PageHeader
      title="Agents"
      description="AI helpers that propose work for you. They never act without a person's approval for anything risky."
      actions={canManage && isModuleEnabled(ctx, "agents") ? <CreateAgentButton institutionSlug={slug} /> : undefined}
    />
  );
  const showWorkflows = isModuleEnabled(ctx, "workflows") && hasPermission(ctx, "workflow.read");

  if (!isModuleEnabled(ctx, "agents")) {
    return (
      <div data-fabric-ws="agents">
        {header}
        <EmptyState
          title="Agents are turned off"
          description="Enable the Agents module in Settings, Modules to let AI helpers draft work for approval."
          action={
            hasPermission(ctx, "institution.settings.manage") ? (
              <Button asChild variant="outline">
                <Link href={`/${slug}/settings/modules`}>Open module settings</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const runId = sp.run && UUID_RE.test(sp.run) ? sp.run : undefined;
  const [defsRes, runsRes, detailRes] = await Promise.allSettled([
    agentDefinitions(ctx),
    agentRuns(ctx, { limit: 50 }),
    runId ? agentRunDetail(ctx, { runId }) : Promise.resolve(null),
  ]);

  const defs = defsRes.status === "fulfilled" ? defsRes.value : [];
  const agentNames = Object.fromEntries(defs.map((d) => [d.id, d.name]));
  const runs = runsRes.status === "fulfilled" ? runsRes.value : [];
  const awaiting = runs.filter((r) => r.status === "awaiting_approval").length;
  const canRun = hasPermission(ctx, "agent.run");

  return (
    <div data-fabric-ws="agents" className="space-y-6">
      {header}
      <p className="flex items-start gap-2 rounded-lg border bg-secondary p-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Agents only propose actions. Risky ones wait here until an authorised person approves them.
      </p>

      {showWorkflows && (
        <section aria-labelledby="workflows-h" className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Workflow className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <h2 id="workflows-h" className="text-base font-semibold">Workflows</h2>
              <p className="text-sm text-muted-foreground">Chain agents with checks, notifications and approval steps that run on a schedule or event.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/${slug}/fabric/workflows`}>Open workflows</Link>
            </Button>
            {hasPermission(ctx, "workflow.manage") && (
              <Button asChild>
                <Link href={`/${slug}/fabric/workflows?edit=new`}>New workflow</Link>
              </Button>
            )}
          </div>
        </section>
      )}

      {awaiting > 0 && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm font-medium">
          {awaiting} run{awaiting === 1 ? " is" : "s are"} awaiting approval.
        </p>
      )}

      {runId ? (
        detailRes.status === "rejected" ? (
          <ErrorState title="Could not load this run" description="It may not exist or you may not have access. Go back to all runs." />
        ) : detailRes.value ? (
          <RunDetailPanel
            institutionSlug={slug}
            base={base}
            detail={detailRes.value}
            agentName={agentNames[detailRes.value.run.agent_id] ?? "Agent"}
            canActOnRuns={canRun}
          />
        ) : null
      ) : (
        <>
          <section aria-labelledby="agents-h" className="space-y-3">
            <h2 id="agents-h" className="text-base font-semibold">Your agents</h2>
            {defsRes.status === "rejected" ? (
              <ErrorState title="Could not load agents" description="Reload the page to try again." />
            ) : (
              <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 *:min-w-0">
                {defs.map((d) => {
                  // A custom agent shows only its base narrowed to its own subset.
                  const spec = d.custom ? scopedSpec(d.custom.base_slug, d.custom) : AGENT_CATALOG[d.slug as AgentSlug];
                  return (
                    <StaggerItem key={d.slug} className="[&>*]:h-full">
                    <AgentCard
                      institutionSlug={slug}
                      runsBase={base}
                      canRun={canRun}
                      canToggle={canManage}
                      agent={{
                        slug: d.slug,
                        name: d.name,
                        role: d.role_description,
                        summary: d.custom?.summary ?? spec.summary,
                        toolDescriptions: Object.values(spec.tools),
                        cardActions: Object.entries(spec.actions).map(([action, description]) => ({
                          description,
                          risk: ACTION_RISK[action],
                        })),
                        examples: [...(d.custom?.examples ?? spec.examples)],
                        maxRisk: d.max_risk_class,
                        enabled: d.is_enabled,
                        runs30d: d.runs_30d,
                        errorRatePct: d.error_rate_pct,
                        costPaise30d: d.cost_paise_30d,
                        custom: d.custom && {
                          id: d.id,
                          name: d.name,
                          summary: d.custom.summary,
                          instructions: d.custom.instructions,
                          examples: d.custom.examples,
                          baseSlug: d.custom.base_slug,
                          tools: d.custom.tools,
                          actions: d.custom.actions,
                        },
                      }}
                    />
                    </StaggerItem>
                  );
                })}
              </Stagger>
            )}
            {defs.some((d) => d.runs_30d > 0) && (
              <Widget title="Runs, last 30 days" description="How often each agent ran in the last 30 days.">
                <BarList
                  ariaLabel="Agent runs in the last 30 days"
                  items={[...defs].sort((a, b) => b.runs_30d - a.runs_30d).map((d) => ({ label: d.name, value: d.runs_30d }))}
                />
              </Widget>
            )}
          </section>

          <section aria-labelledby="runs-h" className="space-y-3">
            <h2 id="runs-h" className="text-base font-semibold">Recent runs</h2>
            {runsRes.status === "rejected" ? (
              <ErrorState title="Could not load runs" description="Reload the page to try again." />
            ) : (
              <RunsTable base={base} runs={runs} agentNames={agentNames} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
