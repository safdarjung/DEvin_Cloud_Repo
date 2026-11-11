"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { sectionLabel } from "@/components/breadcrumbs";

/** Topbar breadcrumb: "<school> / <section>". Deeper trails live in PageHeader. */
export function HeaderCrumb({ institutionName, logoUrl }: { institutionName: string; logoUrl?: string }) {
  const label = sectionLabel(usePathname() ?? "");
  return (
    <nav aria-label="Location" className="hidden min-w-0 items-center gap-1 text-sm min-[400px]:flex">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
        <img src={logoUrl} alt="" className="hidden size-6 shrink-0 rounded object-contain sm:inline" />
      )}
      <span className="hidden truncate text-muted-foreground sm:inline">{institutionName}</span>
      <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:inline" aria-hidden />
      <span className="truncate font-semibold text-foreground">{label}</span>
    </nav>
  );
}
