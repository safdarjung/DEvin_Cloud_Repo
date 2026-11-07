import Link from "next/link";
import { cn } from "cn";

/** Link-based section picker driven by a `?section=` search param (server-rendered, no client state). */
export function SectionSwitcher({
  basePath,
  sections,
  activeId,
}: {
  basePath: string;
  sections: { id: string; label: string }[];
  activeId: string;
}) {
  if (sections.length < 2) return null;
  return (
    <nav aria-label="Section" className="mb-4 flex flex-wrap gap-1 border-b-2 border-border">
      {sections.map((s) => (
        <Link
          key={s.id}
          href={`${basePath}?section=${s.id}`}
          aria-current={s.id === activeId ? "page" : undefined}
          className={cn(
            "-mb-0.5 inline-flex min-h-10 items-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            s.id === activeId ? "border-ring font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
