// F-UI-04 — pure roster filter/sort (no DB, no React): the client-side
// narrowing applied to the already-fetched StudentSuccessRow[] (search box,
// section Select, risk chips, "has gaps" toggle). Kept out of roster.tsx so
// it's testable without rendering.
import type { StudentSuccessRow } from "@/modules/fabric/types";

export interface RosterFilter {
  search?: string;
  section?: string;
  risk?: StudentSuccessRow["risk"];
  hasGaps?: boolean;
}

export function filterRoster(rows: StudentSuccessRow[], filter: RosterFilter): StudentSuccessRow[] {
  const search = filter.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.section && row.section_label !== filter.section) return false;
    if (filter.risk && row.risk !== filter.risk) return false;
    if (filter.hasGaps && row.gaps.length === 0) return false;
    if (search) {
      const haystack = [row.name, ...row.gaps.flatMap((g) => [g.subject, g.topic])].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
