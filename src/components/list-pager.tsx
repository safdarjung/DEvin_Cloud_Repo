import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Previous/Next links for a server-paginated list. Preserves the other query params. Renders nothing for a single page. */
export function ListPager({
  basePath,
  params,
  page,
  total,
  pageSize,
  noun,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  total: number;
  pageSize: number;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground tabular-nums">
        Page {page} of {pages} ({total} {noun})
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild size="sm" variant="outline">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        )}
        {page < pages && (
          <Button asChild size="sm" variant="outline">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
