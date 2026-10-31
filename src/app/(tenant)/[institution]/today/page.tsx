import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";

// Placeholder: replaced by the teacher "Today" view in Stage D.
export default async function TodayPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "attendance.mark");

  return (
    <>
      <PageHeader title="Today" />
      <EmptyState title="Your day at a glance is loading soon" />
    </>
  );
}
