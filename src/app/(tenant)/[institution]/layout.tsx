import { DemoBanner } from "@/components/tenant/demo-banner";
import { TenantHeader } from "@/components/tenant/header";
import { TenantSidebar } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);

  return (
    <div className="flex min-h-screen flex-col">
      {ctx.institution.is_demo && <DemoBanner />}
      <TenantHeader institutionName={ctx.institution.name} role={ctx.membership.role} />
      <div className="flex flex-1">
        <TenantSidebar basePath={`/${ctx.institution.slug}`} permissions={ctx.permissions} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
