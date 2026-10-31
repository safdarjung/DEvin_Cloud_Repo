import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { RecheckQueue } from "@/modules/exams/components/RecheckQueue";
import { listRecheckQueue } from "@/modules/exams/queries";

// T-020 — the recheck queue (06 §W8), exam.recheck.review only.
export default async function RecheckQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { status } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.recheck.review");

  const rows = await listRecheckQueue(ctx, status);

  return (
    <div className="space-y-4">
      <PageHeader title="Recheck requests" description="Review requests from guardians and students." />
      <RecheckQueue institutionSlug={institutionSlug} rows={rows} />
    </div>
  );
}
