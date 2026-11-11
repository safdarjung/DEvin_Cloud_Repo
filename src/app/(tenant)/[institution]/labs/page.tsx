import type { Metadata } from "next";
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
import { humanize, inr } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { SafetyCheck } from "@/modules/school-labs/components/safety-check";
import { aiTaskOn } from "@/modules/ai/task-route";
import {
  BookingForm,
  CancelBookingButton,
  CompleteExperimentButton,
  EquipmentForm,
  ExperimentForm,
  IncidentForm,
  LabForm,
} from "@/modules/school-labs/components/labs-forms";
import {
  addDays,
  schoolLabBookingOptions,
  schoolLabEquipment,
  schoolLabExperiments,
  schoolLabIncidents,
  schoolLabPeriods,
  schoolLabPickerOptions,
  schoolLabUtilisation,
  schoolLabWeek,
  schoolLabs,
  weekStartOf,
  type LabRow,
} from "@/modules/school-labs/queries";
import { HAZARD_CLASSES } from "@/modules/school-labs/schemas";
import { LOW_QUANTITY_THRESHOLD, daysUntil, expiryText, labSafetyWarnings } from "@/modules/school-labs/safety";

export const metadata: Metadata = { title: "Labs" };

const SECTIONS = [
  { id: "schedule", label: "Schedule" },
  { id: "labs", label: "Labs" },
  { id: "equipment", label: "Equipment" },
  { id: "experiments", label: "Experiments" },
  { id: "incidents", label: "Incidents" },
  { id: "utilisation", label: "Utilisation" },
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_UTILISATION_DAYS = 30;

type SP = { section?: string; lab?: string; week?: string; date?: string; period?: string; filter?: string; booking?: string; from?: string; to?: string };
const iso = (v: string | undefined) => (v && ISO_DATE.test(v) ? v : undefined);

function logFail(what: string, e: unknown): null {
  console.error(`labs ${what} failed:`, e instanceof Error ? e.message : e);
  return null;
}

// School labs: real module, no simulation. Teachers book/cancel/log only their own rows (database-enforced).
export default async function LabsPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<SP> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "school_labs");
  requirePermission(ctx, "lab.read");
  const active = SECTIONS.find((s) => s.id === sp.section)?.id ?? "schedule";
  const labs = await schoolLabs(ctx).catch((e) => logFail("labs", e));
  return (
    <div className="space-y-4">
      <PageHeader title="Labs" description="Lab bookings, equipment, experiments and incidents." compact />
      <SectionSwitcher basePath={`/${slug}/labs`} sections={SECTIONS} activeId={active} />
      {labs === null ? (
        <ErrorState title="Could not load labs" description="Refresh to try again." />
      ) : active === "labs" ? (
        <LabsTab ctx={ctx} slug={slug} labs={labs} />
      ) : labs.length === 0 ? (
        <EmptyState title="No labs yet" description={hasPermission(ctx, "lab.manage") ? "Add a lab on the Labs tab." : "Ask a manager to add a lab."} />
      ) : active === "equipment" ? (
        <EquipmentTab ctx={ctx} slug={slug} labs={labs} sp={sp} />
      ) : active === "experiments" ? (
        <ExperimentsTab ctx={ctx} slug={slug} labs={labs} sp={sp} />
      ) : active === "incidents" ? (
        <IncidentsTab ctx={ctx} slug={slug} labs={labs} />
      ) : active === "utilisation" ? (
        <UtilisationTab ctx={ctx} labs={labs} sp={sp} />
      ) : (
        <ScheduleTab ctx={ctx} slug={slug} labs={labs} sp={sp} />
      )}
    </div>
  );
}

function LabPicker({ section, labs, labId, extra }: { section: string; labs: LabRow[]; labId: string; extra?: Record<string, string> }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="section" value={section} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="text-sm">
        Lab
        <select name="lab" defaultValue={labId} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm">
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="h-10 rounded-md border px-3 text-sm">
        Open
      </button>
    </form>
  );
}

