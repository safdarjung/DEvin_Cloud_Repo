import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// 05 §8 / §8.1 — two exams: HY-2026 (Half-Yearly, Term 1, published, 3,024
// results, two recheck requests) and PT2-X (Periodic Test 2, Grade X, Term
// 2, left in marks_entry with X-A Mathematics unmarked so the live demo
// enters/verifies/publishes it). Marks/results are never inserted directly
// into `results` — only app.publish_exam_results / app.apply_recheck_decision
// write that table (06 §W7/§W8); marks rows ARE written directly (05 §8.2:
// "writes rows directly but through the same constraints and triggers"),
// which is safe here because this seed always runs as the service-role /
// direct-postgres connection the marks_guard/RLS trust checks bypass.

const PASS_PERCENTAGE = 33; // settings.exams.pass_percentage (DEFAULT_INSTITUTION_SETTINGS)
const HY_HELD_ON_START = new Date("2026-09-14T00:00:00Z");
const HY_HELD_ON_DAYS = 12;

// 05 §8.1 — one marker student per grading band, each comfortably inside
// the band (>= 4 points from either edge) so independent per-subject
// rounding can never push the student's total percentage into the
// neighbouring band. Chosen in sections/ranks that never collide with
// Aarav/Ananya/Ishaan's fixed ranks.
const GRADE_MARKERS: { sectionKey: string; rank: number; percent: number }[] = [
  { sectionKey: "I-A", rank: 1, percent: 10 }, // E2 (0-20)
  { sectionKey: "II-A", rank: 1, percent: 26 }, // E1 (21-32)
  { sectionKey: "III-A", rank: 1, percent: 37 }, // D (33-40)
  { sectionKey: "IV-A", rank: 1, percent: 46 }, // C2 (41-50)
  { sectionKey: "V-A", rank: 1, percent: 56 }, // C1 (51-60)
  { sectionKey: "VII-A", rank: 1, percent: 66 }, // B2 (61-70)
  { sectionKey: "IX-A", rank: 1, percent: 76 }, // B1 (71-80)
  { sectionKey: "XI-A", rank: 1, percent: 86 }, // A2 (81-90)
  { sectionKey: "XII-A", rank: 1, percent: 95 }, // A1 (91-100)
];

function heldOnFor(index: number): string {
  const d = new Date(HY_HELD_ON_START);
  d.setUTCDate(d.getUTCDate() + (index % HY_HELD_ON_DAYS));
  return d.toISOString().slice(0, 10);
}

/** Box-Muller normal draw, scaled to [0, maxMarks] with mean/sd proportional to maxMarks/80 (05 §8's "mean 62, sd 16, clamped 0-80" generalized to co-scholastic's 50). */
function normalMark(rng: () => number, maxMarks: number): number {
  const mean = (62 / 80) * maxMarks;
  const sd = (16 / 80) * maxMarks;
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + sd * z;
  return Math.round(Math.max(0, Math.min(maxMarks, raw)));
}

interface SectionInfo {
  id: string;
  key: string;
  gradeCode: string;
}

interface SubjectAssignmentInfo {
  classSectionId: string;
  subjectId: string;
  subjectCode: string;
  kind: string;
}

interface EnrolmentInfo {
  studentId: string;
  firstName: string;
}

