import type { ReactNode } from "react";
import { LimitedBadge } from "@/components/honesty";
import { EmptyState, ErrorState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Widget } from "@/components/widgets/widget";
import type { Permission } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules/catalog";

/** One independently-loaded page section: hidden (no permission), off (module disabled), error, or data. */
export type Section<T> = { state: "hidden" } | { state: "off" } | { state: "error" } | { state: "ok"; data: T };

/**
 * Permission-gate, module-gate, then load. A failed load is one failed section,
 * never a crashed page. Hiding is not authorization: `load` calls real queries
 * that RLS still narrows.
 */
export async function loadSection<T>(
  ctx: TenantContext,
  name: string,
  permission: Permission,
  module: ModuleKey | null,
  load: () => Promise<T>,
): Promise<Section<T>> {
  if (!hasPermission(ctx, permission)) return { state: "hidden" };
  if (module && !isModuleEnabled(ctx, module)) return { state: "off" };
  try {
    return { state: "ok", data: await load() };
  } catch (e) {
    console.error(`fabric section "${name}" failed:`, e instanceof Error ? e.message : "unknown error");
    return { state: "error" };
  }
}

export function renderSection<T>(
  title: string,
  section: Section<T>,
  render: (data: T) => ReactNode,
  opts: { description?: string; action?: { href: string; label: string }; className?: string } = {},
): ReactNode {
  if (section.state === "hidden") return null;
  const { description, action, className } = opts;
  return (
    <Widget title={title} description={description} action={action} className={className}>
      {section.state === "off" ? (
        <EmptyState title="Module not enabled" description="An administrator can enable it in module settings." />
      ) : section.state === "error" ? (
        <ErrorState title={`Couldn't load ${title.toLowerCase()}`} description="The rest of this page is unaffected. Refresh to try again." />
      ) : (
        render(section.data)
      )}
    </Widget>
  );
}

/** A capability with no backend yet. Never shows numbers. */
export function PlannedWidget({ title, note, className }: { title: string; note: string; className?: string }) {
  return (
    <Widget title={title} className={className}>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <LimitedBadge />
        <span>Planned. {note}</span>
      </p>
    </Widget>
  );
}

/** Accessible read-only table; wide tables scroll horizontally inside the card. */
export function SimpleTable({
  caption,
  head,
  rows,
  numericCols = [],
}: {
  caption: string;
  head: string[];
  rows: { key: string; cells: ReactNode[] }[];
  numericCols?: number[];
}) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={h} scope="col" className={numericCols.includes(i) ? "text-right" : undefined}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            {r.cells.map((c, i) => (
              <TableCell key={i} className={numericCols.includes(i) ? "text-right tabular-nums" : undefined}>
                {c}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Text status chip: always words, never color alone. */
export function StatusChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "bad" | "good" }) {
  const cls = {
    neutral: "bg-muted text-muted-foreground",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    bad: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    good: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Shared loading.tsx body: header + KPI row + two cards, matching the workspace grid. */
export function WorkspaceLoading({ kpis = 3 }: { kpis?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-9 w-1/3 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
