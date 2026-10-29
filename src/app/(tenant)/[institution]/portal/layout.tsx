import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";

/**
 * T-034 — guardian/student portal shell (04 §4). Deliberately thin: Next.js
 * layouts never receive `searchParams` and don't rerender on query-param-only
 * navigation (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
 * §"Query params"), so the child switcher/tabs (which depend on `?student=`)
 * live in `PortalNav`, rendered by each page below, not here. This layout
 * only resolves the shared tenant context (cache()-deduped with every page's
 * own `getTenantContext` call) and the portal-wide permission floor.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");

  return <div className="space-y-4">{children}</div>;
}
