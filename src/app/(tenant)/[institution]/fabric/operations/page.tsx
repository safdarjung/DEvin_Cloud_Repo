import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { SimpleTable, StatusChip, loadSection, renderSection } from "@/modules/fabric/components/fabric-sections";
import { facilitiesAssets, facilitiesMaintenanceRequests } from "@/modules/facilities/queries";
import { defaultPublishedVersionId, timetableConflicts, timetableRoomUtilisation, timetableTeacherWorkload } from "@/modules/timetable/queries";
import { timetableCoverNeeded } from "@/modules/timetable/substitution.queries";
import { transportRoutes } from "@/modules/transport/queries";

const PRIORITY_TONE = { high: "bad", medium: "warn", low: "neutral" } as const;
const ROUTE_TONE = { on_time: "good", delayed: "warn", off_road: "bad" } as const;

export default async function OperationsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const [timetable, cover, transport, facilities] = await Promise.all([
    loadSection(ctx, "timetable", "timetable.manage", "timetable", async () => {
      const versionId = await defaultPublishedVersionId(ctx);
      if (!versionId) return null;
      const [conflicts, workload, rooms] = await Promise.all([
        timetableConflicts(ctx, versionId),
        timetableTeacherWorkload(ctx, versionId),
        timetableRoomUtilisation(ctx, versionId),
      ]);
      return { conflicts, workload, rooms };
    }),
    loadSection(ctx, "cover", "timetable.manage", "substitution", () => timetableCoverNeeded(ctx)),
    loadSection(ctx, "transport", "transport.manage", "transport", () => transportRoutes(ctx)),
    loadSection(ctx, "facilities", "maintenance.request", "facilities", async () => {
      const [requests, assets] = await Promise.all([facilitiesMaintenanceRequests(ctx), facilitiesAssets(ctx)]);
      return { requests, assets };
    }),
  ]);

  const nothing = [timetable, cover, transport, facilities].every((s) => s.state === "hidden");
  const openRequests = facilities.state === "ok" ? facilities.data.requests.filter((r) => r.status !== "done").length : null;
  const hasKpis = (timetable.state === "ok" && !!timetable.data) || cover.state === "ok" || transport.state === "ok" || openRequests !== null;

  return (
    <FabricPage title="Operations" description="Timetable health, cover, transport and facilities from live records." ws="operations">
      <div className="space-y-4">
        {nothing && <p className="text-sm text-muted-foreground">Your role has no operations views. Ask an administrator if you need access.</p>}

        {hasKpis && (
          <section aria-label="Summary">
            <KpiStrip className="md:[&>div]:grid-cols-4 xl:[&>div]:grid-cols-4">
              {timetable.state === "ok" && timetable.data && <KpiTile label="Timetable conflicts" value={String(timetable.data.conflicts.length)} sub="published version" />}
              {cover.state === "ok" && <KpiTile label="Periods needing cover today" value={String(cover.data.filter((c) => !c.substitution).length)} sub={`${cover.data.length} total`} />}
              {transport.state === "ok" && <KpiTile label="Transport routes" value={String(transport.data.length)} />}
              {openRequests !== null && <KpiTile label="Open maintenance requests" value={String(openRequests)} />}
            </KpiStrip>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {renderSection(
            "Timetable conflicts",
            timetable,
            (t) => {
              if (!t) return <p className="text-sm text-muted-foreground">No published timetable yet.</p>;
              if (t.conflicts.length === 0) return <p className="text-sm text-muted-foreground">No conflicts in the published timetable.</p>;
              return (
                <SimpleTable
                  caption="Conflicts in the published timetable"
                  head={["Kind", "Who / what", "Suggestion"]}
                  rows={t.conflicts.map((c) => ({
                    key: c.id,
                    cells: [<StatusChip key="k" tone="warn">{humanize(c.kind)}</StatusChip>, c.entities.join(", "), c.suggestion],
                  }))}
                />
              );
            },
            { description: "Room capacity and teacher overload checks" },
          )}

          {renderSection(
            "Cover needed today",
            cover,
            (rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No teacher is on leave or absent for a scheduled period today.</p>
              ) : (
                <SimpleTable
                  caption="Periods that need a substitute today"
                  head={["Period", "Section", "Teacher", "Why", "Cover"]}
                  rows={rows.map((r) => ({
                    key: r.slotId,
                    cells: [
                      `${r.period.name} ${r.period.startsAt}`,
                      r.section.name,
                      r.teacher.name,
                      humanize(r.reason),
                      r.substitution ? r.substitution.substituteName : <StatusChip key="c" tone="bad">Unassigned</StatusChip>,
                    ],
                  }))}
                />
              ),
            { description: "Published timetable slots whose teacher is on leave or absent" },
          )}

          {renderSection(
            "Teacher workload",
            timetable,
            (t) => {
              if (!t || t.workload.length === 0) return <p className="text-sm text-muted-foreground">No teacher workload to show.</p>;
              const rows = [...t.workload].sort((a, b) => b.periods_week / (b.max_periods || 1) - a.periods_week / (a.max_periods || 1));
              return (
                <SimpleTable
                  caption="Periods per week against each teacher's limit"
                  head={["Teacher", "Periods / week", "Limit"]}
                  numericCols={[1, 2]}
                  rows={rows.map((w) => ({
                    key: w.staff_id,
                    cells: [
                      w.name,
                      <>
                        {w.periods_week}
                        {w.periods_week > w.max_periods && <StatusChip tone="bad"> Over limit</StatusChip>}
                      </>,
                      w.max_periods,
                    ],
                  }))}
                />
              );
            },
            { description: "Periods per week against the configured limit" },
          )}

          {renderSection(
            "Room utilisation",
            timetable,
            (t) => {
              if (!t || t.rooms.length === 0) return <p className="text-sm text-muted-foreground">No rooms to show.</p>;
              return (
                <SimpleTable
                  caption="Periods used per room"
                  head={["Room", "Capacity", "Periods used", "Utilisation"]}
                  numericCols={[1, 2, 3]}
                  rows={t.rooms.map((r) => ({
                    key: r.room,
                    cells: [r.room, r.capacity, `${r.periods_used} / ${r.periods_total}`, r.periods_total > 0 ? `${Math.round((r.periods_used / r.periods_total) * 100)}%` : "—"],
                  }))}
                />
              );
            },
            { description: "Share of weekly periods each room is booked" },
          )}

          {renderSection(
            "Transport routes",
            transport,
            (routes) =>
              routes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No routes set up.</p>
              ) : (
                <SimpleTable
                  caption="Transport routes, vehicles and seats assigned"
                  head={["Route", "Vehicle", "Stops", "Seats", "Status"]}
                  numericCols={[2, 3]}
                  rows={routes.map((r) => ({
                    key: r.id,
                    cells: [
                      r.name,
                      r.vehicle ? `${r.vehicle}${r.driver ? ` · ${r.driver}` : ""}` : "No vehicle",
                      r.stops.length,
                      `${r.assigned} / ${r.capacity || "?"}`,
                      <StatusChip key="s" tone={ROUTE_TONE[r.status]}>{humanize(r.status)}</StatusChip>,
                    ],
                  }))}
                />
              ),
            { description: "Status is the route record's own field, not live GPS." },
          )}

          {renderSection(
            "Maintenance requests",
            facilities,
            ({ requests, assets }) => {
              const open = requests.filter((r) => r.status !== "done");
              return (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {open.length} open of {requests.length} requests · {assets.length} assets on record
                  </p>
                  {open.length === 0 ? (
                    <p className="text-sm">Nothing open.</p>
                  ) : (
                    <SimpleTable
                      caption="Open maintenance requests"
                      head={["Issue", "Where", "Priority", "Status", "Assignee"]}
                      rows={open.slice(0, 10).map((r) => ({
                        key: r.id,
                        cells: [r.issue, r.location ? `${r.asset} · ${r.location}` : r.asset, <StatusChip key="p" tone={PRIORITY_TONE[r.priority]}>{humanize(r.priority)}</StatusChip>, humanize(r.status), r.assignee ?? "Unassigned"],
                      }))}
                    />
                  )}
                  {open.length > 10 && <p className="text-xs text-muted-foreground">Showing 10 of {open.length} open requests.</p>}
                </div>
              );
            },
            { description: "Requests you are allowed to see" },
          )}
        </div>
      </div>
    </FabricPage>
  );
}
