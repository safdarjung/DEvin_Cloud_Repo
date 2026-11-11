import type { Metadata } from "next";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { listModules } from "@/modules/core/queries";
import { catalogMatches, listStudioRequests, type StudioRequestRecord, type StudioRequestStatus } from "@/modules/fabric/studio.queries";
import { RequestDetail } from "@/modules/fabric/components/studio/request-detail";
import { RequestList } from "@/modules/fabric/components/studio/request-list";
import { RequestWizard } from "@/modules/fabric/components/studio/request-wizard";

export const metadata: Metadata = { title: "Custom Studio" };

const STATUS_FILTERS: StudioRequestStatus[] = ["submitted", "proposed", "approved", "in_progress", "delivered", "rejected"];

export default async function CustomStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ request?: string; status?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "studio.request");

  const base = `/${slug}/fabric/studio`;
  const canApprove = hasPermission(ctx, "studio.approve");

  let items: StudioRequestRecord[] = [];
  let loadFailed = false;
  try {
    items = await listStudioRequests(ctx);
  } catch {
    loadFailed = true;
  }

  const selectedId = sp.request;
  const selected = selectedId ? items.find((r) => r.id === selectedId) : undefined;
  const statusFilter = STATUS_FILTERS.find((s) => s === sp.status);
  // U2: only before proposing — once the AI has proposed, its resolution says the same thing.
  const matches =
    selected?.status === "submitted"
      ? catalogMatches(selected, listModules(ctx).flatMap((group) => group.modules))
      : [];

  return (
    <div data-fabric-ws="studio" className="space-y-4">
      <PageHeader
        title="Custom Studio"
        description="Request custom software or integrations from the CoolSkool team. AI drafts a proposal; a principal or owner approves it before any build starts."
        actions={<RequestWizard institutionSlug={slug} base={base} />}
      />
      {loadFailed ? (
        <ErrorState title="Could not load studio requests" description="Reload the page to try again." />
      ) : items.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description='Use "New request" above to describe a problem and let AI draft a first proposal.'
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={selected ? "hidden lg:block" : undefined}>
            <RequestList base={base} items={items} selectedId={selectedId} statusFilter={statusFilter} />
          </div>
          <div className={selected ? undefined : "hidden lg:block"}>
            {selected ? (
              <RequestDetail institutionSlug={slug} base={base} request={selected} canApprove={canApprove} catalogMatches={matches} />
            ) : (
              <EmptyState
                title={selectedId ? "Request not in this list" : "Pick a request"}
                description={selectedId ? "It may not exist or you may not have access." : "Select a request to see its proposal and status."}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
