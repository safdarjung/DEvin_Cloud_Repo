import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require";
import { RecentChanges } from "@/modules/core/components/control-centre/RecentChanges";
import { ControlCentre } from "@/modules/core/components/control-centre/ControlCentre";
import { listAuditEvents } from "@/modules/core/audit.queries";
import { buildCcModel, ccSettings } from "@/modules/core/control-centre/model";
import { AI_ROLES } from "@/modules/core/schemas";
import type { AuditEventRow } from "@/modules/fabric/types";

export const metadata: Metadata = { title: "Control centre" };

const EVENTS = ["core.module.set", "core.feature.set", "core.ai_role.set"] as const;

// Audit is a bonus: a role without audit.read, or a failed read, just hides the list.
async function recentChanges(ctx: Awaited<ReturnType<typeof getTenantContext>>): Promise<AuditEventRow[]> {
  if (!hasPermission(ctx.membership.role, "audit.read")) return [];
  try {
    const parts = await Promise.all(EVENTS.map((action) => listAuditEvents(ctx, { action, pageSize: 8 })));
    return parts.flatMap((p) => p.rows).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  } catch {
    return [];
  }
}

export default async function ControlCentrePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  // No role can view without managing today, so the page is not read-only for anyone who gets in.
  requirePermission(ctx, "institution.settings.manage");

  const [recent] = await Promise.all([recentChanges(ctx)]);

  return (
    <div className="space-y-6">
      <PageHeader title="Control centre" description="Switch features on and off for the school and for the AI orb, in one place." />
      <ControlCentre slug={slug} model={buildCcModel(ctx)} initialSettings={ccSettings(ctx.institution.settings)} roles={AI_ROLES} readOnly={false} />
      <RecentChanges rows={recent} />
    </div>
  );
}
