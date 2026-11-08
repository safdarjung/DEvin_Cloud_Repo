import { ProgressBar, RadialGauge } from "@/components/widgets/viz";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { curriculumCoverageBySection } from "@/modules/academics/curriculum.queries";
import { examSchedule, examScheduleConflicts } from "@/modules/exams/schedule.queries";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { PlannedWidget, SimpleTable, StatusChip, loadSection, renderSection } from "@/modules/fabric/components/fabric-sections";

const MAX_CONFLICT_EXAMS = 5;

export default async function LearningPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");
  const base = `/${institutionSlug}`;
  const today = new Date().toISOString().slice(0, 10);

  const [coverage, schedule, conflicts] = await Promise.all([
    loadSection(ctx, "coverage", "academics.read", "lesson_plans", () => curriculumCoverageBySection(ctx)),
    loadSection(ctx, "exam schedule", "exam.result.read", "exams", () => examSchedule(ctx, { from: today })),
    // Conflicts are per exam; check the next few upcoming exams only.
    loadSection(ctx, "exam conflicts", "exam.manage", "exams", async () => {
      const upcoming = await examSchedule(ctx, { from: today });
      const examIds = [...new Set(upcoming.map((r) => r.exam_id))].slice(0, MAX_CONFLICT_EXAMS);
      const lists = await Promise.all(examIds.map((id) => examScheduleConflicts(ctx, id)));
      return { checked: examIds.length, rows: lists.flat() };
    }),
  ]);

  const nothing = [coverage, schedule, conflicts].every((s) => s.state === "hidden");

  return (
    <FabricPage title="Learning" description="Curriculum pacing and exam scheduling from live records." ws="learning">
      <div className="space-y-4">
        {nothing && <p className="text-sm text-muted-foreground">Your role has no learning views. Ask an administrator if you need access.</p>}

        <div className="grid gap-4 lg:grid-cols-2">
          {renderSection(
            "Curriculum coverage",
            coverage,
            (rows) => {
              if (rows.length === 0) return <p className="text-sm text-muted-foreground">No curriculum plan is set up for the current academic year.</p>;
              const behind = rows.filter((r) => !r.on_track);
              const sorted = [...behind, ...rows.filter((r) => r.on_track)].slice(0, 15);
              const done = rows.reduce((n, r) => n + r.completed_units, 0);
              const planned = rows.reduce((n, r) => n + r.planned_units, 0);
              return (
                <div className="space-y-2">
                  <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-center">
                    {planned > 0 && (
                      <RadialGauge value={(done / planned) * 100} label="Covered against plan" sublabel={`${done} of ${planned} units planned to date`} />
                    )}
                    <ProgressBar
                      className="flex-1"
                      label="Subject-sections on pace"
                      value={rows.length - behind.length}
                      max={rows.length}
                      valueLabel={`${rows.length - behind.length} of ${rows.length}`}
                      tone={behind.length === 0 ? "success" : "warning"}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {behind.length} of {rows.length} subject-sections behind pace.
                  </p>
                  <SimpleTable
                    caption="Units completed against units planned by section and subject"
                    head={["Section", "Subject", "Units done / planned", "Pace"]}
                    numericCols={[2]}
                    rows={sorted.map((r) => ({
                      key: `${r.section_label}:${r.subject}`,
                      cells: [
                        r.section_label,
                        r.subject,
                        `${r.completed_units} / ${r.planned_units}`,
                        <StatusChip key="p" tone={r.on_track ? "good" : "warn"}>{r.on_track ? "On track" : "Behind"}</StatusChip>,
                      ],
                    }))}
                  />
                  {rows.length > sorted.length && <p className="text-xs text-muted-foreground">Showing {sorted.length} of {rows.length}, behind-pace first.</p>}
                </div>
              );
            },
            { description: "Pace is planned units for the date versus units marked covered", className: "lg:col-span-2" },
          )}

          {renderSection(
            "Upcoming exams",
            schedule,
            (rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exam papers are scheduled from today.</p>
              ) : (
                <SimpleTable
                  caption="Upcoming exam papers"
                  head={["Date", "Exam", "Subject", "Section", "Status"]}
                  rows={rows.slice(0, 15).map((r) => ({
                    key: r.id,
                    cells: [r.date, r.title, r.subject, r.section_label, humanize(r.status)],
                  }))}
                />
              ),
            { description: "Papers dated today or later", action: { href: `${base}/exams`, label: "Exams" } },
          )}

          {renderSection(
            "Exam schedule clashes",
            conflicts,
            ({ checked, rows }) =>
              checked === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming exams to check.</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clashes found in the next {checked} exam{checked === 1 ? "" : "s"}.</p>
              ) : (
                <SimpleTable
                  caption="Exam schedule clashes"
                  head={["Kind", "Section", "Room", "Detail"]}
                  rows={rows.map((c, i) => ({
                    key: `${c.exam_paper_id}:${c.other_exam_paper_id ?? i}`,
                    cells: [<StatusChip key="k" tone="bad">{humanize(c.kind)}</StatusChip>, c.section_label, c.room ?? "—", c.detail],
                  }))}
                />
              ),
            { description: `Checked for up to ${MAX_CONFLICT_EXAMS} upcoming exams` },
          )}

          <PlannedWidget
            title="Mastery heatmap"
            note="Per-skill mastery is not tracked yet, so no grid is shown. Curriculum coverage above is real."
            className="lg:col-span-2"
          />
        </div>
      </div>
    </FabricPage>
  );
}
