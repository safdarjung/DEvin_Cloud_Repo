import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { BarList } from "@/components/widgets/viz";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { listSectionOptions } from "@/modules/exams/queries";
import { buildTimetableGrid, WEEKDAY_NAMES } from "@/modules/timetable/grid";
import { timetableForSection, type SectionTimetableSlot } from "@/modules/timetable/queries";

// Read-only weekly timetable. Authorization: `timetable.read` (RLS further
// narrows guardian/student to their own section's published slots).
export default async function TimetablePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { section } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "timetable");
  requirePermission(ctx, "timetable.read");

  const sections = await listSectionOptions(ctx);
  const selected = sections.find((s) => s.id === section) ?? sections[0];

  let slots: SectionTimetableSlot[] = [];
  let loadError = false;
  if (selected) {
    try {
      slots = await timetableForSection(ctx, selected.id);
    } catch (e) {
      console.error("timetable load failed:", e instanceof Error ? e.message : e);
      loadError = true;
    }
  }
  const grid = buildTimetableGrid(slots);
  const periodsBySubject = new Map<string, number>();
  for (const slot of slots) {
    const name = slot.subject?.name ?? "Period";
    periodsBySubject.set(name, (periodsBySubject.get(name) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Timetable" description={selected ? `Weekly timetable for ${selected.label}` : undefined} />
      {sections.length === 0 ? (
        <EmptyState title="No class sections yet" description="Create grades and sections in academics, then publish a timetable version." />
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <label htmlFor="section" className="text-sm text-muted-foreground">
              Section
            </label>
            <select id="section" name="section" defaultValue={selected?.id} className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:flex-none">
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9">
              View
            </Button>
          </form>
          {loadError ? (
            <ErrorState title="Could not load the timetable" description="Refresh to try again." />
          ) : grid.rows.length === 0 ? (
            <EmptyState title="No published timetable for this section" description="Slots appear here once a timetable version is published." />
          ) : (
            <FadeIn className="space-y-4">
            <Card className="py-0">
              <CardContent className="overflow-x-auto px-0">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      <th scope="col" className="w-28 py-2.5 pr-3 pl-4 font-semibold">
                        Period
                      </th>
                      {grid.days.map((d) => (
                        <th key={d} scope="col" className="px-2 py-2.5 font-semibold">
                          {WEEKDAY_NAMES[d]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((row, i) => (
                      <tr
                        key={row.seq}
                        className="border-t border-border transition-colors duration-(--duration-fast) hover:bg-accent motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-200"
                        style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      >
                        <th scope="row" className="py-2 pr-3 pl-4 text-left font-medium">
                          {row.name}
                          <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                            {row.startsAt}–{row.endsAt}
                          </span>
                        </th>
                        {grid.days.map((d) => {
                          const cell = row.cells.get(d);
                          return (
                            <td key={d} className="px-2 py-2 align-top">
                              {cell ? (
                                <>
                                  <span className="block font-medium">{cell.subject?.name ?? "Period"}</span>
                                  <span className="block text-xs text-muted-foreground">{[cell.teacher.name, cell.room?.name].filter(Boolean).join(" · ")}</span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Periods per week by subject</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  ariaLabel="Periods per week by subject"
                  items={[...periodsBySubject]
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, value]) => ({ label, value }))}
                />
              </CardContent>
            </Card>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}
