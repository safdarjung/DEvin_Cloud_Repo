import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { Inbox } from "@/modules/notifications/components/Inbox";
import { listMyNotifications } from "@/modules/notifications/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Notifications" };

// Notifications are addressed to the signed-in guardian/student, not to a
// particular child (lead ruling 1: portal_access doesn't gate these) — so
// this tab doesn't filter by the selected child; it's the same inbox as
// /notifications, just reachable from inside the portal shell.
export default async function PortalNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "notification.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/notifications`, allParams);
  const notifications = await listMyNotifications(ctx);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/notifications"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn>
        <Inbox institutionSlug={institutionSlug} notifications={notifications} />
      </FadeIn>
    </>
  );
}
