import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { CancelEventButton, EventForm } from "@/modules/clubs/components/EventForms";
import { ClubForm } from "@/modules/clubs/components/ClubForms";
import { AssignHouseForm, AwardPointsForm, HouseCreateForm, RemoveFromHouseButton } from "@/modules/clubs/components/HouseForms";
import {
  activeStudentOptions,
  clubEventsList,
  clubMembersList,
  clubsList,
  eventSignupsList,
  housesLeaderboard,
  recentHousePoints,
  staffOptions,
} from "@/modules/clubs/queries";

export const metadata: Metadata = { title: "Clubs & houses" };

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const SECTIONS = [
  { id: "clubs", label: "Clubs" },
  { id: "events", label: "Events" },
  { id: "houses", label: "Houses" },
];

export default async function ClubsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { institution: slug } = await params;
  const { section } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "clubs");
  requirePermission(ctx, "club.read");
  const canManage = hasPermission(ctx, "club.manage");
  const active = SECTIONS.find((s) => s.id === section)?.id ?? "clubs";

  return (
    <div className="space-y-6">
      <PageHeader title="Clubs & houses" description="Clubs and their members, club events with sign-ups, and the house points race." compact />
      <SectionSwitcher basePath={`/${slug}/clubs`} sections={SECTIONS} activeId={active} />
      {active === "clubs" && <ClubsTab slug={slug} ctx={ctx} canManage={canManage} />}
      {active === "events" && <EventsTab slug={slug} ctx={ctx} canManage={canManage} />}
      {active === "houses" && <HousesTab slug={slug} ctx={ctx} canManage={canManage} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof getTenantContext>>;
type TabProps = { slug: string; ctx: Ctx; canManage: boolean };

async function ClubsTab({ slug, ctx, canManage }: TabProps) {
  const [clubsR, membersR, staffR] = await Promise.allSettled([clubsList(ctx), clubMembersList(ctx), canManage ? staffOptions(ctx) : Promise.resolve([])]);
  if (clubsR.status === "rejected") return <ErrorState title="Could not load clubs" description="Refresh to try again." />;
  const clubs = clubsR.value;
  const members = membersR.status === "fulfilled" ? membersR.value : [];
  const staff = staffR.status === "fulfilled" ? staffR.value : [];

  return (
    <div className="space-y-4">
      {clubs.length === 0 ? (
        <EmptyState title="No clubs yet" description={canManage ? "Create the first club below." : "Clubs will appear here once the school creates them."} />
      ) : (
        clubs.map((c) => {
          const list = members.filter((m) => m.clubId === c.id);
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {c.name}
                  {!c.isActive && <Badge variant="outline">Closed</Badge>}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {list.length}
                    {c.capacity ? ` / ${c.capacity}` : ""} members{c.patronName ? ` · Patron: ${c.patronName}` : ""}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2 text-sm" aria-label={`${c.name} members`}>
                    {visibleMembers(list).map((m) => (
                      <li key={m.studentId} className="rounded-md border px-2 py-1">
                        {m.name} <span className="text-muted-foreground">{m.admissionNo}</span>
                      </li>
                    ))}
                    {hiddenCount(list) > 0 && (
                      <li className="rounded-md border border-dashed px-2 py-1 text-muted-foreground">+{hiddenCount(list)} from other classes</li>
                    )}
                  </ul>
                )}
                {canManage && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Edit club</summary>
                    <div className="pt-3">
                      <ClubForm institutionSlug={slug} staff={staff} club={c} />
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>New club</CardTitle>
          </CardHeader>
          <CardContent>
            <ClubForm institutionSlug={slug} staff={staff} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function EventsTab({ slug, ctx, canManage }: TabProps) {
  const [eventsR, signupsR, clubsR] = await Promise.allSettled([clubEventsList(ctx), eventSignupsList(ctx), clubsList(ctx)]);
  if (eventsR.status === "rejected") return <ErrorState title="Could not load events" description="Refresh to try again." />;
  const signups = signupsR.status === "fulfilled" ? signupsR.value : [];
  const clubs = clubsR.status === "fulfilled" ? clubsR.value.filter((c) => c.isActive) : [];

  return (
    <div className="space-y-4">
      {eventsR.value.length === 0 ? (
        <EmptyState title="No club events yet" description={canManage ? "Create an event below." : "Events will appear here once a club schedules one."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Sign-ups</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventsR.value.map((e) => {
                  const list = signups.filter((s) => s.eventId === e.id);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        {e.title}
                        {e.venue && <span className="block text-xs font-normal text-muted-foreground">{e.venue}</span>}
                      </TableCell>
                      <TableCell>{e.clubName}</TableCell>
                      <TableCell className="whitespace-nowrap">{when.format(new Date(e.startsAt))}</TableCell>
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer tabular-nums">
                            {list.length}
                            {e.capacity ? ` / ${e.capacity}` : ""}
                          </summary>
                          <ul className="mt-1 text-xs">
                            {list.length === 0 ? <li className="text-muted-foreground">Nobody yet</li> : list.map((s) => <li key={s.studentId}>{s.name}</li>)}
                          </ul>
                        </details>
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.status === "scheduled" ? "success" : "outline"}>{humanize(e.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && e.status === "scheduled" && <CancelEventButton institutionSlug={slug} eventId={e.id} title={e.title} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>New event</CardTitle>
          </CardHeader>
          <CardContent>
            {clubs.length === 0 ? <p className="text-sm text-muted-foreground">Create an active club first.</p> : <EventForm institutionSlug={slug} clubs={clubs} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function HousesTab({ slug, ctx, canManage }: TabProps) {
  const [housesR, recentR, studentsR] = await Promise.allSettled([housesLeaderboard(ctx), recentHousePoints(ctx), canManage ? activeStudentOptions(ctx) : Promise.resolve([])]);
  if (housesR.status === "rejected") return <ErrorState title="Could not load houses" description="Refresh to try again." />;
  const houses = housesR.value;
  const recent = recentR.status === "fulfilled" ? recentR.value : [];
  const students = studentsR.status === "fulfilled" ? studentsR.value : [];
  const houseOpts = houses.map((h) => ({ id: h.id, label: h.name }));
  const memberOpts = houses.flatMap((h) => h.members.map((m) => ({ id: m.studentId, label: m.name, houseId: h.id })));
  const top = Math.max(1, ...houses.map((h) => Math.abs(h.points)));

  return (
    <div className="space-y-4">
      {houses.length === 0 ? (
        <EmptyState title="No houses yet" description={canManage ? "Add the first house below." : "Houses will appear here once the school sets them up."} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3" aria-label="House leaderboard">
                {houses.map((h, i) => (
                  <li key={h.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">
                        {i + 1}. {h.name} <span className="font-normal text-muted-foreground">({h.members.length} members)</span>
                      </span>
                      <span className="tabular-nums">{h.points} pts</span>
                    </div>
                    <div className="h-2 rounded bg-muted" role="presentation">
                      <div className="h-2 rounded" style={{ width: `${Math.max(0, (h.points / top) * 100)}%`, backgroundColor: h.colour ?? "var(--primary)" }} />
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2 *:min-w-0">
            {houses.map((h) => (
              <Card key={h.id}>
                <CardHeader>
                  <CardTitle>{h.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {h.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {visibleMembers(h.members).map((m) => (
                        <li key={m.studentId} className="flex items-center justify-between gap-2">
                          <span>
                            {m.name} <span className="text-muted-foreground">{m.admissionNo}</span>
                          </span>
                          {canManage && <RemoveFromHouseButton institutionSlug={slug} studentId={m.studentId} name={m.name} />}
                        </li>
                      ))}
                      {hiddenCount(h.members) > 0 && <li className="text-muted-foreground">+{hiddenCount(h.members)} from other classes</li>}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          {recent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent points</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {recent.map((p) => (
                    <li key={p.id}>
                      <span className="tabular-nums font-medium">{p.points > 0 ? `+${p.points}` : p.points}</span> {p.houseName}
                      {p.studentName ? ` (${p.studentName})` : ""} — {p.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2 *:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Add a house</CardTitle>
            </CardHeader>
            <CardContent>
              <HouseCreateForm institutionSlug={slug} />
            </CardContent>
          </Card>
          {houses.length > 0 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Assign or move a student</CardTitle>
                </CardHeader>
                <CardContent>
                  <AssignHouseForm institutionSlug={slug} houses={houseOpts} students={students} />
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Award points</CardTitle>
                </CardHeader>
                <CardContent>
                  <AwardPointsForm institutionSlug={slug} houses={houseOpts} members={memberOpts} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Students outside the viewer's classes come back without a name (RLS); show them as a count, not as "Student" chips.
const isHidden = (m: { admissionNo: string }) => m.admissionNo === "";
const visibleMembers = <T extends { admissionNo: string }>(list: T[]) => list.filter((m) => !isHidden(m));
const hiddenCount = (list: { admissionNo: string }[]) => list.filter(isHidden).length;
