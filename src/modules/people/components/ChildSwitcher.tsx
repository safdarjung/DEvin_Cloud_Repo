"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import type { ChildSummary } from "@/modules/people/queries";

/**
 * T-034 — guardian portal child switcher. Pure navigation via `?student=`
 * on the *current* tab (so switching a child on e.g. /portal/results keeps
 * you on results, acceptance criterion 1) — no write path. Client-only for
 * `usePathname()`; each target page still re-validates the id itself
 * (resolvePortalSelection). Not rendered for the student role (acceptance
 * criterion 3 — no switcher for a single self).
 */
export function ChildSwitcher({ students, selectedId }: { students: ChildSummary[]; selectedId: string }) {
  const pathname = usePathname();
  if (students.length <= 1) return null;

  return (
    <nav aria-label="Select child" className="flex flex-wrap gap-2">
      {students.map((child) => {
        const isSelected = child.id === selectedId;
        const label = [child.firstName, child.lastName].filter(Boolean).join(" ");
        return (
          <Link
            key={child.id}
            href={`${pathname}?student=${child.id}`}
            aria-current={isSelected ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
            )}
          >
            {label}
            {child.gradeName && <span className="ml-1 opacity-70">· {child.gradeName}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
