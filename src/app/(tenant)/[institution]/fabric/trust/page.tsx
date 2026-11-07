import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Widget } from "@/components/widgets/widget";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { getTenantContext } from "@/lib/auth/context";
import { ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { usageSummary } from "@/modules/ai/queries";
import { listAuditEvents } from "@/modules/core/audit.queries";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { PlannedWidget, SimpleTable, loadSection, renderSection } from "@/modules/fabric/components/fabric-sections";

const POLICY_COPY: Record<string, string> = {
  local_only: "AI requests run only on models hosted by this school's own setup. Nothing is sent to a cloud provider.",
  cloud_allowed: "AI requests may use a cloud model provider. Output is a suggestion for a person to review and save.",
  local_with_cloud_fallback: "AI requests try the local model first and may fall back to a cloud provider if it is unavailable.",
};
const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const PAGE_SIZE = 25;

type Raw = string | string[] | undefined;
type SP = { action?: Raw; entity?: Raw; page?: Raw; role?: Raw };
// Repeated query params arrive as string[]; take the first string only.
const one = (v: Raw): string | undefined => (typeof v === "string" ? v : undefined);

function qs(sp: SP, patch: Partial<SP>): string {
  const merged = { ...sp, ...patch };
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) { const s1 = one(v); if (s1) u.set(k, s1); }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export default async function TrustPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<SP>;
}) {
  const { institution: institutionSlug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");
  const base = `/${institutionSlug}/fabric/trust`;

  const page = Math.min(10_000, Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const action = one(sp.action)?.trim().slice(0, 100) || undefined;
  const entity = one(sp.entity)?.trim().slice(0, 100) || undefined;
  const role = ROLES.find((r) => r === one(sp.role));

  const canAudit = hasPermission(ctx, "audit.read");
  const [audit, usage] = await Promise.all([
    loadSection(ctx, "audit", "audit.read", null, () => listAuditEvents(ctx, { action, entityType: entity, page, pageSize: PAGE_SIZE })),
    loadSection(ctx, "ai usage", "ai.usage.read", null, () => usageSummary(ctx)),
  ]);

  const policy = ctx.institution.ai_policy;
  const showPolicy = canAudit || hasPermission(ctx, "ai.usage.read");
  const nothing = !showPolicy && !canAudit;

  return (
    <FabricPage title="Trust" description="Who did what, how AI is governed, and who can do what." ws="trust">
      <div className="space-y-4">
        {nothing && <p className="text-sm text-muted-foreground">Trust views are available to school administrators.</p>}

        <div className="grid gap-4 lg:grid-cols-2">
          {showPolicy && (
            <Widget title="AI policy" description="Set per school by an administrator; every change is audited.">
              <p className="text-sm">
                <span className="font-medium">{humanize(policy)}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{POLICY_COPY[policy] ?? "Custom policy."}</p>
              <p className="mt-2 text-xs text-muted-foreground">AI never saves marks, payments, access or welfare decisions on its own.</p>
            </Widget>
          )}

          {renderSection(
            "AI usage, last 30 days",
            usage,
            (u) => (
              <div className="space-y-3">
                <div className="grid grid-cols-2 divide-x-2 divide-border rounded-lg bg-secondary/60 [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:bg-transparent">
                  <KpiTile label="Requests" value={u.totalRequests.toLocaleString("en-IN")} />
                  <KpiTile label="Tokens" value={u.totalTokens.toLocaleString("en-IN")} />
                </div>
                <SimpleTable
                  caption="AI requests by provider"
                  head={["Provider", "Requests", "Succeeded"]}
                  numericCols={[1, 2]}
                  rows={(["local", "cloud"] as const).map((p) => ({ key: p, cells: [humanize(p), u.byProvider[p].requests, u.byProvider[p].okRequests] }))}
                />
                <p className="text-xs text-muted-foreground">Cost estimate ${u.totalCostEstimateUsd.toFixed(4)} is an estimate, not a bill.</p>
              </div>
            ),
          )}
        </div>

        {renderSection(
          "Audit log",
          audit,
          ({ rows, total }) => {
            const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            return (
              <div className="space-y-3">
                <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <Label htmlFor="audit-action" className="mb-1 block">Action</Label>
                    <Input id="audit-action" name="action" defaultValue={action ?? ""} placeholder="e.g. attendance.submitted" maxLength={100} />
                  </div>
                  <div>
                    <Label htmlFor="audit-entity" className="mb-1 block">Entity type</Label>
                    <Input id="audit-entity" name="entity" defaultValue={entity ?? ""} placeholder="e.g. invoices" maxLength={100} />
                  </div>
                  <Button type="submit" variant="outline">Filter</Button>
                </form>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No audit events match.</p>
                ) : (
                  <SimpleTable
                    caption="Audit events, newest first"
                    head={["When", "Who", "Action", "Entity"]}
                    rows={rows.map((r) => ({
                      key: r.id,
                      cells: [new Date(r.at).toISOString().replace("T", " ").slice(0, 16) + " UTC", `${r.actor || "System"}${r.actor_role ? ` (${humanize(r.actor_role)})` : ""}`, r.event, r.entity],
                    }))}
                  />
                )}
                <nav aria-label="Audit log pages" className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Page {Math.min(page, pages)} of {pages} · {total.toLocaleString("en-IN")} events
                  </span>
                  <span className="flex gap-3">
                    {page > 1 && <Link className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-9" href={`${base}${qs(sp, { page: String(page - 1) })}`}>Previous</Link>}
                    {page < pages && <Link className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-9" href={`${base}${qs(sp, { page: String(page + 1) })}`}>Next</Link>}
                  </span>
                </nav>
              </div>
            );
          },
          { description: "Append-only record of sensitive actions in this school" },
        )}

        {canAudit && (
          <Widget title="Permission matrix" description="Read-only view of what each role is allowed to do. Changing it needs a code change.">
            <nav aria-label="Choose role" className="mb-3 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <Link
                  key={r}
                  href={`${base}${qs({ ...sp, page: undefined }, { role: r })}`}
                  aria-current={r === role ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-[3px] border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 ${r === role ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {humanize(r)}
                </Link>
              ))}
            </nav>
            {role ? (
              <PermissionList role={role} />
            ) : (
              <SimpleTable
                caption="Number of permissions per role"
                head={["Role", "Permissions"]}
                numericCols={[1]}
                rows={ROLES.map((r) => ({ key: r, cells: [humanize(r), ROLE_PERMISSIONS[r].length] }))}
              />
            )}
          </Widget>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <PlannedWidget title="Model registry" note="Approved models are not recorded here yet." />
          <PlannedWidget title="Consent records" note="Consent capture is not available yet." />
        </div>
      </div>
    </FabricPage>
  );
}

function PermissionList({ role }: { role: Role }) {
  const groups = new Map<string, string[]>();
  for (const p of ROLE_PERMISSIONS[role]) {
    const g = p.split(".")[0] ?? p;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {humanize(role)} holds {ROLE_PERMISSIONS[role].length} permissions. Some are limited to the user&apos;s own classes or children by row-level rules.
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {[...groups.entries()].map(([g, perms]) => (
          <div key={g}>
            <dt className="text-sm font-medium">{humanize(g)}</dt>
            <dd className="text-sm text-muted-foreground">{perms.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
