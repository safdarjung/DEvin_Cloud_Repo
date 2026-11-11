import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { addDays, weekDays, weekStart } from "@/modules/duties/dates";
import { AssignmentAdmin, CancelSwapButton, DutyTypeForm, GenerateForm, SwapRequestForm, SwapRespondButtons } from "@/modules/duties/components/DutyForms";
import { dutyLoad, dutyRoster, dutyStaffOptions, dutySwaps, dutyTypes } from "@/modules/duties/queries";

type Section = "roster" | "generate" | "types" | "swaps" | "load";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const fmt = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
const SWAP_TONE = { pending: "outline", accepted: "success", rejected: "destructive", cancelled: "outline" } as const;

async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error(`duties page ${label} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Duty roster: every staff role reads (duty.read floor); tabs gate themselves (manage / swap).
export default async function DutiesPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ section?: string; week?: string; mine?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "duties");
  requirePermission(ctx, "duty.read");
  const canManage = hasPermission(ctx, "duty.manage");
  const canSwap = hasPermission(ctx, "duty.swap");

  const sections: { id: Section; label: string }[] = [
    { id: "roster", label: "Roster" },
    ...(canManage ? [{ id: "generate" as const, label: "Generate" }, { id: "types" as const, label: "Duty types" }] : []),
    ...(canManage || canSwap ? [{ id: "swaps" as const, label: "Swaps" }] : []),
    ...(canManage ? [{ id: "load" as const, label: "Load" }] : []),
  ];
  const active = sections.find((s) => s.id === sp.section)?.id ?? "roster";

  return (
    <div className="space-y-4">
      <PageHeader title="Duty roster" description="Who is on gate, bus, lunch and other duties, and swap requests." compact />
      <SectionSwitcher basePath={`/${slug}/duties`} sections={sections} activeId={active} />
      {active === "roster" && <RosterTab ctx={ctx} slug={slug} week={sp.week} mine={sp.mine === "1"} canManage={canManage} canSwap={canSwap} />}
      {active === "generate" && <GenerateTab ctx={ctx} slug={slug} />}
      {active === "types" && <TypesTab ctx={ctx} slug={slug} />}
      {active === "swaps" && <SwapsTab ctx={ctx} slug={slug} canSwap={canSwap} />}
      {active === "load" && <LoadTab ctx={ctx} />}
    </div>
  );
}

async function RosterTab({ ctx, slug, week, mine, canManage, canSwap }: { ctx: TenantContext; slug: string; week?: string; mine: boolean; canManage: boolean; canSwap: boolean }) {
  const today = todayInInstitutionTimezone(ctx);
  const start = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? (week as string) : today);
  const days = weekDays(start);
  const [types, roster, staff] = await Promise.all([
    safe("types", dutyTypes(ctx)),
    safe("roster", dutyRoster(ctx, days[0]!, days[6]!)),
    canManage || canSwap ? safe("staff options", dutyStaffOptions(ctx)) : Promise.resolve([]),
  ]);
  if (!types || !roster) return <ErrorState title="Could not load the roster" description="Refresh to try again." />;
  const rows = types.filter((t) => t.isActive || roster.some((r) => r.dutyTypeId === t.id));
  const mineHref = (on: boolean) => `/${slug}/duties?section=roster&week=${start}${on ? "&mine=1" : ""}`;
  const nameOf = (r: (typeof roster)[number]) => (r.isMine ? "You" : (r.staffName ?? "Colleague"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link className="underline" href={`/${slug}/duties?section=roster&week=${addDays(start, -7)}${mine ? "&mine=1" : ""}`}>Previous week</Link>
        <span className="font-medium">{fmt(days[0]!)} to {fmt(days[6]!)}</span>
        <Link className="underline" href={`/${slug}/duties?section=roster&week=${addDays(start, 7)}${mine ? "&mine=1" : ""}`}>Next week</Link>
        <span className="text-muted-foreground">|</span>
        <Link className={mine ? "text-muted-foreground underline" : "font-medium"} href={mineHref(false)}>Everyone</Link>
        <Link className={mine ? "font-medium" : "text-muted-foreground underline"} href={mineHref(true)}>My duties</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No duty types yet" description={canManage ? "Add duty types on the Duty types tab." : "Duty types have not been set up."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Duty</TableHead>
                  {days.map((d) => (
                    <TableHead key={d}>{fmt(d)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}{!t.isActive && <span className="block text-xs font-normal text-muted-foreground">Inactive</span>}</TableCell>
                    {days.map((d) => {
                      const cell = roster.filter((r) => r.dutyTypeId === t.id && r.date === d && (!mine || r.isMine));
                      return (
                        <TableCell key={d} className="align-top">
                          <ul className="space-y-1">
                            {cell.map((r) => (
                              <li key={r.id} className="text-sm">
                                <span className={r.isMine ? "font-semibold" : undefined}>{nameOf(r)}</span>
                                {r.status === "swapped" && <span className="ml-1 text-xs text-muted-foreground">(swapped)</span>}
                                {d >= today && canManage && <AssignmentAdmin slug={slug} assignmentId={r.id} staff={staff ?? []} />}
                                {d > today && canSwap && r.isMine && <SwapRequestForm slug={slug} assignmentId={r.id} staff={staff ?? []} />}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function GenerateTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  const types = await safe("types", dutyTypes(ctx));
  if (!types) return <ErrorState title="Could not load duty types" description="Refresh to try again." />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate roster</CardTitle>
      </CardHeader>
      <CardContent>
        <GenerateForm slug={slug} today={todayInInstitutionTimezone(ctx)} activeTypes={types.filter((t) => t.isActive).length} />
      </CardContent>
    </Card>
  );
}

async function TypesTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  const types = await safe("types", dutyTypes(ctx));
  if (!types) return <ErrorState title="Could not load duty types" description="Refresh to try again." />;
  return (
    <section aria-label="Duty types" className="space-y-4">
      {types.length === 0 ? (
        <EmptyState title="No duty types yet" description="Add the first one below." />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {types.map((t) => (
              <DutyTypeForm key={t.id} slug={slug} type={t} />
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>New duty type</CardTitle>
        </CardHeader>
        <CardContent>
          <DutyTypeForm slug={slug} />
        </CardContent>
      </Card>
    </section>
  );
}

async function SwapsTab({ ctx, slug, canSwap }: { ctx: TenantContext; slug: string; canSwap: boolean }) {
  const swaps = await safe("swaps", dutySwaps(ctx));
  if (!swaps) return <ErrorState title="Could not load swap requests" description="Refresh to try again." />;
  if (swaps.length === 0) return <EmptyState title="No swap requests" description={canSwap ? "Request a swap from your own future duty on the Roster tab." : "Nobody has asked for a swap."} />;
  const who = (name: string | null, mine: boolean) => (mine ? "You" : (name ?? "Colleague"));
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Duty</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {swaps.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.dutyTypeName ?? "Duty"}</TableCell>
                <TableCell>{s.date ? fmt(s.date) : ""}</TableCell>
                <TableCell>{who(s.fromName, s.isOutgoing)}</TableCell>
                <TableCell>{who(s.toName, s.isIncoming)}</TableCell>
                <TableCell><Badge variant={SWAP_TONE[s.status as keyof typeof SWAP_TONE] ?? "outline"}>{humanize(s.status)}</Badge></TableCell>
                <TableCell>
                  {canSwap && s.status === "pending" && s.isIncoming && <SwapRespondButtons slug={slug} requestId={s.id} />}
                  {canSwap && s.status === "pending" && s.isOutgoing && <CancelSwapButton slug={slug} requestId={s.id} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function LoadTab({ ctx }: { ctx: TenantContext }) {
  const load = await safe("load", dutyLoad(ctx, todayInInstitutionTimezone(ctx)));
  if (!load) return <ErrorState title="Could not load duty counts" description="Refresh to try again." />;
  if (load.length === 0) return <EmptyState title="No duties in the last 60 days" description="Generate a roster to see how duties are shared." />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Duties per staff, last 60 days</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              <TableHead className="text-right">Duties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {load.map((r) => (
              <TableRow key={r.staffId}>
                <TableCell>{r.name ?? "Staff member"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
