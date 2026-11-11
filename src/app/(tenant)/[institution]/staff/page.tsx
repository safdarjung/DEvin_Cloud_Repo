import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { humanize } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { leaveRequests, staffAttendanceForDate } from "@/modules/people/hr.queries";
import { AssignSubstituteForm, CancelSubstitutionButton, CheckInButton, LeaveRequestForm, LeaveRowActions } from "@/modules/people/components/staff-actions";
import { timetableCoverNeeded, timetableSubstitutionCandidates } from "@/modules/timetable/substitution.queries";
import { HandoverNoteButton } from "@/modules/ai/components/HandoverNoteButton";
import { aiTaskOn } from "@/modules/ai/task-route";

export const metadata: Metadata = { title: "Staff HR" };

type Section = "attendance" | "leave" | "substitutions";

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const day = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

const LEAVE_TONE = { approved: "success", pending: "outline", rejected: "destructive", cancelled: "outline" } as const;

async function safe<T>(label: string, p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    console.error(`staff page ${label} failed:`, e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

// Staff HR: attendance, leave, substitutions. Each tab gates itself; the page floor is `leave.request`
// (every staff role). Cover assignment is not duplicated in fabric/operations, which only lists it read-only.
export default async function StaffPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ section?: string }> }) {
  const { institution: institutionSlug } = await params;
  const { section } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "staff_attendance");
  requirePermission(ctx, "leave.request");

  const canSubstitute = hasPermission(ctx, "timetable.manage") && isModuleEnabled(ctx, "substitution");
  const sections = [
    { id: "attendance", label: "Attendance" },
    { id: "leave", label: "Leave" },
    ...(canSubstitute ? [{ id: "substitutions", label: "Substitutions" }] : []),
  ];
  const active: Section = sections.some((s) => s.id === section) ? (section as Section) : "attendance";

  return (
    <div className="space-y-4">
      <PageHeader title="Staff HR" description="Check-in, leave and substitute cover." compact />
      <SectionSwitcher basePath={`/${institutionSlug}/staff`} sections={sections} activeId={active} />
      {active === "attendance" && <AttendanceTab ctx={ctx} slug={institutionSlug} />}
      {active === "leave" && <LeaveTab ctx={ctx} slug={institutionSlug} />}
      {active === "substitutions" && <SubstitutionsTab ctx={ctx} slug={institutionSlug} />}
    </div>
  );
}

