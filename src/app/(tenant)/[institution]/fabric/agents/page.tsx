import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { agentDefinitions, agentRunDetail, agentRuns } from "@/modules/agents/queries";
import { AgentCard } from "@/modules/agents/components/agent-controls";
import { RunDetailPanel, RunsTable } from "@/modules/agents/components/agent-view";

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
  const header = (
    <PageHeader
      title="Agents"
      description="AI helpers that propose work for you. They never act without a person's approval for anything risky."
    />
  );

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
      <p className="flex items-start gap-2 rounded-xl border bg-muted/50 p-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Agents only propose actions. Risky ones wait here until an authorised person approves them.
      </p>

      {awaiting > 0 && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm font-medium">
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
            <h2 id="agents-h" className="text-lg font-semibold">Your agents</h2>
            {defsRes.status === "rejected" ? (
              <ErrorState title="Could not load agents" description="Reload the page to try again." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {defs.map((d) => (
                  <AgentCard
                    key={d.slug}
                    institutionSlug={slug}
                    runsBase={base}
                    canRun={canRun}
                    canToggle={hasPermission(ctx, "agent.approve")}
                    agent={{
                      slug: d.slug,
                      name: d.name,
                      role: d.role_description,
                      tools: d.tools,
                      maxRisk: d.max_risk_class,
                      enabled: d.is_enabled,
                      runs30d: d.runs_30d,
                      errorRatePct: d.error_rate_pct,
                      costPaise30d: d.cost_paise_30d,
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="runs-h" className="space-y-3">
            <h2 id="runs-h" className="text-lg font-semibold">Recent runs</h2>
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
