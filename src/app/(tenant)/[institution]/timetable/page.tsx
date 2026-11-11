import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { BarList } from "@/components/widgets/viz";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { listSectionOptions } from "@/modules/exams/queries";
import { buildTimetableGrid, subjectPeriodRows, WEEKDAY_NAMES } from "@/modules/timetable/grid";
import { defaultPublishedVersionId, loadRules, timetableForSection, type SectionTimetableSlot } from "@/modules/timetable/queries";
import {
  editOptions,
  gridPeriods,
  latestCellChanges,
  timetableChanges,
  timetableCompare,
  timetableDay,
  timetableSnapshots,
  timetableVersions,
  undoneChangeIds,
  type ChangeRow,
} from "@/modules/timetable/control.queries";
import { suggestTimetableFill, timetableViolations } from "@/modules/timetable/suggest.queries";
import { CHANGE_KINDS } from "@/modules/timetable/schemas";
import { ChangeWhy } from "@/modules/timetable/components/change-why";
import { ChangesPanel } from "@/modules/timetable/components/changes-panel";
import { CellEditForm } from "@/modules/timetable/components/control-forms";
import { DayViewPanel } from "@/modules/timetable/components/day-view";
import { PlanPanel } from "@/modules/timetable/components/plan-panel";
import { RulesForm } from "@/modules/timetable/components/rules-form";
import { TimetableBookLink } from "@/modules/textbooks/components/BookLinks";
import { textbooksForSection, type BookView } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Timetable" };

type Tab = "week" | "day" | "changes" | "plan" | "rules";
type Search = Partial<Record<"section" | "tab" | "version" | "edit" | "date" | "teacher" | "cs" | "kind" | "from" | "to" | "compare" | "n", string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const uuidOr = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);
const dateOr = (v: string | undefined) => (v && DATE.test(v) ? v : undefined);

/** Loads a tab's data; null (logged) on failure so the tab shows an error state instead of crashing the page. */
async function safeLoad<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error(`timetable ${what} load failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function timeZoneOf(ctx: TenantContext): string {
  const tz = (ctx.institution.settings.locale as { timezone?: unknown } | undefined)?.timezone;
  return typeof tz === "string" ? tz : "Asia/Kolkata";
}

// Weekly timetable + 0141 control. Authorization: `timetable.read` for the
// week/day/changes tabs (RLS narrows guardian/student to their own section);
// plan/rules and every write need `timetable.manage`, re-checked by each action.
export default async function TimetablePage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<Search> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "timetable");
  requirePermission(ctx, "timetable.read");
  const canManage = hasPermission(ctx, "timetable.manage");
  const timeZone = timeZoneOf(ctx);

  const tabs: { id: Tab; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "day", label: "Day" },
    { id: "changes", label: "Changes" },
    ...(canManage ? [{ id: "plan" as const, label: "Plan & publish" }, { id: "rules" as const, label: "Rules" }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "week";

  const sections = await listSectionOptions(ctx);
  const selected = sections.find((s) => s.id === sp.section) ?? sections[0];
  const base = `/${slug}/timetable`;
  // A teacher's Day tab opens on their own day; picking a section switches to it.
  const ownDay = (t: Tab) => t === "day" && ctx.membership.role === "teacher";
  const href = (t: Tab) => `${base}?tab=${t}${selected && !ownDay(t) ? `&section=${selected.id}` : ""}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Timetable" description={selected ? `Timetable for ${selected.label}` : undefined} />
      <nav aria-label="Timetable views" className="flex flex-wrap gap-1 border-b-2 border-border">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={href(t.id)}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "-mb-0.5 inline-flex min-h-11 items-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10",
              t.id === tab ? "border-ring font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {sections.length === 0 ? (
        <EmptyState title="No class sections yet" description="Create grades and sections in academics, then publish a timetable version." />
      ) : tab === "week" ? (
        <WeekTab ctx={ctx} slug={slug} sp={sp} sections={sections} selected={selected!} canManage={canManage} timeZone={timeZone} />
      ) : tab === "day" ? (
        <DayTab ctx={ctx} slug={slug} sp={sp} sections={sections} selected={selected!} canManage={canManage} timeZone={timeZone} />
      ) : tab === "changes" ? (
        <ChangesTab ctx={ctx} slug={slug} sp={sp} sections={sections} canManage={canManage} timeZone={timeZone} />
      ) : tab === "plan" ? (
        <PlanTab ctx={ctx} slug={slug} sp={sp} sectionId={selected!.id} timeZone={timeZone} />
      ) : (
        <RulesTab ctx={ctx} slug={slug} />
      )}
    </div>
  );
}

