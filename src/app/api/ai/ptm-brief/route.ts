import "server-only";
// features-18 §C #18 — "Brief" for a booked slot on /ptm. Every read goes
// through the owner queries under the caller's RLS: a teacher reads only
// students they teach; guardians/students lack ptm.slot.manage. The prompt
// gets the grade, this term's attendance %, the latest published result by
// subject, pending assignments, and behaviour point sums only when the
// behaviour module is on and the caller holds behaviour.read — never a name,
// contact, incident note or health data. Suggestions only: nothing is stored
// against the student; the route writes nothing but usage.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { mySubmissions } from "@/modules/academics/submissions.queries";
import { buildPtmBriefPrompt, PTM_BRIEF_INSTRUCTIONS } from "@/modules/ai/prompts/ptm-brief";
import {
  PtmBriefGenerationSchema,
  PtmBriefRequestSchema,
  type PtmBriefRequest,
  type PtmBriefResponse,
} from "@/modules/ai/ptm-brief.schemas";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { getStudentAttendanceSummary } from "@/modules/attendance/queries";
import { portalTimeline } from "@/modules/behaviour/queries";
import { getCurrentResult, listResultsForStudent } from "@/modules/exams/queries";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lesson 9: always cap output (10 sentences of ≤200 chars).
const MAX_OUTPUT_TOKENS = 1024;
const MAX_PENDING_TITLES = 5;

export const POST = aiTaskRoute<PtmBriefRequest, PtmBriefResponse>({
  route: "ptm-brief",
  schema: PtmBriefRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "ptm.slot.manage",
  capability: "ptm_brief",
  run: async (ctx, { studentId }) => {
    // null for another school's student or one this teacher does not teach (students RLS).
    const profile = await getStudentProfile(ctx, studentId);
    if (!profile) return fail("not_found", "Student not found.");

    const showBehaviour = isModuleEnabled(ctx, "behaviour") && hasPermission(ctx, "behaviour.read");
    const termId = profile.enrolment ? await getCurrentTermId(ctx, profile.enrolment.academicYearId) : null;
    const [attendance, results, submissions, behaviour] = await Promise.all([
      termId ? getStudentAttendanceSummary(ctx, studentId, termId) : null,
      listResultsForStudent(ctx, studentId),
      mySubmissions(ctx, studentId),
      showBehaviour ? portalTimeline(ctx, studentId) : null,
    ]);
    const latest = results[0] ? await getCurrentResult(ctx, results[0].examId, studentId) : null;
    const pending = submissions.filter((s) => s.state === "not_submitted");
    const points = behaviour?.incidents.map((i) => i.points) ?? [];

    const generated = await runStructured({
      ctx,
      feature: "ptm_brief",
      schema: PtmBriefGenerationSchema,
      instructions: PTM_BRIEF_INSTRUCTIONS,
      prompt: buildPtmBriefPrompt({
        gradeLabel: profile.enrolment?.gradeName || null,
        attendancePct: attendance && attendance.totalInDenominator > 0 ? Math.round(attendance.percentage * 10) / 10 : null,
        latestExam: latest && {
          name: latest.examName,
          percentage: latest.percentage,
          grade: latest.grade,
          subjects: latest.subjects.map((s) => ({
            name: s.subjectName,
            marks: s.isAbsent ? "absent" : `${s.marksObtained ?? "?"}/${s.maxMarks}`,
            grade: s.grade,
          })),
        },
        pendingAssignments: {
          count: pending.length,
          overdue: pending.filter((s) => s.isLate).length,
          titles: pending.slice(0, MAX_PENDING_TITLES).map((s) => s.title),
        },
        behaviourPoints: behaviour && {
          merit: points.filter((p) => p > 0).reduce((a, b) => a + b, 0),
          demerit: points.filter((p) => p < 0).reduce((a, b) => a + b, 0),
        },
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { data, provider, model, fallback } = generated.data;
    return ok({ brief: data, provider, model, fallback });
  },
});
