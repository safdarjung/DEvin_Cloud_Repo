import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">Coming in T-039.</p>
    </div>
  );
}