interface TabProps {
  ctx: TenantContext;
  slug: string;
  sp: Search;
  sections: { id: string; label: string }[];
  selected: { id: string; label: string };
  canManage: boolean;
  timeZone: string;
}

function SectionPicker({ sections, selected, tab, extra }: { sections: TabProps["sections"]; selected: TabProps["selected"]; tab: Tab; extra?: React.ReactNode }) {
  return (
    <form method="get" className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
      <input type="hidden" name="tab" value={tab} />
      <label htmlFor="section" className="grid min-w-0 gap-1 text-sm text-muted-foreground">
        Section
        <select id="section" name="section" defaultValue={selected.id} className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:w-auto">
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {extra}
      <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9">
        View
      </Button>
    </form>
  );
}

async function WeekTab({ ctx, slug, sp, sections, selected, canManage, timeZone }: TabProps) {
  const loaded = await safeLoad("week", async () => {
    const [versions, periods, published] = await Promise.all([
      canManage ? timetableVersions(ctx) : Promise.resolve([]),
      gridPeriods(ctx),
      defaultPublishedVersionId(ctx),
    ]);
    const asked = uuidOr(sp.version);
    const versionId = canManage && asked && versions.some((v) => v.id === asked) ? asked : published;
    if (!versionId) return { versions, periods, versionId, slots: [] as SectionTimetableSlot[], books: {} as Record<string, BookView[]>, changes: new Map<string, ChangeRow>() };
    const [slots, { bySubject: books }, changes] = await Promise.all([
      timetableForSection(ctx, selected.id, versionId),
      textbooksForSection(ctx, selected.id),
      latestCellChanges(ctx, versionId, selected.id),
    ]);
    return { versions, periods, versionId, slots, books, changes };
  });
  if (!loaded) return <ErrorState title="Could not load the timetable" description="Refresh to try again." />;
  const { versions, periods, versionId, slots, books, changes } = loaded;

  const version = versions.find((v) => v.id === versionId);
  const teaching = periods.filter((p) => !p.isBreak);
  const grid = buildTimetableGrid(slots, canManage ? teaching : []);
  const periodIdBySeq = new Map(periods.map((p) => [p.seq, p.id]));

  const [editDay, editPeriod] = (sp.edit ?? "").split(":");
  const editing = canManage && versionId && version?.status !== "archived" && uuidOr(editPeriod) && Number(editDay) >= 1 && Number(editDay) <= 6;
  const editCell = editing ? slots.find((s) => s.weekday === Number(editDay) && periodIdBySeq.get(s.period.seq) === editPeriod) : undefined;
  const options = editing ? await editOptions(ctx) : null;
  const editHref = (weekday: number, seq: number) =>
    `/${slug}/timetable?tab=week&section=${selected.id}${versionId && canManage ? `&version=${versionId}` : ""}&edit=${weekday}:${periodIdBySeq.get(seq)}`;

  const versionPicker = canManage && versions.length > 0 && (
    <label className="grid gap-1 text-sm text-muted-foreground">
      Version
      <select name="version" defaultValue={versionId ?? ""} className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground sm:h-9 sm:w-auto">
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.status})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <SectionPicker sections={sections} selected={selected} tab="week" extra={versionPicker} />
      {editing && options && (
        <Card>
          <CardContent className="pt-4">
            <CellEditForm
              slug={slug}
              versionId={versionId!}
              cell={{ classSectionId: selected.id, weekday: Number(editDay), periodId: editPeriod }}
              label={`${selected.label} · ${WEEKDAY_NAMES[Number(editDay)]} · ${periods.find((p) => p.id === editPeriod)?.name ?? ""}`}
              current={editCell ? { subjectId: editCell.subject?.id ?? "", teacherId: editCell.teacher.id, roomId: editCell.room?.id ?? null } : null}
              subjects={options.subjects}
              teachers={options.teachers}
              rooms={options.rooms}
              published={version?.status === "published"}
            />
          </CardContent>
        </Card>
      )}
      {grid.rows.length === 0 ? (
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
                        const change = changes.get(`${selected.id}|${d}|${periodIdBySeq.get(row.seq)}`);
                        return (
                          <td key={d} className={cn("px-2 py-2 align-top", change && "bg-info/5")}>
                            {cell ? (
                              <>
                                <span className="block font-medium">{cell.subject?.name ?? "Period"}</span>
                                <span className="block text-xs text-muted-foreground">{[cell.teacher.name, cell.room?.name].filter(Boolean).join(" · ")}</span>
                                {cell.subject && <TimetableBookLink books={books[cell.subject.id]} subjectName={cell.subject.name} />}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {change && <ChangeWhy change={change} slug={slug} timeZone={timeZone} canUndo={canManage} />}
                            {canManage && version?.status !== "archived" && (
                              <Link href={editHref(d, row.seq)} className="mt-1 inline-flex min-h-6 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                                Edit<span className="sr-only"> {WEEKDAY_NAMES[d]} {row.name}</span>
                              </Link>
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
              <BarList ariaLabel="Periods per week by subject" items={subjectPeriodRows(slots)} />
            </CardContent>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}

async function DayTab({ ctx, slug, sp, sections, selected, canManage, timeZone }: TabProps) {
  const date = dateOr(sp.date);
  const teacherId = uuidOr(sp.teacher);
  const ownTeacher = ctx.membership.role === "teacher" && !sp.section ? ctx.membership.staffId ?? undefined : undefined;
  const teachers = canManage ? (await editOptions(ctx)).teachers : [];
  const view = await safeLoad("day", () =>
    timetableDay(ctx, { ...(date ? { date } : {}), ...(teacherId && canManage ? { teacherId } : ownTeacher ? { teacherId: ownTeacher } : { classSectionId: selected.id }) }),
  );
  if (!view) return <ErrorState title="Could not load the day" description="Refresh to try again." />;
  const extra = (
    <>
      <label className="grid gap-1 text-sm text-muted-foreground">
        Date
        <input type="date" name="date" defaultValue={view.date} className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground sm:h-9 sm:w-auto" />
      </label>
      {canManage && (
        <label className="grid gap-1 text-sm text-muted-foreground">
          Or a teacher
          <select name="teacher" defaultValue={teacherId ?? ""} className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground sm:h-9 sm:w-auto">
            <option value="">—</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
  const who = view.scope?.kind === "teacher" ? (ownTeacher ? "Your day" : (teachers.find((t) => t.id === view.scope?.id)?.name ?? "Teacher")) : selected.label;
  return (
    <div className="space-y-4">
      <SectionPicker sections={sections} selected={selected} tab="day" extra={extra} />
      <h2 className="text-base font-semibold">
        {who} — {WEEKDAY_NAMES[view.weekday]}, {view.date}
      </h2>
      <DayViewPanel view={view} slug={slug} timeZone={timeZone} />
    </div>
  );
}

async function ChangesTab({ ctx, slug, sp, sections, canManage, timeZone }: Omit<TabProps, "selected">) {
  const filters = {
    section: uuidOr(sp.cs),
    teacher: uuidOr(sp.teacher),
    kind: (CHANGE_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as (typeof CHANGE_KINDS)[number]) : undefined,
    from: dateOr(sp.from),
    to: dateOr(sp.to),
  };
  const data = await safeLoad("changes", async () => {
    const [rows, teachers] = await Promise.all([
      timetableChanges(ctx, { classSectionId: filters.section, teacherId: filters.teacher, kind: filters.kind, from: filters.from, to: filters.to, limit: 100 }),
      canManage ? editOptions(ctx).then((o) => o.teachers.map((t) => ({ id: t.id, label: t.name }))) : Promise.resolve([]),
    ]);
    const undone = canManage ? await undoneChangeIds(ctx, rows.map((r) => r.id)) : new Set<string>();
    return { rows, teachers, undone };
  });
  if (!data) return <ErrorState title="Could not load the changes" description="Refresh to try again." />;
  const shown = Math.min(100, Math.max(20, Math.floor(Number(sp.n)) || 20));
  const moreHref = `/${slug}/timetable?${new URLSearchParams({ tab: "changes", ...Object.fromEntries(Object.entries({ cs: filters.section, teacher: filters.teacher, kind: filters.kind, from: filters.from, to: filters.to }).filter(([, v]) => v) as [string, string][]), n: String(shown + 20) })}`;
  return <ChangesPanel rows={data.rows.slice(0, shown)} total={data.rows.length} moreHref={moreHref} undone={data.undone} filters={filters} sections={sections} teachers={data.teachers} slug={slug} timeZone={timeZone} canManage={canManage} />;
}

async function PlanTab({ ctx, slug, sp, sectionId, timeZone }: { ctx: TenantContext; slug: string; sp: Search; sectionId: string; timeZone: string }) {
  requirePermission(ctx, "timetable.manage");
  const data = await safeLoad("plan", async () => {
    const versions = await timetableVersions(ctx);
    const published = versions.find((v) => v.status === "published");
    const version = versions.find((v) => v.id === uuidOr(sp.version)) ?? versions.find((v) => v.status === "draft") ?? published ?? versions[0];
    if (!version) return { versions, published, version: null };
    const other = versions.find((v) => v.id === uuidOr(sp.compare) && v.id !== version.id);
    const [violations, suggest, snapshots, compareRows] = await Promise.all([
      timetableViolations(ctx, version.id),
      version.status === "draft" ? suggestTimetableFill(ctx, { versionId: version.id, classSectionIds: [sectionId], limit: 40 }) : Promise.resolve(null),
      timetableSnapshots(ctx, version.id),
      other ? timetableCompare(ctx, version.id, other.id) : Promise.resolve(null),
    ]);
    return { versions, published, version, violations, suggest, snapshots, compare: other && compareRows ? { other, rows: compareRows } : null };
  });
  if (!data) return <ErrorState title="Could not load the plan" description="Refresh to try again." />;
  if (!data.version) return <EmptyState title="No timetable versions yet" description="Create rooms, periods and a first version to start." />;
  return (
    <PlanPanel
      slug={slug}
      timeZone={timeZone}
      sectionId={sectionId}
      versions={data.versions}
      version={data.version}
      published={data.published}
      violations={data.violations}
      suggest={data.suggest}
      snapshots={data.snapshots}
      compare={data.compare}
    />
  );
}

async function RulesTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  requirePermission(ctx, "timetable.manage");
  const [rules, options, periods] = await Promise.all([loadRules(ctx), editOptions(ctx), gridPeriods(ctx)]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        These rules drive suggestions, the publish checklist and the substitute list. Defaults match how the timetable worked before. Every save is logged with its reason and can be undone from Changes.
      </p>
      <RulesForm
        slug={slug}
        initial={rules}
        subjects={options.subjects}
        teachers={options.teachers}
        periods={periods.filter((p) => !p.isBreak).map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
