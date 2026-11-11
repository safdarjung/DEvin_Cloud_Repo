import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize, type BadgeVariant } from "@/lib/format";
import { listStudents } from "@/modules/people/queries";
import { AssignStopForm, EditStopForm, RouteForm, StopForm, UnassignButton, VehicleForm } from "@/modules/transport/components/TransportForms";
import { transportForStudent, transportRoutes, transportVehicles } from "@/modules/transport/queries";

export const metadata: Metadata = { title: "Transport" };

const STATUS_VARIANT: Record<string, BadgeVariant> = { on_time: "success", delayed: "warning", off_road: "outline" };
const LOOKUP_LIMIT = 10;

// Page, route list, forms and lookup all need transport.manage (the routes query's permission).
export default async function TransportPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { institution: slug } = await params;
  const { q } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "transport");
  requirePermission(ctx, "transport.manage");

  const query = q?.trim().slice(0, 60) || undefined;
  const [routesR, vehiclesR, lookupR] = await Promise.allSettled([
    transportRoutes(ctx),
    transportVehicles(ctx),
    query
      ? listStudents(ctx, query, 1, { status: "active" }).then((page) =>
          Promise.all(page.students.slice(0, LOOKUP_LIMIT).map(async (s) => ({ student: s, transport: await transportForStudent(ctx, s.id) }))),
        )
      : Promise.resolve([]),
  ]);
  for (const r of [routesR, vehiclesR, lookupR]) if (r.status === "rejected") console.error("transport page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);

  const vehicles = vehiclesR.status === "fulfilled" ? vehiclesR.value : [];
  const vehicleOptions = vehicles.map((v) => ({ id: v.id, label: `${v.registrationNo} · ${v.capacity} seats` }));
  const stopOptions = routesR.status === "fulfilled" ? routesR.value.flatMap((r) => r.stops.map((s) => ({ id: s.id, label: `${r.name} · ${s.name} (${s.eta})` }))) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Transport" description="Routes, stops, vehicle capacity and who rides." />

      {routesR.status === "rejected" ? (
        <ErrorState title="Could not load routes" description="Refresh to try again." />
      ) : routesR.value.length === 0 ? (
        <EmptyState title="No routes yet" description="Add the first route below." />
      ) : (
        <div className="space-y-4">
          {routesR.value.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {r.name}
                  <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{humanize(r.status)}</Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {r.vehicle ? `${r.vehicle}${r.driver ? ` · ${r.driver}` : ""}` : "No vehicle assigned"} · {r.assigned}/{r.capacity || "?"} seats assigned
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {r.stops.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No stops yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stop</TableHead>
                        <TableHead>Pickup</TableHead>
                        <TableHead className="text-right">Students</TableHead>
                        <TableHead>Edit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.stops.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell className="tabular-nums">{s.eta}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.students}</TableCell>
                          <TableCell>
                            <EditStopForm institutionSlug={slug} stop={{ id: s.id, routeId: r.id, seq: s.seq, name: s.name, eta: s.eta, x: s.x, y: s.y }} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <RouteForm institutionSlug={slug} route={{ id: r.id, name: r.name, status: r.status, vehicleId: r.vehicleId }} vehicles={vehicleOptions} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New route</CardTitle>
        </CardHeader>
        <CardContent>
          <RouteForm institutionSlug={slug} vehicles={vehicleOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {vehiclesR.status === "rejected" && <ErrorState title="Could not load vehicles" description="Refresh to try again." />}
          {vehicles.map((v) => (
            <VehicleForm key={v.id} institutionSlug={slug} vehicle={v} />
          ))}
          <VehicleForm institutionSlug={slug} />
        </CardContent>
      </Card>

      {routesR.status === "fulfilled" && routesR.value.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>New stop</CardTitle>
          </CardHeader>
          <CardContent>
            <StopForm institutionSlug={slug} routes={routesR.value.map((r) => ({ id: r.id, name: r.name, stopCount: r.stops.length }))} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Find a student&apos;s transport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Name or admission no.
              <input name="q" defaultValue={query} maxLength={60} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm" />
            </label>
            <button type="submit" className="h-10 rounded-md border px-3 text-sm">
              Search
            </button>
          </form>
          {query &&
            (lookupR.status === "rejected" ? (
              <ErrorState title="Could not search students" description="Refresh to try again." />
            ) : lookupR.value.length === 0 ? (
              <EmptyState title="No students found" description="Try a different name or admission number." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Route and stop</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookupR.value.map(({ student: s, transport: t }) => {
                    const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {name} <span className="text-muted-foreground">({s.admissionNo})</span>
                        </TableCell>
                        <TableCell>{t ? `${t.routeName} · ${t.stop.name} at ${t.stop.eta}` : <span className="text-muted-foreground">Not assigned</span>}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-2">
                            <AssignStopForm institutionSlug={slug} studentId={s.id} studentName={name} stops={stopOptions} />
                            {t && <UnassignButton institutionSlug={slug} studentId={s.id} studentName={name} />}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
