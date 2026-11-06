import Link from "next/link";
import { cn } from "cn";
import { LayoutPill } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { ChildSwitcher } from "./ChildSwitcher";
import type { PortalSelection } from "@/modules/people/portal";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/attendance", label: "Attendance" },
  { href: "/fees", label: "Fees" },
  { href: "/results", label: "Results" },
  { href: "/assignments", label: "Assignments" },
  { href: "/meetings", label: "Meetings" },
  { href: "/updates", label: "Updates" },
  { href: "/leave", label: "Leave" },
  { href: "/surveys", label: "Surveys" },
  { href: "/notifications", label: "Notifications" },
] as const;

const GUARDIAN_ONLY = new Set<string>(["/meetings", "/updates", "/leave", "/surveys"]);

export type PortalTabHref = (typeof TABS)[number]["href"];

/**
 * T-034 — the portal chrome (child switcher + tabs), rendered by every
 * portal page (not the layout — see layout.tsx's comment on why). Every
 * tab link carries `?student=<selection.studentId>` so the selected child
 * survives a tab change.
 */
export function PortalNav({
  institutionSlug,
  role,
  selection,
  activeHref,
}: {
  institutionSlug: string;
  role: "guardian" | "student";
  selection: PortalSelection;
  activeHref: PortalTabHref;
}) {
  const basePath = `/${institutionSlug}/portal`;

  return (
    <div className="mb-6">
      <PageHeader
        title={role === "guardian" ? "My children" : "My school"}
        compact
        actions={selection.children ? <ChildSwitcher students={selection.children} selectedId={selection.studentId} /> : undefined}
      />
      <nav aria-label="Portal tabs" className="flex gap-1 overflow-x-auto border-b border-border pb-1">
        {TABS.filter((tab) => !GUARDIAN_ONLY.has(tab.href) || role === "guardian").map((tab) => (
          <Link
            key={tab.href}
            href={`${basePath}${tab.href}?student=${selection.studentId}`}
            aria-current={tab.href === activeHref ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab.href === activeHref && "font-semibold text-foreground",
            )}
          >
            {tab.href === activeHref && <LayoutPill layoutId="portal-tab" className="absolute inset-0 rounded-md bg-muted" />}
            <span className="relative">{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
