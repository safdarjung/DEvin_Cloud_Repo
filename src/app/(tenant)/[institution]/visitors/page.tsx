import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { humanize, type BadgeVariant } from "@/lib/format";
import { staffOptions } from "@/modules/clubs/queries";
import { CheckInForm, CheckOutButton } from "@/modules/visitors/components/VisitorLog";
import { GatePassActions, GatePassForm } from "@/modules/visitors/components/GatePasses";
import { PickupAddForm, RemovePickupButton } from "@/modules/visitors/components/PickupPersons";
import { StudentPicker } from "@/modules/visitors/components/StudentPicker";
import { visitorsGatePasses, visitorsList, visitorsPickupList, visitorsStudentLabel } from "@/modules/visitors/queries";

export const metadata: Metadata = { title: "Visitors" };

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const GATE_BADGE: Record<string, BadgeVariant> = { pending: "warning", approved: "success", rejected: "destructive", cancelled: "outline", exited: "secondary" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function logError(label: string, r: PromiseSettledResult<unknown>) {
  if (r.status === "rejected") console.error(`visitors page ${label} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
}

// Visitor log needs `visitor.manage`; gate passes `gatepass.manage` (a teacher holds only this);
// authorized pickup `pickup.manage` + `student.read`. Each tab renders only for its holder.
export default async function VisitorsPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ tab?: string; student?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "visitors");
  const canLog = hasPermission(ctx, "visitor.manage");
  const canPass = hasPermission(ctx, "gatepass.manage");
  const canPickup = hasPermission(ctx, "pickup.manage") && hasPermission(ctx, "student.read");
  if (!canLog && !canPass) throw new AppError("forbidden", "You do not have access to visitors and gate passes.");

  const tabs = [canLog && "log", canPass && "gatepass", canPickup && "pickup"].filter((t): t is "log" | "gatepass" | "pickup" => Boolean(t));
  const tab = tabs.find((t) => t === sp.tab) ?? tabs[0];

  const [visitorsR, staffR, passesR] = await Promise.allSettled([
    canLog ? visitorsList(ctx, { date: todayIst() }) : Promise.resolve([]),
    canLog ? staffOptions(ctx) : Promise.resolve([]),
    canPass ? visitorsGatePasses(ctx, {}) : Promise.resolve([]),
  ]);
  [["visitors", visitorsR], ["staff", staffR], ["gate passes", passesR]].forEach(([l, r]) => logError(l as string, r as PromiseSettledResult<unknown>));
  const rawStudentId = sp.student && UUID_RE.test(sp.student) ? sp.student : undefined;
  const studentName = rawStudentId && (tab === "gatepass" || tab === "pickup") ? await visitorsStudentLabel(ctx, rawStudentId).catch(() => undefined) : undefined;
  const studentId = studentName ? rawStudentId : undefined;
  const selectedStudent = studentId && studentName ? { id: studentId, label: studentName } : undefined;
  const collectorsR = studentId && (tab === "gatepass" || tab === "pickup") ? await Promise.allSettled([visitorsPickupList(ctx, studentId)]).then(([r]) => r) : undefined;
  if (collectorsR) logError("collectors", collectorsR);
  const collectors = collectorsR?.status === "fulfilled" ? collectorsR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Visitors and gate passes" description="Front-desk visitor log, early-leave gate passes and authorized pickup people." />
      <Tabs defaultValue={tab}>
        <TabsList>
          {canLog && <TabsTrigger value="log">Visitor log</TabsTrigger>}
          {canPass && <TabsTrigger value="gatepass">Gate passes</TabsTrigger>}
          {canPickup && <TabsTrigger value="pickup">Authorized pickup</TabsTrigger>}
        </TabsList>

        {canLog && (
          <TabsContent value="log" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Check in a visitor</CardTitle>
              </CardHeader>
              <CardContent>
                <CheckInForm institutionSlug={slug} staff={staffR.status === "fulfilled" ? staffR.value : []} />
              </CardContent>
            </Card>
            <h2 className="text-base font-semibold">Today</h2>
            {visitorsR.status === "rejected" ? (
              <ErrorState title="Could not load visitors" description="Refresh to try again." />
            ) : visitorsR.value.length === 0 ? (
              <EmptyState title="No visitors today" description="Checked-in visitors appear here." />
            ) : (
              <Card>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Visitor</TableHead>
                        <TableHead className="hidden sm:table-cell">Purpose</TableHead>
                        <TableHead>Meeting</TableHead>
                        <TableHead>In</TableHead>
                        <TableHead>Out</TableHead>
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visitorsR.value.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium">
                            {v.fullName}
                            <span className="block text-xs font-normal text-muted-foreground">{v.phone}</span>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{v.purpose}</TableCell>
                          <TableCell>{v.meetingWith}</TableCell>
                          <TableCell className="tabular-nums">{timeFmt.format(new Date(v.checkedInAt))}</TableCell>
                          <TableCell className="tabular-nums">{v.checkedOutAt ? timeFmt.format(new Date(v.checkedOutAt)) : <Badge variant="success">On site</Badge>}</TableCell>
                          <TableCell className="text-right">{!v.checkedOutAt && <CheckOutButton institutionSlug={slug} id={v.id} name={v.fullName} />}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {canPass && (
          <TabsContent value="gatepass" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Request a gate pass</CardTitle>
                <CardDescription>Choose the student first, then who will collect them.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StudentPicker tab="gatepass" selected={selectedStudent} institutionSlug={slug} id="gp-student" />
                {studentId && (
                  <GatePassForm
                    institutionSlug={slug}
                    studentId={studentId}
                    collectors={collectors.map((c) => ({ kind: c.kind, id: c.id, label: `${c.fullName} (${c.relation}) ${c.phoneMasked}` }))}
                  />
                )}
              </CardContent>
            </Card>
            <h2 className="text-base font-semibold">Gate passes</h2>
            {passesR.status === "rejected" ? (
              <ErrorState title="Could not load gate passes" description="Refresh to try again." />
            ) : passesR.value.length === 0 ? (
              <EmptyState title="No gate passes yet" description="Requested passes appear here for approval and collection." />
            ) : (
              <Card>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead className="hidden sm:table-cell">Reason</TableHead>
                        <TableHead>Collector</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden sm:table-cell">Requested</TableHead>
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {passesR.value.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {p.studentName}
                            {p.class && <span className="block text-xs font-normal text-muted-foreground">{p.class}</span>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{p.reason}</TableCell>
                          <TableCell>
                            {p.collectorName}
                            <span className="block text-xs text-muted-foreground">{p.collectorRelation}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={GATE_BADGE[p.status] ?? "outline"}>{humanize(p.status)}</Badge>
                          </TableCell>
                          <TableCell className="hidden tabular-nums sm:table-cell">{timeFmt.format(new Date(p.requestedAt))}</TableCell>
                          <TableCell>
                            <GatePassActions institutionSlug={slug} id={p.id} status={p.status} student={p.studentName} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {canPickup && (
          <TabsContent value="pickup" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Authorized pickup</CardTitle>
                <CardDescription>Guardians and extra people allowed to collect a student. Phone numbers are masked.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StudentPicker tab="pickup" selected={selectedStudent} institutionSlug={slug} id="pk-student" />
                {!studentId ? (
                  <EmptyState bare title="Choose a student" description="Their guardians and pickup people appear here." />
                ) : collectorsR?.status === "rejected" ? (
                  <ErrorState bare title="Could not load pickup list" description="Refresh to try again." />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{studentName}</TableHead>
                          <TableHead>Relation</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {collectors.map((c) => (
                          <TableRow key={`${c.kind}:${c.id}`}>
                            <TableCell className="font-medium">{c.fullName}</TableCell>
                            <TableCell>{c.relation}</TableCell>
                            <TableCell className="tabular-nums">{c.phoneMasked}</TableCell>
                            <TableCell>
                              <Badge variant={c.kind === "guardian" ? "secondary" : "outline"}>{c.kind === "guardian" ? "Guardian" : "Pickup person"}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{c.kind === "pickup" && <RemovePickupButton institutionSlug={slug} id={c.id} name={c.fullName} />}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {collectors.length === 0 && <p className="text-sm text-muted-foreground">No guardian or pickup person on file for this student.</p>}
                    <PickupAddForm institutionSlug={slug} studentId={studentId} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
