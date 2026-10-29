import "server-only";
// T-034 — guardian/student portal shell. Shared by the portal layout and
// every portal page so the `?student=` id is re-validated server-side on
// every request (packet security rule 2), not just once in the layout.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { TenantContext } from "@/lib/auth/types";
import { getMyStudent, listMyChildren, type ChildSummary } from "./queries";

export interface PortalSelection {
  studentId: string;
  studentName: string;
  /** null for the student role — DBT-05's shared UI has no switcher for them (acceptance criterion 3). */
  children: ChildSummary[] | null;
}

function fullName(child: ChildSummary): string {
  return [child.firstName, child.lastName].filter(Boolean).join(" ");
}

/**
 * Resolves and re-validates the selected child for one request. Guardian:
 * `studentParam` must name one of `listMyChildren`'s rows, else `notFound()`;
 * no param picks the first (admission-no order) deterministically. Student:
 * `studentParam`, if present, must equal their own id.
 *
 * Fix round 2 — when `studentParam` is absent, this now `redirect()`s to
 * `currentPath` with the picked default appended as `?student=<id>`, instead
 * of silently rendering with an implicit default. Root cause of the AC1/AC2
 * e2e failures: the bare `/portal` (and any tab visited without `?student=`)
 * never put the selected id in the URL at all, so a bookmark/share of that
 * URL — or a second navigation that reads the URL for "which child" — lost
 * the selection; `ChildSwitcher`'s and `PortalNav`'s own links always
 * include `?student=`, which is why this only showed up on first landing.
 * `currentPath` must be each page's own path (no query string) — passed in
 * because a route segment has no reliable way to read its own pathname
 * server-side other than the caller already knowing it.
 *
 * Wrapped in React's `cache()` so a layout and the page it wraps (same
 * request, same args) only hit the DB once — it is still a fresh call, and
 * therefore a fresh check, on every new request/navigation.
 */
export const resolvePortalSelection = cache(async function resolvePortalSelection(
  ctx: TenantContext,
  studentParam: string | undefined,
  currentPath: string,
): Promise<PortalSelection> {
  if (ctx.membership.role === "student") {
    const me = await getMyStudent(ctx);
    if (!me || (studentParam && studentParam !== me.id)) notFound();
    if (!studentParam) redirect(`${currentPath}?student=${me.id}`);
    return { studentId: me.id, studentName: fullName(me), children: null };
  }

  const children = await listMyChildren(ctx);
  const selected = studentParam ? children.find((c) => c.id === studentParam) : children[0];
  if (!selected) notFound();
  if (!studentParam) redirect(`${currentPath}?student=${selected.id}`);
  return { studentId: selected.id, studentName: fullName(selected), children };
});
