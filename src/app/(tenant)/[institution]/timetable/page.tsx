import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <div className="space-y-4">
      <PageHeader title="Timetable" description={selected ? `Weekly timetable for ${selected.label}` : undefined} />
      {sections.length === 0 ? (
        <EmptyState title="No class sections yet" description="Create grades and sections in academics, then publish a timetable version." />
      ) : (
        <>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="section" className="text-sm text-muted-foreground">
              Section
            </label>
            <select id="section" name="section" defaultValue={selected?.id} className="h-10 rounded-[15px] border border-input bg-transparent px-3 text-sm">
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              View
            </Button>
          </form>
          {loadError ? (
            <ErrorState title="Could not load the timetable" description="Refresh to try again." />
          ) : grid.rows.length === 0 ? (
            <EmptyState title="No published timetable for this section" description="Slots appear here once a timetable version is published." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="w-28 py-2 pr-3 font-medium">
                        Period
                      </th>
                      {grid.days.map((d) => (
                        <th key={d} scope="col" className="px-2 py-2 font-medium">
                          {WEEKDAY_NAMES[d]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((row) => (
                      <tr key={row.seq} className="border-t">
                        <th scope="row" className="py-2 pr-3 text-left font-medium">
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
          )}
        </>
      )}
    </div>
  );
}
