"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { GUARDIAN_NAV, NAV_ITEMS, STUDENT_NAV } from "@/lib/nav";
import { humanize } from "@/lib/format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAV_LABELS = new Map([...NAV_ITEMS, ...GUARDIAN_NAV, ...STUDENT_NAV].map((item) => [item.href, item.label]));

// Static-segment paths (after `/<institution>`) that have a page.tsx; `*`
// stands in for a dynamic `[id]` segment. Regenerate by hand when adding a
// route: `find "src/app/(tenant)/[institution]" -name page.tsx`.
export const PAGE_PATHS = new Set([
  "achievements",
  "admissions",
  "admissions/applications",
  "admissions/applications/*",
  "admissions/enquiries/*",
  "ai",
  "ai/usage",
  "alumni",
  "assignments",
  "assignments/*",
  "assignments/new",
  "assignments/units/*",
  "assistant",
  "attendance",
  "attendance/*",
  "behaviour",
  "canteen",
  "certificates",
  "clubs",
  "compliance",
  "dashboard",
  "diary",
  "documents",
  "duties",
  "exams",
  "exams/*",
  "exams/new",
  "exams/*/papers/*",
  "exams/rechecks",
  "exams/rechecks/*",
  "exams/*/results",
  "exams/*/results/*",
  "exams/seating",
  "fabric/agents",
  "fabric/data",
  "fabric/finance-intel",
  "fabric/insights",
  "fabric/lab",
  "fabric/learning",
  "fabric/marketplace",
  "fabric/operations",
  "fabric/simulator",
  "fabric/students",
  "fabric/studio",
  "fabric/trust",
  "fabric/twin",
  "fabric/workflows",
  "finance",
  "finance/concessions",
  "finance/defaulters",
  "finance/expenses",
  "finance/fee-plans",
  "finance/invoices",
  "finance/invoices/*",
  "finance/ledger",
  "finance/receipts/*",
  "finance/receipts/*/print",
  "finance/structures",
  "finance/structures/*",
  "forms",
  "health",
  "helpdesk",
  "hostel",
  "calendar",
  "transport",
  "inventory",
  "jobs",
  "labs",
  "lesson-plans",
  "learning-insights",
  "library",
  "me",
  "me/teaching-profile",
  "messages",
  "messages/*",
  "notifications",
  "notifications/log",
  "orb",
  "payroll",
  "payroll/payslips/*",
  "payroll/runs/*",
  "portal",
  "portal/achievements",
  "portal/assignments",
  "portal/assignments/*",
  "portal/assistant",
  "portal/attendance",
  "portal/calendar",
  "portal/exams",
  "portal/library",
  "portal/timetable",
  "portal/transport",
  "portal/behaviour",
  "portal/canteen",
  "portal/clubs",
  "portal/fees",
  "portal/fees/invoices/*",
  "portal/fees/receipts/*",
  "portal/forms",
  "portal/health",
  "portal/helpdesk",
  "portal/leave",
  "portal/meetings",
  "portal/messages",
  "portal/messages/*",
  "portal/notifications",
  "portal/practice",
  "portal/results",
  "portal/resources",
  "portal/safety",
  "portal/study",
  "portal/study/notebook",
  "portal/study/notebook/*",
  "portal/study/studio",
  "portal/study/scope",
  "portal/study/scope/*",
  "portal/study/search",
  "portal/study-progress",
  "portal/tests",
  "portal/tests/*",
  "portal/tests/attempt/*",
  "portal/tests/result/*",
  "portal/subjects",
  "portal/surveys",
  "portal/updates",
  "online-tests",
  "online-tests/new",
  "online-tests/*",
  "online-tests/*/marking",
  "online-tests/*/analytics",
  "ptm",
  "question-bank",
  "question-papers",
  "question-papers/new",
  "question-papers/*",
  "resources",
  "textbooks",
  "textbooks/*",
  "textbooks/search",
  "safety",
  "settings/ai",
  "settings/control-centre",
  "settings/modules",
  "settings/school",
  "staff/qualifications",
  "settings/study-preferences",
  "setup",
  "staff",
  "students",
  "students/*",
  "students/lifecycle",
  "students/new",
  "study-studio",
  "timetable",
  "today",
  "visitors",
  "website",
  "website/events",
  "website/notices",
  "website/pages/*",
  "website/pages/*/versions/*",
  "website/theme",
]);

/** True when some route under `[institution]` has a page.tsx at this exact depth/shape. */
function hasPage(segments: readonly string[]): boolean {
  return PAGE_PATHS.has(segments.map((s) => (UUID.test(s) ? "*" : s)).join("/"));
}

export interface Crumb {
  href: string;
  label: string;
  isLast: boolean;
  /** False for an intermediate segment with no page.tsx: rendered as plain text, not a Link. */
  isLink: boolean;
}

/** Pure: crumbs for the path after `/<institution>`; empty when a single crumb would add nothing. */
export function crumbsFor(pathname: string, current?: string): Crumb[] {
  const segments = (pathname ?? "").split("/").filter(Boolean);
  const [slug, ...rest] = segments;
  if (!slug || rest.length < 2) return [];

  return rest.map((segment, i) => {
    const subSegments = rest.slice(0, i + 1);
    const sub = `/${subSegments.join("/")}`;
    const isLast = i === rest.length - 1;
    const label =
      (isLast && current) ||
      NAV_LABELS.get(sub) ||
      (UUID.test(segment) ? "Details" : humanize(decodeURIComponent(segment).replace(/-/g, " ")));
    return { href: `/${slug}${sub}`, label, isLast, isLink: !isLast && hasPage(subSegments) };
  });
}

/** Topbar caption: label of the section (first segment after `/<institution>`), or of the exact portal page. */
export function sectionLabel(pathname: string): string {
  const [, ...rest] = (pathname ?? "").split("/").filter(Boolean);
  if (rest.length === 0) return "Home";
  const exact = NAV_LABELS.get(`/${rest.join("/")}`);
  if (exact) return exact;
  return NAV_LABELS.get(`/${rest[0]}`) ?? humanize(decodeURIComponent(rest[0]).replace(/-/g, " "));
}

/** Crumbs from the path after `/<institution>`; hidden on top-level pages (a single crumb adds nothing). */
export function Breadcrumbs({ current, className }: { current?: string; className?: string }) {
  const crumbs = crumbsFor(usePathname() ?? "", current);
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1">
            {crumb.isLast ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {crumb.label}
              </span>
            ) : crumb.isLink ? (
              <>
                <Link
                  href={crumb.href}
                  className="truncate rounded-sm outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              </>
            ) : (
              <>
                <span className="truncate">{crumb.label}</span>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
