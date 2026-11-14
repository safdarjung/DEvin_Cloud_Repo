import Link from "next/link";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

const MAX_TABS = 8;

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
  // A whole school's sections as tabs wraps into rows of noise; past a handful, pick from a list.
  if (sections.length > MAX_TABS) {
    return (
      <form action={basePath} className="mb-4 flex items-center gap-2">
        <label htmlFor="section-switcher" className="text-sm text-muted-foreground">
          Section
        </label>
        <select
          id="section-switcher"
          name="section"
          defaultValue={activeId}
          className="h-10 min-w-32 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Open
        </Button>
      </form>
    );
  }
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