async function AttendanceTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  if (!ctx.membership.staffId && !hasPermission(ctx, "staff.attendance.mark")) {
    return <EmptyState title="No staff profile on this account" description="Attendance is tied to a staff profile. Ask an administrator to link yours." />;
  }
  const today = todayInInstitutionTimezone(ctx);
  const r = await safe("attendance", staffAttendanceForDate(ctx, today));
  if (!r.ok) return <ErrorState title="Could not load attendance" description="Refresh to try again." />;
  const mine = r.data.find((s) => s.staffId === ctx.membership.staffId);
  const canCheckIn = hasPermission(ctx, "staff.attendance.mark") && mine && !mine.checkInAt && !mine.onLeave && !mine.status;
  return (
    <section aria-labelledby="staff-att" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="staff-att" className="text-base font-semibold">
          Today, {day(today)}
        </h2>
        {canCheckIn && <CheckInButton institutionSlug={slug} />}
      </div>
      {r.data.length === 0 ? (
        <EmptyState title="No staff to show" description="No active staff records are visible to you." />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Designation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Checked in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.data.map((s) => (
                  <TableRow key={s.staffId}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.designation}</TableCell>
                    <TableCell>
                      {s.onLeave ? <Badge variant="outline">On leave</Badge> : s.status ? <Badge variant={s.status === "absent" ? "destructive" : "success"}>{humanize(s.status)}</Badge> : <Badge variant="outline">Not marked</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.checkInAt ? timeFmt.format(new Date(s.checkInAt)) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

async function LeaveTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  const canDecide = hasPermission(ctx, "leave.approve");
  const r = await safe("leave", leaveRequests(ctx, { limit: 100 }));
  const own = ctx.membership.staffId;
  const rows = r.ok ? r.data : [];
  const pending = rows.filter((l) => l.status === "pending");
  return (
    <div className="space-y-6">
      {own && (
        <Card>
          <CardHeader>
            <CardTitle>Request leave</CardTitle>
          </CardHeader>
          <CardContent>
            <LeaveRequestForm institutionSlug={slug} />
          </CardContent>
        </Card>
      )}
      {canDecide && r.ok && (
        <section aria-labelledby="leave-queue" className="space-y-3">
          <h2 id="leave-queue" className="text-base font-semibold">
            Approval queue
          </h2>
          {pending.length === 0 ? <EmptyState title="Nothing waiting" description="No leave requests need a decision." /> : <LeaveTable slug={slug} rows={pending} ctx={ctx} canDecide />}
        </section>
      )}
      <section aria-labelledby="leave-list" className="space-y-3">
        <h2 id="leave-list" className="text-base font-semibold">
          {canDecide ? "All requests" : "My requests"}
        </h2>
        {!r.ok ? (
          <ErrorState title="Could not load leave" description="Refresh to try again." />
        ) : rows.length === 0 ? (
          <EmptyState title="No leave requests" description="Requests you make appear here." />
        ) : (
          <LeaveTable slug={slug} rows={rows} ctx={ctx} />
        )}
      </section>
    </div>
  );
}

function LeaveTable({ slug, rows, ctx, canDecide = false }: { slug: string; rows: Awaited<ReturnType<typeof leaveRequests>>; ctx: TenantContext; canDecide?: boolean }) {
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => {
              const isOwn = l.staffId === ctx.membership.staffId;
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    {l.staffName}
                    <span className="block text-xs font-normal text-muted-foreground">{l.reason}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {day(l.startDate)}
                    {l.endDate !== l.startDate && ` – ${day(l.endDate)}`} ({l.days}d)
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{humanize(l.leaveType)}</TableCell>
                  <TableCell>
                    <Badge variant={LEAVE_TONE[l.status as keyof typeof LEAVE_TONE] ?? "outline"}>{humanize(l.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    {l.status === "pending" && <LeaveRowActions institutionSlug={slug} leaveId={l.id} canDecide={canDecide && !isOwn} canCancel={isOwn} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function SubstitutionsTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  const today = todayInInstitutionTimezone(ctx);
  const r = await safe("cover", timetableCoverNeeded(ctx, today));
  if (!r.ok) return <ErrorState title="Could not load cover" description="Refresh to try again." />;
  // Free teachers per uncovered period (same rules assign_substitution enforces).
  const open = r.data.filter((c) => !c.substitution);
  const cands = await Promise.all(open.map((c) => safe("candidates", timetableSubstitutionCandidates(ctx, c.slotId, today))));
  const byslot = new Map(open.map((c, i) => [c.slotId, cands[i]]));
  const noteOn = aiTaskOn(ctx, "substitution_note");
  return (
    <section aria-labelledby="sub-h" className="space-y-3">
      <h2 id="sub-h" className="text-base font-semibold">
        Cover needed today, {day(today)}
      </h2>
      {r.data.length === 0 ? (
        <EmptyState title="No cover needed" description="No teacher is on leave or absent for a scheduled period today." />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.data.map((c) => {
                  const cand = byslot.get(c.slotId);
                  return (
                    <TableRow key={c.slotId}>
                      <TableCell>
                        {c.period.name} <span className="text-xs text-muted-foreground">{c.period.startsAt}</span>
                      </TableCell>
                      <TableCell>{c.section.name}</TableCell>
                      <TableCell>
                        {c.teacher.name} <span className="text-xs text-muted-foreground">({humanize(c.reason)})</span>
                      </TableCell>
                      <TableCell>
                        {c.substitution ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span>{c.substitution.substituteName}</span>
                              <CancelSubstitutionButton institutionSlug={slug} substitutionId={c.substitution.id} />
                            </div>
                            {noteOn && <HandoverNoteButton institutionSlug={slug} substitutionId={c.substitution.id} />}
                          </div>
                        ) : cand && !cand.ok ? (
                          <span className="text-sm text-destructive">Could not load teachers</span>
                        ) : (
                          <AssignSubstituteForm
                            institutionSlug={slug}
                            slotId={c.slotId}
                            date={today}
                            candidates={cand?.ok ? cand.data : []}
                            defaultReason={`${c.teacher.name} is ${c.reason === "leave" ? "on leave" : "absent"}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <CardDescription>Free teachers are listed least-loaded first.</CardDescription>
    </section>
  );
}
