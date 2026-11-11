import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { AllocateForm, RollCallForm, RoomForm, VacateButton } from "@/modules/hostel/components/HostelForms";
import { hostelAllocatableStudents, hostelAllocations, hostelRollCall, hostelRooms } from "@/modules/hostel/queries";
import { ROLL_CALL_SESSIONS } from "@/modules/hostel/schemas";

export const metadata: Metadata = { title: "Hostel" };

const TABS = [
  { key: "rooms", label: "Rooms" },
  { key: "allocations", label: "Allocations" },
  { key: "rollcall", label: "Roll call" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function HostelPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ tab?: string; date?: string; session?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "hostel");
  requirePermission(ctx, "hostel.read");
  const canManage = hasPermission(ctx, "hostel.manage");

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "rooms";
  const date = sp.date && ISO_DATE.test(sp.date) ? sp.date : todayInInstitutionTimezone(ctx);
  const session = ROLL_CALL_SESSIONS.find((s) => s === sp.session) ?? "night";

  const [roomsR, allocR, studentsR, callR] = await Promise.allSettled([
    hostelRooms(ctx),
    hostelAllocations(ctx),
    tab === "allocations" && canManage ? hostelAllocatableStudents(ctx) : Promise.resolve([]),
    tab === "rollcall" ? hostelRollCall(ctx, { takenOn: date, session }) : Promise.resolve(null),
  ]);
  for (const r of [roomsR, allocR, studentsR, callR]) if (r.status === "rejected") console.error("hostel page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);

  return (
    <div className="space-y-6">
      <PageHeader title="Hostel" description="Rooms, who sleeps where, and the daily roll call." compact />
      <nav aria-label="Hostel sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px min-h-10 border-b-2 px-3 py-2 text-sm ${t.key === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "rooms" && (
        <section aria-label="Rooms" className="space-y-4">
          {roomsR.status === "rejected" ? (
            <ErrorState title="Could not load rooms" description="Refresh to try again." />
          ) : roomsR.value.length === 0 ? (
            <EmptyState title="No rooms yet" description="Add the first room below." />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Room</TableHead>
                      <TableHead className="text-right">Occupancy</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead>Edit</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roomsR.value.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.block}-{r.roomNo}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.occupied}/{r.capacity}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.isActive ? "success" : "outline"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <RoomForm institutionSlug={slug} room={r} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>New room</CardTitle>
              </CardHeader>
              <CardContent>
                <RoomForm institutionSlug={slug} />
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {tab === "allocations" && (
        <section aria-label="Allocations" className="space-y-4">
          {canManage && roomsR.status === "fulfilled" && studentsR.status === "fulfilled" && (
            <Card>
              <CardHeader>
                <CardTitle>Allocate a student</CardTitle>
              </CardHeader>
              <CardContent>
                <AllocateForm institutionSlug={slug} rooms={roomsR.value} students={studentsR.value as Awaited<ReturnType<typeof hostelAllocatableStudents>>} />
              </CardContent>
            </Card>
          )}
          {allocR.status === "rejected" ? (
            <ErrorState title="Could not load allocations" description="Refresh to try again." />
          ) : allocR.value.length === 0 ? (
            <EmptyState title="No one is allocated" description="Allocate a student to a room above." />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead className="hidden sm:table-cell">Since</TableHead>
                      {canManage && (
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocR.value.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.studentName} <span className="text-muted-foreground">({a.admissionNo})</span>
                        </TableCell>
                        <TableCell>{a.room}</TableCell>
                        <TableCell className="hidden sm:table-cell">{a.allocatedOn}</TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <VacateButton institutionSlug={slug} row={a} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {tab === "rollcall" && (
        <section aria-label="Roll call" className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="rollcall" />
            <label className="text-sm">
              Date
              <input type="date" name="date" defaultValue={date} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm" />
            </label>
            <label className="text-sm">
              Session
              <select name="session" defaultValue={session} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm">
                {ROLL_CALL_SESSIONS.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-md border px-3 text-sm">
              Open
            </button>
          </form>
          {allocR.status === "rejected" || callR.status === "rejected" ? (
            <ErrorState title="Could not load roll call" description="Refresh to try again." />
          ) : allocR.value.length === 0 ? (
            <EmptyState title="No one is allocated" description="Allocate students to rooms before taking a roll call." />
          ) : (
            (() => {
              const call = callR.value;
              const nameOf = new Map(allocR.value.map((a) => [a.studentId, a]));
              const absentees = (call?.entries ?? []).filter((e) => e.status === "absent");
              return (
                <>
                  {call && (
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          Absentees ({absentees.length} of {call.entries.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {absentees.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No one marked absent.</p>
                        ) : (
                          <ul className="list-disc pl-5 text-sm">
                            {absentees.map((e) => (
                              <li key={e.studentId}>
                                {nameOf.get(e.studentId)?.studentName ?? "Former resident"} · {nameOf.get(e.studentId)?.room ?? "vacated"}
                                {e.note ? ` — ${e.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  {canManage ? (
                    <RollCallForm
                      key={`${date}-${session}-${call?.id ?? "new"}`}
                      institutionSlug={slug}
                      takenOn={date}
                      session={session}
                      students={allocR.value.map((a) => ({ id: a.studentId, name: a.studentName, room: a.room }))}
                      existing={call?.entries ?? []}
                    />
                  ) : null}
                </>
              );
            })()
          )}
        </section>
      )}
    </div>
  );
}