async function loadAcademicsData(ctx: SeedContext) {
  const { data: gradeRows, error: gradeError } = await ctx.admin
    .from("grades")
    .select("id, code")
    .eq("institution_id", ctx.institutionId);
  if (gradeError) throw new Error(`exams: grades query failed: ${gradeError.message}`);
  const gradeCodeById = new Map((gradeRows ?? []).map((g) => [g.id, g.code as string]));

  const { data: sectionRows, error: sectionError } = await ctx.admin
    .from("class_sections")
    .select("id, name, grade_id")
    .eq("institution_id", ctx.institutionId);
  if (sectionError) throw new Error(`exams: class_sections query failed: ${sectionError.message}`);
  const sections: SectionInfo[] = (sectionRows ?? []).map((s) => {
    const gradeCode = gradeCodeById.get(s.grade_id)!;
    return { id: s.id, key: `${gradeCode}-${s.name}`, gradeCode };
  });
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const sectionByKey = new Map(sections.map((s) => [s.key, s]));

  const { data: subjectRows, error: subjectError } = await ctx.admin
    .from("subjects")
    .select("id, code, kind")
    .eq("institution_id", ctx.institutionId);
  if (subjectError) throw new Error(`exams: subjects query failed: ${subjectError.message}`);
  const subjectById = new Map((subjectRows ?? []).map((s) => [s.id, s]));

  const { data: assignmentRows, error: assignmentError } = await ctx.admin
    .from("subject_assignments")
    .select("class_section_id, subject_id")
    .eq("institution_id", ctx.institutionId);
  if (assignmentError) throw new Error(`exams: subject_assignments query failed: ${assignmentError.message}`);
  const assignments: SubjectAssignmentInfo[] = (assignmentRows ?? []).map((a) => {
    const subject = subjectById.get(a.subject_id)!;
    return { classSectionId: a.class_section_id, subjectId: a.subject_id, subjectCode: subject.code, kind: subject.kind };
  });
  // Determinism: `subject_assignments` is fetched with no ORDER BY, so
  // PostgREST's row order is not guaranteed stable across reseeds. Every
  // rng() draw below (marks generation) happens per-assignment in array
  // order, so an unstable fetch order would reassign the same rng draws to
  // different (section, subject) pairs on different reseeds. Sorting by
  // (classSectionId, subjectCode) — both deterministic uuidV5/code values —
  // fixes the order without depending on the DB's physical row order.
  assignments.sort((a, b) => (a.classSectionId + a.subjectCode).localeCompare(b.classSectionId + b.subjectCode));

  // Active enrolments per section come straight from ctx.studentsBySection
  // (built by people.ts/academics.ts — one row per student, 1:1 with the
  // active enrolment academics.ts created) rather than a second DB round
  // trip through a nested enrolments->students join.
  const enrolmentsBySection = new Map<string, EnrolmentInfo[]>();
  for (const section of sections) {
    const students = (ctx.studentsBySection[section.key] ?? []).map((s) => ({
      studentId: s.id,
      firstName: s.firstName,
    }));
    enrolmentsBySection.set(section.id, students);
  }

  return { sections, sectionById, sectionByKey, assignments, enrolmentsBySection };
}

/** Builds exam_papers + marks rows for one exam over `sectionIds`, scoped to `assignments` restricted to those sections. Returns the built paper ids keyed by `${sectionId}:${subjectCode}`. */
function buildPapersAndMarks(
  ctx: SeedContext,
  examKey: string,
  examId: string,
  sectionIds: Set<string>,
  assignments: SubjectAssignmentInfo[],
  enrolmentsBySection: Map<string, EnrolmentInfo[]>,
  maxMarksFor: (kind: string) => number,
  passMarksFor: (maxMarks: number) => number,
  skipMarksFor?: (classSectionId: string, subjectCode: string) => boolean,
) {
  const paperRows: Record<string, unknown>[] = [];
  const markRows: Record<string, unknown>[] = [];
  const paperIdByKey = new Map<string, { id: string; maxMarks: number }>();

  let paperIndex = 0;
  for (const a of assignments) {
    if (!sectionIds.has(a.classSectionId)) continue;
    const maxMarks = maxMarksFor(a.kind);
    const passMarks = passMarksFor(maxMarks);
    const paperId = uuidV5("exams", `paper:${examKey}:${a.classSectionId}:${a.subjectCode}`);
    paperRows.push({
      id: paperId,
      institution_id: ctx.institutionId,
      exam_id: examId,
      class_section_id: a.classSectionId,
      subject_id: a.subjectId,
      max_marks: maxMarks,
      pass_marks: passMarks,
      held_on: heldOnFor(paperIndex),
    });
    paperIdByKey.set(`${a.classSectionId}:${a.subjectCode}`, { id: paperId, maxMarks });
    paperIndex += 1;

    if (skipMarksFor?.(a.classSectionId, a.subjectCode)) continue;

    const students = enrolmentsBySection.get(a.classSectionId) ?? [];
    for (const student of students) {
      const isAbsent = ctx.rng() < 0.015;
      markRows.push({
        id: uuidV5("exams", `marks:${examKey}:${a.classSectionId}:${a.subjectCode}:${student.studentId}`),
        institution_id: ctx.institutionId,
        exam_paper_id: paperId,
        student_id: student.studentId,
        marks_obtained: isAbsent ? null : normalMark(ctx.rng, maxMarks),
        is_absent: isAbsent,
        version_no: 1,
        source: "entry",
      });
    }
  }

  return { paperRows, markRows, paperIdByKey };
}

