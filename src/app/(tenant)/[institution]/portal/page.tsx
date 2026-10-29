import { getTenantContext } from "@/lib/auth/context";

// Placeholder landing page for roles without dashboard.view (teacher,
// student, guardian) so none of them 404 at the tenant root. T-034 builds
// the real guardian/student portal.
export default async function PortalPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  await getTenantContext(institutionSlug);

  return (
    <div>
      <h1 className="text-xl font-semibold">Portal</h1>
      <p className="text-muted-foreground">Coming in T-034.</p>
    </div>
  );
}
