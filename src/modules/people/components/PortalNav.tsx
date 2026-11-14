"use client";

import { usePathname } from "next/navigation";
import { GUARDIAN_NAV, STUDENT_NAV } from "@/lib/nav";
import { PageHeader } from "@/components/page-header";
import { ChildSwitcher } from "./ChildSwitcher";
import type { PortalSelection } from "@/modules/people/portal";

/** Section hrefs under /portal; kept so page callers still compile. */
export type PortalTabHref =
  | ""
  | "/attendance"
  | "/fees"
  | "/results"
  | "/assignments"
  | "/subjects"
  | "/study"
  | "/practice"
  | "/meetings"
  | "/updates"
  | "/messages"
  | "/assistant"
  | "/leave"
  | "/surveys"
  | "/notifications";

/**
 * Portal page chrome: title + child switcher. Section navigation lives in the
 * app sidebar (src/lib/nav.ts GUARDIAN_NAV / STUDENT_NAV), which carries
 * `?student=` on every portal link so the selected child survives navigation.
 * `activeHref` and `canStudy` are no longer used here; they stay in the props
 * so the ~20 portal pages need no edits.
 */
export function PortalNav({
  role,
  selection,
  description,
}: {
  /** Shown under the title (the page's own one-line summary). */
  description?: string;
  institutionSlug?: string;
  role: "guardian" | "student";
  selection: PortalSelection;
  activeHref?: PortalTabHref;
  canStudy?: boolean;
}) {
  const pathname = usePathname() ?? "";
  // Section pages are titled by their own nav label; the portal root keeps the role caption.
  const [, ...rest] = pathname.split("/").filter(Boolean);
  const own = rest.length > 1 ? (role === "guardian" ? GUARDIAN_NAV : STUDENT_NAV).find((i) => i.href === `/${rest.join("/")}`)?.label : undefined;
  const title = own ?? (role === "guardian" ? "My children" : "My school");
  return (
    <div className="mb-6">
      <PageHeader
        title={title}
        crumb={own}
        description={description}
        compact
        actions={selection.children ? <ChildSwitcher students={selection.children} selectedId={selection.studentId} /> : undefined}
      />
    </div>
  );
}
