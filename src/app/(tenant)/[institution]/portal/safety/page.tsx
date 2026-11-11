import { CircleCheck } from "lucide-react";
import { ListPager } from "@/components/list-pager";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { SafetyAlertCard } from "@/modules/safety/components/SafetyAlertCard";
import { AcknowledgeButton } from "@/modules/safety/components/SafetyForms";
import { listSafetyAlerts } from "@/modules/safety/queries";

// Student/guardian view. RLS decides which alerts the caller sees (whole-school
// alerts plus alerts for their own / their children's sections). Every active
// alert is listed regardless of the selected child: an emergency for a sibling's
// section must never hide behind the child switcher.
export default async function PortalSafetyPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string; page?: string }>;
}) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const { student, page: pageParam } = allParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "safety");
  requirePermission(ctx, "safety.alert.read");

  const selection = await resolvePortalSelection(ctx, student, `/${slug}/portal/safety`, allParams);
  const list = await listSafetyAlerts(ctx, Math.max(1, Number(pageParam) || 1));

  return (
    <>
      <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />
      <div className="space-y-6">
        <section aria-labelledby="portal-safety-active" className="space-y-3">
          <h2 id="portal-safety-active" className="text-base font-semibold">
            Active alerts
          </h2>
          {list.active.length === 0 ? (
            <EmptyState title="No active safety alerts." description="If the school sends one, it appears here and in your notifications." />
          ) : (
            list.active.map((alert) => (
              <SafetyAlertCard key={alert.id} alert={alert}>
                {alert.acknowledgedByMe ? (
                  <Badge variant="success">
                    <CircleCheck className="size-3.5" aria-hidden />
                    You acknowledged this alert
                  </Badge>
                ) : (
                  <AcknowledgeButton institutionSlug={slug} alertId={alert.id} />
                )}
              </SafetyAlertCard>
            ))
          )}
        </section>

        <section aria-labelledby="portal-safety-history" className="space-y-3">
          <h2 id="portal-safety-history" className="text-base font-semibold">
            Past alerts
          </h2>
          {list.history.length === 0 ? (
            <EmptyState title="No past alerts." />
          ) : (
            <ol className="space-y-2">
              {list.history.map((alert) => (
                <li key={alert.id}>
                  <SafetyAlertCard alert={alert} />
                </li>
              ))}
            </ol>
          )}
          <ListPager
            basePath={`/${slug}/portal/safety`}
            params={{ student: selection.studentId }}
            page={list.page}
            total={list.historyTotal}
            pageSize={list.pageSize}
            noun="past alerts"
          />
        </section>
      </div>
    </>
  );
}
