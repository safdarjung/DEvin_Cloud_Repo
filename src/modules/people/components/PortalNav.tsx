import Link from "next/link";
import { cn } from "cn";
import { ChildSwitcher } from "./ChildSwitcher";
import type { PortalSelection } from "@/modules/people/portal";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/attendance", label: "Attendance" },
  { href: "/fees", label: "Fees" },
  { href: "/results", label: "Results" },
  { href: "/assignments", label: "Assignments" },
  { href: "/notifications", label: "Notifications" },
] as const;

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
    <div className="space-y-3">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">{role === "guardian" ? "My children" : "My school"}</h1>
        {selection.children && <ChildSwitcher students={selection.children} selectedId={selection.studentId} />}
      </div>
      <nav aria-label="Portal tabs" className="flex flex-wrap gap-1 border-b border-border pb-1">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={`${basePath}${tab.href}?student=${selection.studentId}`}
            aria-current={tab.href === activeHref ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted",
              tab.href === activeHref && "bg-muted font-semibold",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
