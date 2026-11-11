// 0141 — the Changes panel: every logged change (who, when, before -> after,
// why), filterable by section, teacher, date range and kind; Undo for managers.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChangeRow } from "@/modules/timetable/control.queries";
import { CHANGE_KINDS } from "@/modules/timetable/schemas";
import { ChangeDetail, kindLabel } from "./change-why";

const FIELD = "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm sm:h-9";

interface Option {
  id: string;
  label: string;
}

export interface ChangeFilters {
  section?: string;
  teacher?: string;
  kind?: string;
  from?: string;
  to?: string;
}

export function ChangesPanel({
  rows,
  total,
  moreHref,
  undone,
  filters,
  sections,
  teachers,
  slug,
  timeZone,
  canManage,
}: {
  rows: ChangeRow[];
  /** Rows loaded (before paging); `rows` is the visible page and `moreHref` shows 20 more. */
  total: number;
  moreHref: string;
  undone: Set<string>;
  filters: ChangeFilters;
  sections: Option[];
  teachers: Option[];
  slug: string;
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      <form method="get" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
        <input type="hidden" name="tab" value="changes" />
        <label className="grid gap-1 text-sm">
          Section
          <select name="cs" defaultValue={filters.section ?? ""} className={FIELD}>
            <option value="">All</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Teacher
          <select name="teacher" defaultValue={filters.teacher ?? ""} className={FIELD}>
            <option value="">All</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Kind
          <select name="kind" defaultValue={filters.kind ?? ""} className={FIELD}>
            <option value="">All</option>
            {CHANGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={FIELD} />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={FIELD} />
        </label>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes match these filters.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((c) => (
            <li key={c.id} className="space-y-1 p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={c.kind === "rollback" ? "warning" : c.kind === "substitution" ? "info" : "secondary"}>{kindLabel(c.kind)}</Badge>
                <span className="font-medium">{c.label ?? (c.action === "rules" ? "Timetable rules" : "Whole timetable")}</span>
                {undone.has(c.id) && <Badge variant="outline">Undone</Badge>}
              </p>
              <ChangeDetail change={c} slug={slug} timeZone={timeZone} canUndo={canManage && !undone.has(c.id) && ((c.classSectionId !== null && c.action !== "uncover") || c.action === "rules")} />
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
          <Link href={moreHref}>
            Show 20 more ({total - rows.length} left)
          </Link>
        </Button>
      )}
    </div>
  );
}
