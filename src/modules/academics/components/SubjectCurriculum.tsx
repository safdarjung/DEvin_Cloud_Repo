import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import type { PortalSubject } from "@/modules/academics/portal-subjects.queries";

const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Read-only subjects with per-unit coverage status for the student's section. */
export function SubjectCurriculum({ subjects }: { subjects: PortalSubject[] }) {
  if (subjects.length === 0) {
    return <EmptyState title="No subjects assigned yet" description="Subjects appear once teachers are assigned to your section." />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {subjects.map((s) => {
        const covered = s.units.filter((u) => u.coveredOn).length;
        return (
          <section key={s.id} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">{s.name}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {s.units.length ? `${covered} of ${s.units.length} units covered` : "No units yet"}
              </span>
            </div>
            {s.units.length > 0 && (
              <ol className="mt-3 divide-y divide-border">
                {s.units.map((u) => (
                  <li key={u.id} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{u.title}</span>
                    {u.coveredOn ? (
                      <Badge variant="success">Covered {date.format(new Date(u.coveredOn))}</Badge>
                    ) : (
                      <Badge variant="outline">Not yet covered</Badge>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