function LabsTab({ ctx, slug, labs }: { ctx: TenantContext; slug: string; labs: LabRow[] }) {
  const canManage = hasPermission(ctx, "lab.manage");
  return (
    <div className="space-y-4">
      {labs.length === 0 ? (
        <EmptyState title="No labs yet" description={canManage ? "Add the first lab below." : "Ask a manager to add a lab."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lab</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead>Edit</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {labs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>{humanize(l.kind)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.capacity}</TableCell>
                    <TableCell>
                      <Badge variant={l.isActive ? "success" : "outline"}>{l.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <LabForm institutionSlug={slug} lab={l} />
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
            <CardTitle>New lab</CardTitle>
          </CardHeader>
          <CardContent>
            <LabForm institutionSlug={slug} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function ScheduleTab({ ctx, slug, labs, sp }: { ctx: TenantContext; slug: string; labs: LabRow[]; sp: SP }) {
  const today = todayInInstitutionTimezone(ctx);
  const lab = labs.find((l) => l.id === sp.lab) ?? labs.find((l) => l.isActive) ?? labs[0]!;
  const weekStart = weekStartOf(iso(sp.week) ?? today);
  const isManager = hasPermission(ctx, "lab.manage");
  const canBook = hasPermission(ctx, "lab.book");
  const [bookings, periods, options, equipment] = await Promise.all([
    schoolLabWeek(ctx, lab.id, weekStart).catch((e) => logFail("week", e)),
    schoolLabPeriods(ctx).catch((e) => logFail("periods", e)),
    canBook ? schoolLabPickerOptions(ctx).catch((e) => logFail("options", e)) : Promise.resolve(null),
    schoolLabEquipment(ctx, lab.id).catch((e) => logFail("equipment", e)),
  ]);
  if (!bookings || !periods) return <ErrorState title="Could not load the schedule" description="Refresh to try again." />;
  const days = DAY_LABELS.map((label, i) => ({ label, date: addDays(weekStart, i) }));
  const cell = (date: string, periodId: string) => bookings.find((b) => b.date === date && b.periodId === periodId);
  const base = `/${slug}/labs?section=schedule&lab=${lab.id}`;
  const date = iso(sp.date) && iso(sp.date)! >= today ? iso(sp.date)! : today;
  return (
    <div className="space-y-4">
      <LabPicker section="schedule" labs={labs} labId={lab.id} extra={{ week: weekStart }} />
      <div className="flex items-center gap-3 text-sm">
        <Link href={`${base}&week=${addDays(weekStart, -7)}`} className="underline">
          Previous week
        </Link>
        <span className="font-medium">
          Week of {weekStart} · {lab.name}
        </span>
        <Link href={`${base}&week=${addDays(weekStart, 7)}`} className="underline">
          Next week
        </Link>
      </div>
      {periods.length === 0 ? (
        <EmptyState title="No periods set up" description="Publish the bell schedule in the timetable first." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  {days.map((d) => (
                    <TableHead key={d.date}>
                      {d.label} {d.date.slice(5)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {p.name} <span className="text-muted-foreground">{p.startsAt}</span>
                    </TableCell>
                    {days.map((d) => {
                      const b = cell(d.date, p.id);
                      const mine = b !== undefined && b.staffId === ctx.membership.staffId;
                      return (
                        <TableCell key={d.date} className="min-w-32 align-top text-xs">
                          {b ? (
                            <div className="space-y-1">
                              <p className="font-medium">
                                {b.section} · {b.subject}
                              </p>
                              <p className="text-muted-foreground">{b.teacher}</p>
                              {canBook && (isManager || mine) && d.date >= today && <CancelBookingButton institutionSlug={slug} bookingId={b.id} />}
                            </div>
                          ) : canBook && lab.isActive && d.date >= today ? (
                            <Link href={`${base}&week=${weekStart}&date=${d.date}&period=${p.id}`} className="underline">
                              Free · book
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">Free</span>
                          )}
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
      {canBook && lab.isActive && options && periods.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Book {lab.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <BookingForm
              key={`${date}-${sp.period ?? ""}-${lab.id}`}
              institutionSlug={slug}
              labId={lab.id}
              options={options}
              periods={periods}
              isManager={isManager}
              defaultDate={date}
              defaultPeriodId={sp.period}
              minDate={today}
              safety={<SafetyCheck labName={lab.name} warnings={labSafetyWarnings(equipment ?? [], today)} ai={aiTaskOn(ctx, "lab_safety_note") ? { institutionSlug: slug, labId: lab.id } : undefined} />}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function EquipmentTab({ ctx, slug, labs, sp }: { ctx: TenantContext; slug: string; labs: LabRow[]; sp: SP }) {
  const today = todayInInstitutionTimezone(ctx);
  const canManage = hasPermission(ctx, "lab.manage");
  const labId = labs.find((l) => l.id === sp.lab)?.id;
  const filter = ["low", "expired", "hazard"].find((f) => f === sp.filter);
  const all = await schoolLabEquipment(ctx, labId).catch((e) => logFail("equipment", e));
  if (!all) return <ErrorState title="Could not load equipment" description="Refresh to try again." />;
  const rows = all.filter((e) => (filter === "low" ? e.quantity <= LOW_QUANTITY_THRESHOLD : filter === "expired" ? e.expiryOn !== null && daysUntil(e.expiryOn, today) < 0 : filter === "hazard" ? e.hazardClass !== null : true));
  const labName = new Map(labs.map((l) => [l.id, l.name]));
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="section" value="equipment" />
        <label className="text-sm">
          Lab
          <select name="lab" defaultValue={labId ?? ""} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">All labs</option>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Show
          <select name="filter" defaultValue={filter ?? ""} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">Everything</option>
            <option value="low">Low quantity (up to {LOW_QUANTITY_THRESHOLD})</option>
            <option value="expired">Expired</option>
            <option value="hazard">Hazard-classed</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-md border px-3 text-sm">
          Apply
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No equipment matches" description={canManage ? "Change the filter or add equipment below." : "Change the filter."} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Hazard</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Condition</TableHead>
                  {canManage && <TableHead>Edit</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.name} <span className="text-muted-foreground">({humanize(e.kind)})</span>
                    </TableCell>
                    <TableCell>{labName.get(e.labId) ?? "Lab"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.quantity} {e.unit}
                    </TableCell>
                    <TableCell>{e.hazardClass ? <Badge variant="destructive">{humanize(e.hazardClass)}</Badge> : "None"}</TableCell>
                    <TableCell>{e.expiryOn ? `${expiryText(e.expiryOn, today)} (${e.expiryOn})` : "No expiry"}</TableCell>
                    <TableCell>{humanize(e.condition)}</TableCell>
                    {canManage && (
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer text-sm underline">Edit</summary>
                          <div className="pt-2">
                            <EquipmentForm institutionSlug={slug} labs={labs} item={e} />
                          </div>
                        </details>
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
            <CardTitle>Register equipment</CardTitle>
          </CardHeader>
          <CardContent>
            <EquipmentForm institutionSlug={slug} labs={labs} defaultLabId={labId} />
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Hazard classes: {HAZARD_CLASSES.map(humanize).join(", ")}.</p>
    </div>
  );
}

async function ExperimentsTab({ ctx, slug, labs, sp }: { ctx: TenantContext; slug: string; labs: LabRow[]; sp: SP }) {
  const today = todayInInstitutionTimezone(ctx);
  const isManager = hasPermission(ctx, "lab.manage");
  const [experiments, options] = await Promise.all([schoolLabExperiments(ctx).catch((e) => logFail("experiments", e)), schoolLabBookingOptions(ctx).catch((e) => logFail("bookings", e))]);
  if (!experiments || !options) return <ErrorState title="Could not load experiments" description="Refresh to try again." />;
  const chosen = options.find((o) => o.id === sp.booking);
  const chosenLab = chosen ? labs.find((l) => l.id === chosen.labId) : undefined;
  const equipment = chosenLab ? await schoolLabEquipment(ctx, chosenLab.id).catch((e) => logFail("equipment", e)) : null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Log an experiment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="section" value="experiments" />
            <label className="text-sm">
              Booking
              <select name="booking" defaultValue={chosen?.id ?? ""} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Choose a booking</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-md border px-3 text-sm">
              Open
            </button>
          </form>
          {chosen && chosenLab && (
            <>
              <SafetyCheck labName={chosenLab.name} warnings={labSafetyWarnings(equipment ?? [], today)} ai={aiTaskOn(ctx, "lab_safety_note") ? { institutionSlug: slug, labId: chosenLab.id } : undefined} />
              <ExperimentForm institutionSlug={slug} bookingId={chosen.id} />
            </>
          )}
        </CardContent>
      </Card>
      {experiments.length === 0 ? (
        <EmptyState title="No experiments logged" description="Pick a booking above and log what the class did." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Experiment</TableHead>
                  <TableHead>Lab and class</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiments.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell>
                      <p className="font-medium">{x.title}</p>
                      {x.notes && <p className="text-xs text-muted-foreground">{x.notes}</p>}
                    </TableCell>
                    <TableCell>
                      {x.lab} · {x.section} {x.subject}
                    </TableCell>
                    <TableCell>{x.date}</TableCell>
                    <TableCell>
                      <Badge variant={x.completed ? "success" : "outline"}>{x.completed ? "Completed" : "In progress"}</Badge>
                    </TableCell>
                    <TableCell>{(isManager || x.bookingStaffId === ctx.membership.staffId) && <CompleteExperimentButton institutionSlug={slug} id={x.id} completed={x.completed} />}</TableCell>
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

async function IncidentsTab({ ctx, slug, labs }: { ctx: TenantContext; slug: string; labs: LabRow[] }) {
  const [incidents, bookings] = await Promise.all([schoolLabIncidents(ctx).catch((e) => logFail("incidents", e)), schoolLabBookingOptions(ctx).catch((e) => logFail("bookings", e))]);
  if (!incidents || !bookings) return <ErrorState title="Could not load incidents" description="Refresh to try again." />;
  const isManager = hasPermission(ctx, "lab.manage");
  return (
    <div className="space-y-4">
      {hasPermission(ctx, "lab.book") && (
        <Card>
          <CardHeader>
            <CardTitle>Record an incident</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentForm institutionSlug={slug} labs={labs} bookings={bookings} isManager={isManager} />
            <p className="mt-2 text-xs text-muted-foreground">Incidents cannot be edited or deleted once recorded.</p>
          </CardContent>
        </Card>
      )}
      {incidents.length === 0 ? (
        <EmptyState title="No incidents" description="Breakages and safety events will appear here." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-nowrap">{new Date(i.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</TableCell>
                    <TableCell>{i.lab}</TableCell>
                    <TableCell>{humanize(i.kind)}</TableCell>
                    <TableCell>
                      <Badge variant={i.severity === "high" ? "destructive" : "outline"}>{humanize(i.severity)}</Badge>
                    </TableCell>
                    <TableCell>{i.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.costPaise === null ? "—" : inr(i.costPaise / 100)}</TableCell>
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

async function UtilisationTab({ ctx, labs, sp }: { ctx: TenantContext; labs: LabRow[]; sp: SP }) {
  const today = todayInInstitutionTimezone(ctx);
  const to = iso(sp.to) ?? today;
  const from = iso(sp.from) ?? addDays(to, -DEFAULT_UTILISATION_DAYS);
  const rows = to >= from ? await schoolLabUtilisation(ctx, { from, to }).catch((e) => logFail("utilisation", e)) : [];
  const labName = new Map(labs.map((l) => [l.id, l.name]));
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="section" value="utilisation" />
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm" />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={to} className="ml-2 h-10 rounded-md border border-input bg-transparent px-3 text-sm" />
        </label>
        <button type="submit" className="h-10 rounded-md border px-3 text-sm">
          Show
        </button>
      </form>
      {to < from ? (
        <ErrorState title="Check the dates" description="The end date must be on or after the start date." />
      ) : rows === null ? (
        <ErrorState title="Could not load utilisation" description="Use a range of at most 366 days, or refresh." />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lab</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Different periods used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.labId}>
                    <TableCell className="font-medium">{labName.get(r.labId) ?? "Lab"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.bookings}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.periodsUsed}</TableCell>
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
