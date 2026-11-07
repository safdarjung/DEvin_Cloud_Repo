"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { sectionLabel } from "@/components/breadcrumbs";

/** Topbar breadcrumb: "<school> / <section>". Deeper trails live in PageHeader. */
export function HeaderCrumb({ institutionName }: { institutionName: string }) {
  const label = sectionLabel(usePathname() ?? "");
  return (
    <nav aria-label="Location" className="hidden min-w-0 items-center gap-1 text-sm min-[400px]:flex">
      <span className="hidden truncate text-muted-foreground sm:inline">{institutionName}</span>
      <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:inline" aria-hidden />
      <span className="truncate font-semibold text-foreground">{label}</span>
    </nav>
  );
}
