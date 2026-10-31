"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { humanize } from "@/lib/format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAV_LABELS = new Map(NAV_ITEMS.map((item) => [item.href, item.label]));

/** Crumbs from the path after `/<institution>`; hidden on top-level pages (a single crumb adds nothing). */
export function Breadcrumbs({ current, className }: { current?: string; className?: string }) {
  const segments = (usePathname() ?? "").split("/").filter(Boolean);
  const [slug, ...rest] = segments;
  if (!slug || rest.length < 2) return null;

  const crumbs = rest.map((segment, i) => {
    const sub = `/${rest.slice(0, i + 1).join("/")}`;
    const isLast = i === rest.length - 1;
    const label =
      (isLast && current) ||
      NAV_LABELS.get(sub) ||
      (UUID.test(segment) ? "Details" : humanize(decodeURIComponent(segment).replace(/-/g, " ")));
    return { href: `/${slug}${sub}`, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1">
            {crumb.isLast ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {crumb.label}
              </span>
            ) : (
              <>
                <Link
                  href={crumb.href}
                  className="truncate rounded-sm outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
