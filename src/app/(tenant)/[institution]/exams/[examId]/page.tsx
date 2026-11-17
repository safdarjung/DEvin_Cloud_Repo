import type { Metadata } from "next";
import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { MarksDeadlinePanel } from "@/modules/exams/components/MarksDeadlinePanel";
import { PaperSchedule } from "@/modules/exams/components/PaperSchedule";
import { PaperGrid } from "@/modules/exams/components/PaperGrid";
import { VerificationPanel } from "@/modules/exams/components/VerificationPanel";
import { getExamWithPapers, getMarksProgress, listSectionOptions, listSubjectOptions } from "@/modules/exams/queries";
import { istDay } from "@/modules/practice/scoring";
import { verifyExam } from "@/modules/exams/actions";
import { institutionTimeZone, localParts } from "@/modules/exams/schedule-conflicts";
import { listRoomOptions } from "@/modules/exam-seating/queries";

export const metadata: Metadata = { title: "Exam" };

// T-019 fix round 1 — same roles results/page.tsx (T-019) allows to see a
// whole class's results; guardian/student hold exam.result.read too but
// must never see this link (they get only their own report card, never a
// class list).
const RESULTS_LINK_ROLES = new Set(["owner", "principal", "admin", "exam_controller", "teacher"]);

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ institution: string; examId: string }>;
}) {
  const { institution: institutionSlug, examId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  // Dashboard rows and breadcrumbs link here for every result reader; without exam.manage, show results instead of crashing.
  if (!hasPermission(ctx, "exam.manage") && hasPermission(ctx, "exam.result.read")) {
    redirect(`/${institutionSlug}/exams/${examId}/results`);
  }
  requirePermission(ctx, "exam.manage");

  const exam = await getExamWithPapers(ctx, examId);
  if (!exam) notFound();

  const timeZone = institutionTimeZone(ctx.institution.settings);
  const canSchedule = exam.papers.length > 0 && exam.status !== "published";
  const rooms = canSchedule ? await listRoomOptions(ctx) : [];
  const [verification, progress] = await Promise.all([
    exam.papers.length > 0 ? verifyExam(institutionSlug, { examId }) : null,
    getMarksProgress(ctx, exam),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={exam.name}
        description={`${humanize(exam.type)} · ${exam.papers.length} paper${exam.papers.length === 1 ? "" : "s"}`}
        back={{ href: `/${institutionSlug}/exams`, label: "Exams" }}
        actions={
          ctx.permissions.has("exam.result.read") && RESULTS_LINK_ROLES.has(ctx.membership.role) ? (
            <Button asChild variant="outline">
              <Link href={`/${institutionSlug}/exams/${exam.id}/results`}>Publish / View results</Link>
            </Button>
          ) : undefined
        }
      />

      <VerificationPanel
        institutionSlug={institutionSlug}
        examId={exam.id}
        examStatus={exam.status}
        hasPapers={exam.papers.length > 0}
        initialVerification={verification?.ok ? verification.data : null}
      />

      {exam.papers.length > 0 && exam.status !== "published" && (
        <MarksDeadlinePanel
          institutionSlug={institutionSlug}
          examId={exam.id}
          examStatus={exam.status}
          marksDueOn={exam.marksDueOn}
          progress={progress}
          today={istDay(new Date())}
        />
      )}

      {exam.papers.length === 0 ? (
        <PaperGridSection ctx={ctx} examId={exam.id} institutionSlug={institutionSlug} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Papers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {exam.papers.map((paper, i) => (
                <FadeIn as="li" delay={Math.min(i, 8) * 0.04} key={paper.id} className="motion-safe:fill-mode-backwards flex items-center justify-between gap-3 py-3">
                  <Link href={`/${institutionSlug}/exams/${exam.id}/papers/${paper.id}`} className="hover:underline">
                    {paper.sectionLabel} · {paper.subjectName}
                  </Link>
                  <span className="text-sm text-muted-foreground">/{paper.maxMarks}</span>
                </FadeIn>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {canSchedule && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <PaperSchedule
              institutionSlug={institutionSlug}
              examId={exam.id}
              timeZone={timeZone}
              rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
              papers={exam.papers.map((p) => {
                const local = p.scheduledAt ? localParts(p.scheduledAt, timeZone) : null;
                return {
                  id: p.id,
                  label: `${p.sectionLabel} · ${p.subjectName}`,
                  date: local?.date ?? "",
                  time: local?.hhmm ?? "",
                  durationMinutes: p.durationMinutes ?? 180,
                  roomId: p.roomId ?? "",
                };
              })}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function PaperGridSection({
  ctx,
  examId,
  institutionSlug,
}: {
  ctx: Awaited<ReturnType<typeof getTenantContext>>;
  examId: string;
  institutionSlug: string;
}) {
  const [sections, subjects] = await Promise.all([listSectionOptions(ctx), listSubjectOptions(ctx)]);
  const examsSettings = InstitutionSettingsSchema.shape.exams.safeParse(ctx.institution.settings.exams);
  const defaultPassPercentage = examsSettings.success ? examsSettings.data.pass_percentage : 33;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add papers</CardTitle>
      </CardHeader>
      <CardContent>
      <PaperGrid
        institutionSlug={institutionSlug}
        examId={examId}
        sections={sections}
        subjects={subjects}
        defaultMaxMarks={80}
        defaultPassPercentage={defaultPassPercentage}
      />
      </CardContent>
    </Card>
  );
}
