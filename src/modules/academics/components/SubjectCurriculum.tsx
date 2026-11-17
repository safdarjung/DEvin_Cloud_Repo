import type { ReactNode } from "react";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import type { PortalSubject } from "@/modules/academics/portal-subjects.queries";
import { FadeIn } from "@/components/motion";
import { ProgressBar } from "@/components/widgets/viz";
import { UnitChapterBadge } from "@/modules/textbooks/components/BookLinks";
import type { UnitChapterView } from "@/modules/textbooks/queries";

const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Read-only subjects with per-unit coverage status for the student's section; optional textbook chapter per unit and extra content (books, files) per subject. */
export function SubjectCurriculum({
  subjects,
  unitChapters = {},
  extras = {},
}: {
  subjects: PortalSubject[];
  unitChapters?: Record<string, UnitChapterView>;
  extras?: Record<string, ReactNode>;
}) {
  if (subjects.length === 0) {
    return <EmptyState title="No subjects assigned yet" description="Subjects appear once teachers are assigned to your section." />;
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {subjects.map((s, i) => {
        const covered = s.units.filter((u) => u.coveredOn).length;
        return (
          <FadeIn as="section" delay={Math.min(i, 8) * 0.04} key={s.id} className="motion-safe:fill-mode-backwards min-w-0 rounded-md border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">{s.name}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.units.length ? `${covered} of ${s.units.length} units covered` : "No units yet"}
              </span>
            </div>
            {s.units.length > 0 && (
              <ProgressBar
                className="mt-2"
                label="Syllabus covered"
                value={covered}
                max={s.units.length}
                showValue={false}
                tone={covered === s.units.length ? "success" : "default"}
              />
            )}
            {s.units.length > 0 && (
              <ol className="mt-3 divide-y divide-border">
                {s.units.map((u) => (
                  <li key={u.id} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{u.title}</span>
                      {unitChapters[u.id] && <UnitChapterBadge chapter={unitChapters[u.id]!} />}
                    </span>
                    {u.coveredOn ? (
                      <Badge variant="success">Covered {date.format(new Date(u.coveredOn))}</Badge>
                    ) : (
                      <Badge variant="outline">Not yet covered</Badge>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {extras[s.id]}
          </FadeIn>
        );
      })}
    </div>
  );
}