/** Overrides every mark row for `studentId` (any paper) to hit an exact percentage — guarantees grade-band coverage deterministically rather than hoping the random distribution lands there. */
function applyGradeMarker(
  markRows: Record<string, unknown>[],
  paperIdByKey: Map<string, { id: string; maxMarks: number }>,
  classSectionId: string,
  studentId: string,
  percent: number,
  examKey: string,
  subjectCodesForSection: string[],
): void {
  for (const code of subjectCodesForSection) {
    const paper = paperIdByKey.get(`${classSectionId}:${code}`);
    if (!paper) continue;
    const row = markRows.find(
      (r) => r.exam_paper_id === paper.id && r.student_id === studentId,
    );
    if (!row) continue;
    row.marks_obtained = Math.round((percent / 100) * paper.maxMarks);
    row.is_absent = false;
  }
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin
    .from("exams")
    .select("id, status")
    .eq("institution_id", ctx.institutionId)
    .eq("name", "Half-Yearly Examination 2026")
    .maybeSingle();
  if (existing?.status === "published") return; // idempotent rerun guard (packet security requirement)

  const { sections, sectionByKey, assignments, enrolmentsBySection } = await loadAcademicsData(ctx);

  const subjectCodesBySection = new Map<string, string[]>();
  for (const a of assignments) {
    const list = subjectCodesBySection.get(a.classSectionId) ?? [];
    list.push(a.subjectCode);
    subjectCodesBySection.set(a.classSectionId, list);
  }

  // ---- HY-2026 (half_yearly, Term 1, all 72 sections) ----
  const hyExamId = uuidV5("exams", "exam:HY-2026");
  await ctx.admin.from("exams").upsert({
    id: hyExamId,
    institution_id: ctx.institutionId,
    academic_year_id: ctx.academicYearId,
    term_id: ctx.termIds.term1,
    name: "Half-Yearly Examination 2026",
    type: "half_yearly",
    status: "draft",
    grading_scale_key: "default",
  });

  const allSectionIds = new Set(sections.map((s) => s.id));
  const hyBuild = buildPapersAndMarks(
    ctx,
    "HY-2026",
    hyExamId,
    allSectionIds,
    assignments,
    enrolmentsBySection,
    (kind) => (kind === "co_scholastic" ? 50 : 80),
    (maxMarks) => Math.round((maxMarks * PASS_PERCENTAGE) / 100),
  );

  // Ishaan Mehta's Science mark must be exactly 61 pre-recheck (05 §8.1).
  const viiiB = sectionByKey.get("VIII-B");
  const ishaan = enrolmentsBySection.get(viiiB?.id ?? "")?.find((s) => s.firstName === "Ishaan");
  if (viiiB && ishaan) {
    const sciPaper = hyBuild.paperIdByKey.get(`${viiiB.id}:SCI`);
    const row = hyBuild.markRows.find((r) => r.exam_paper_id === sciPaper?.id && r.student_id === ishaan.studentId);
    if (row) {
      row.marks_obtained = 61;
      row.is_absent = false;
    }
  }

  // Grade-band markers (05 §8.1, acceptance criterion 3: every grade A1..E2 present).
  for (const marker of GRADE_MARKERS) {
    const section = sectionByKey.get(marker.sectionKey);
    if (!section) continue;
    const students = [...(ctx.studentsBySection[marker.sectionKey] ?? [])].sort((a, b) =>
      a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase()),
    );
    const student = students[marker.rank - 1];
    if (!student) continue;
    applyGradeMarker(
      hyBuild.markRows,
      hyBuild.paperIdByKey,
      section.id,
      student.id,
      marker.percent,
      "HY-2026",
      subjectCodesBySection.get(section.id) ?? [],
    );
  }

  await insertBatch(ctx.admin, "exam_papers", hyBuild.paperRows, 2000);
  await insertBatch(ctx.admin, "marks", hyBuild.markRows, 5000);

  await ctx.admin.from("exams").update({ status: "marks_entry" }).eq("id", hyExamId);
  await ctx.admin.from("exams").update({ status: "verification" }).eq("id", hyExamId);

  // publish_exam_results/apply_recheck_decision require a non-null
  // app.current_user_id(); set it for this transaction only (local=true).
  const examControllerUserId = ctx.userIdByLogin["examcontroller"]!;
  await ctx.sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: examControllerUserId, role: "authenticated" })}, true)`;
    await tx`select app.publish_exam_results(${hyExamId}::uuid)`;
  });

  // Avoid leaving 3,024 pending notify.results_published jobs after a seed
  // (packet instruction) — notifications are not separately seeded (not a
  // §8.2-counted entity).
  await ctx.admin
    .from("jobs")
    .update({ status: "succeeded" })
    .eq("institution_id", ctx.institutionId)
    .eq("type", "notify.results_published")
    .eq("status", "queued");

  // ---- Recheck requests (05 §8.1) ----
  const { data: ishaanResult } = await ctx.admin
    .from("results")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .eq("exam_id", hyExamId)
    .eq("student_id", ishaan!.studentId)
    .is("superseded_by", null)
    .single();
  const ishaanSciPaper = hyBuild.paperIdByKey.get(`${viiiB!.id}:SCI`)!;

  const ishaanRequestId = uuidV5("exams", "recheck:ishaan-science");
  await ctx.admin.from("recheck_requests").upsert({
    id: ishaanRequestId,
    institution_id: ctx.institutionId,
    result_id: ishaanResult!.id,
    exam_paper_id: ishaanSciPaper.id,
    requested_by: ctx.userIdByLogin["guardian.two"],
    reason: "Requesting a recheck of Ishaan's Science marks — he expected a higher score.",
    status: "under_review",
  });

  await ctx.sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: examControllerUserId, role: "authenticated" })}, true)`;
    await tx`select app.apply_recheck_decision(${ishaanRequestId}::uuid, 'approve', 64, 'Re-evaluated answer script; +3 marks awarded.')`;
  });

  // One X-D student, English, left under_review (05 §8.1).
  const xd = sectionByKey.get("X-D");
  const xdSubjects = xd ? (subjectCodesBySection.get(xd.id) ?? []) : [];
  if (xd && xdSubjects.includes("ENG")) {
    const xdStudents = [...(ctx.studentsBySection["X-D"] ?? [])].sort((a, b) =>
      a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase()),
    );
    const xdStudent = xdStudents[0];
    if (xdStudent) {
      const { data: xdResult } = await ctx.admin
        .from("results")
        .select("id")
        .eq("institution_id", ctx.institutionId)
        .eq("exam_id", hyExamId)
        .eq("student_id", xdStudent.id)
        .is("superseded_by", null)
        .single();
      const engPaper = hyBuild.paperIdByKey.get(`${xd.id}:ENG`)!;
      await ctx.admin.from("recheck_requests").upsert({
        id: uuidV5("exams", "recheck:x-d-english"),
        institution_id: ctx.institutionId,
        result_id: xdResult!.id,
        exam_paper_id: engPaper.id,
        requested_by: ctx.userIdByLogin["examcontroller"],
        reason: "Guardian requested a recheck of the English paper on the student's behalf.",
        status: "under_review",
      });
    }
  }

  await ctx.admin
    .from("jobs")
    .update({ status: "succeeded" })
    .eq("institution_id", ctx.institutionId)
    .eq("type", "notify.recheck_decided")
    .eq("status", "queued");

  // ---- PT2-X (unit_test, Term 2, grade X only, left in marks_entry) ----
  const ptExamId = uuidV5("exams", "exam:PT2-X");
  await ctx.admin.from("exams").upsert({
    id: ptExamId,
    institution_id: ctx.institutionId,
    academic_year_id: ctx.academicYearId,
    term_id: ctx.termIds.term2,
    name: "Periodic Test 2 (Grade X)",
    type: "unit_test",
    status: "marks_entry",
    grading_scale_key: "default",
  });

  const gradeXSectionIds = new Set(sections.filter((s) => s.gradeCode === "X").map((s) => s.id));
  const xaSectionId = sectionByKey.get("X-A")?.id;
  const ptBuild = buildPapersAndMarks(
    ctx,
    "PT2-X",
    ptExamId,
    gradeXSectionIds,
    assignments,
    enrolmentsBySection,
    () => 40,
    () => 13,
    (classSectionId, subjectCode) => classSectionId === xaSectionId && subjectCode === "MATH",
  );

  await insertBatch(ctx.admin, "exam_papers", ptBuild.paperRows, 2000);
  await insertBatch(ctx.admin, "marks", ptBuild.markRows, 5000);
}
