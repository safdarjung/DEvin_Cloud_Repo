"use client";

import { usePathname } from "next/navigation";
import { humanize } from "@/lib/format";

/** Vision-style navbar caption: "Pages / <section>" over the institution name. */
export function HeaderCrumb({ institutionName }: { institutionName: string }) {
  const section = usePathname().split("/")[2];
  return (
    <span className="hidden min-w-0 flex-col leading-tight min-[400px]:flex">
      <span className="truncate text-xs text-muted-foreground">Pages / {section ? humanize(section) : "Home"}</span>
      <span className="truncate text-sm font-bold">{institutionName}</span>
    </span>
  );
}
