import "server-only";
// T-0NN — teacher tool-calling agent's tools (D28: a parallel Gemini-only
// chat path, out of band from the local/cloud policy machinery in
// src/lib/ai/gateway.ts). Every tool closes over the caller's own
// authenticated `ctx` and a real RLS-respecting `createClient()` — never
// the admin client — and re-checks scope with the same functions the
// existing /api/ai/quiz and /api/ai/report-remark routes use, so a
// model-supplied id is never trusted on its own. A failed scope check
// returns an error STRING in the tool result, never a thrown exception,
// so the model can relay it and the stream keeps going.
import { tool } from "ai";
import { unitSearchWords, unitTitleScore } from "./unit-match";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/schemas/common";
import type { TenantContext } from "@/lib/auth/types";
import { listStudents, getStudentProfile, getCurrentTermId } from "@/modules/people/queries";
import { getSectionAttendancePatterns } from "@/modules/attendance/queries";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { managesWholeSection } from "@/modules/academics/teacher-scope";
import { canGenerateQuizForUnit } from "@/modules/ai/quiz-scope";
import { canDraftRemarkForResult } from "@/modules/ai/remark-scope";
import { QuizContentSchema, QuizGenerationSchema } from "@/modules/ai/quiz.schemas";
import { buildQuizPrompt, QUIZ_GENERATION_INSTRUCTIONS } from "@/modules/ai/prompts/quiz";
import { RemarkGenerationSchema } from "@/modules/ai/remark.schemas";
import { buildRemarkPrompt, REMARK_GENERATION_INSTRUCTIONS } from "@/modules/ai/prompts/remark";
import { runStructured } from "@/lib/ai/gateway";
import { escapeIlike } from "@/lib/list-search";

// Matches the quiz/remark routes' own cap (T-036: unbounded output pinned
// the local model's GPU for 7+ minutes during bisection).
const MAX_OUTPUT_TOKENS = 2048;


// Fix round 1 (security review, LOW-3): a raw DB/network error must never
// reach the model as a thrown exception — it kills the stream, and this
// module's own header comment promises "never a thrown exception". Every
// tool's `execute` is wrapped with this so a failure degrades to a plain
// string the model can relay, same shape as the scope-check misses below.
function toolErrorMessage(toolName: string, err: unknown): string {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] teacher agent tool "${toolName}" failed`, err);
  return `Something went wrong looking that up. Reference: ${correlationId}`;
}

type AgentClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Fix round 1 (security review, MED N+1): batches the "which grade+subject
 * pairs can this teacher generate for" check into one query instead of
 * calling `canGenerateQuizForUnit` per candidate row (up to 20 extra round
 * trips). `"all"` mirrors `canGenerateQuizForUnit`'s own
 * `managesWholeSection(ctx, null)` bypass for owner/principal.
 */
async function allowedGradeSubjectPairs(supabase: AgentClient, ctx: TenantContext): Promise<Set<string> | "all"> {
  if (managesWholeSection(ctx, null)) return "all";
  const staffId = ctx.membership.staffId;
  if (!staffId) return new Set();

  const { data, error } = await supabase
    .from("subject_assignments")
    .select("subject_id, class_sections(grade_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("teacher_id", staffId);
  if (error) throw error;

  const pairs = new Set<string>();
  for (const row of data ?? []) {
    const gradeId = (row.class_sections as { grade_id: string } | null)?.grade_id;
    if (gradeId) pairs.add(`${gradeId}:${row.subject_id}`);
  }
  return pairs;
}

async function findCurriculumUnitImpl(
  supabase: AgentClient,
  ctx: TenantContext,
  query: string,
): Promise<Array<{ id: string; title: string; gradeLabel: string; subjectName: string }>> {
  // Word by word, not one exact phrase: "acid bases and salts" must find "Acids, Bases and Salts".
  const words = unitSearchWords(query);
  const filter = (words.length ? words : [query.trim().toLowerCase()]).map((w) => `title.ilike.%${escapeIlike(w).replace(/[,()]/g, " ")}%`).join(",");
  const [{ data, error }, scope] = await Promise.all([
    supabase
      .from("curriculum_units")
      .select("id, title, grade_id, subject_id, grades(display_name), subjects(name)")
      .eq("institution_id", ctx.institution.id)
      .or(filter)
      .limit(60),
    allowedGradeSubjectPairs(supabase, ctx),
  ]);
  if (error) throw error;

  const ranked = (data ?? [])
    .filter((row) => scope === "all" || scope.has(`${row.grade_id}:${row.subject_id}`))
    .map((row) => ({ row, score: unitTitleScore(row.title, words) }))
    .filter((r) => words.length === 0 || r.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, 5).map(({ row }) => {
    const grade = row.grades as { display_name: string } | null;
    const subject = row.subjects as { name: string } | null;
    return { id: row.id, title: row.title, gradeLabel: grade?.display_name ?? "", subjectName: subject?.name ?? "" };
  });
}

/**
 * The units of the subjects and grades this teacher teaches, optionally narrowed by a class ("10", "X")
 * or a subject word. Seen: "what chapters are there for class 10?" got "I don't have a tool to list chapters".
 */
async function listMyUnitsImpl(
  supabase: AgentClient,
  ctx: TenantContext,
  filter: { grade?: string; subject?: string },
): Promise<Array<{ id: string; title: string; gradeLabel: string; subjectName: string }>> {
  const scope = await allowedGradeSubjectPairs(supabase, ctx);
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, title, sequence, grade_id, subject_id, grades(display_name, code), subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .order("sequence")
    .limit(400);
  if (error) throw error;
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const WORDS = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];
  // "8A", "8 A", "VIII-A", "eight a": the section letter is dropped; a Roman one needs a separator ("XI" is not "X" + "I").
  const g = filter.grade
    ?.trim()
    .toUpperCase()
    .replace(/^(CLASS|GRADE|STD)\s*/, "")
    .replace(/^(\d{1,2}(?:ST|ND|RD|TH)?)\s*-?\s*[A-Z]$/, "$1")
    .replace(/^([A-Z]+)[\s-]+[A-Z]$/, "$1")
    .replace(/(ST|ND|RD|TH)$/, "");
  const gradeCode = g && /^\d+$/.test(g) ? ROMAN[Number(g)] : g && WORDS.indexOf(g) > 0 ? ROMAN[WORDS.indexOf(g)] : g;
  const subject = filter.subject?.trim().toLowerCase();
  return (data ?? [])
    .filter((row) => scope === "all" || scope.has(`${row.grade_id}:${row.subject_id}`))
    .filter((row) => !gradeCode || (row.grades as { code: string } | null)?.code?.toUpperCase() === gradeCode)
    .filter((row) => !subject || ((row.subjects as { name: string } | null)?.name ?? "").toLowerCase().includes(subject))
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      title: row.title,
      gradeLabel: (row.grades as { display_name: string } | null)?.display_name ?? "",
      subjectName: (row.subjects as { name: string } | null)?.name ?? "",
    }));
}

/** Builds the full tool set for this authenticated teacher's turn, sharing one RLS-scoped client. */
export async function teacherTools(ctx: TenantContext) {
  const supabase = await createClient();

  return {
    findStudent: tool({
      description:
        "Find a student taught by this teacher, by name or admission number. Returns up to 5 matches. " +
        "When the person gave no name (\"a student I teach\"), call it with no query: it returns up to 12 of their students; list them as numbered choices to pick from instead of asking them to type a name.",
      inputSchema: z.object({ query: z.string().trim().max(200).optional() }),
      execute: async ({ query }) => {
        try {
          const page = await listStudents(ctx, query || undefined, 1);
          if (page.students.length === 0) return "No matching student found in your sections.";
          return page.students.slice(0, query ? 5 : 12).map((s) => ({
            id: s.id,
            name: [s.firstName, s.lastName].filter(Boolean).join(" "),
            grade: s.gradeName,
            section: s.sectionName,
          }));
        } catch (err) {
          return toolErrorMessage("findStudent", err);
        }
      },
    }),

    listMyUnits: tool({
      description:
        "List the curriculum units (chapters) of the subjects this teacher teaches, optionally for one class (e.g. '10' or 'X') or subject. Use it to offer units to choose from instead of asking for an exact title.",
      inputSchema: z.object({ grade: z.string().trim().max(20).optional(), subject: z.string().trim().max(60).optional() }),
      execute: async ({ grade, subject }) => {
        try {
          const units = await listMyUnitsImpl(supabase, ctx, { grade, subject });
          return units.length ? units : "No units found for that class or subject among the ones you teach.";
        } catch (err) {
          return toolErrorMessage("listMyUnits", err);
        }
      },
    }),

    findCurriculumUnit: tool({
      description:
        "Find a curriculum unit by title, limited to subjects and grades this teacher teaches. Returns up to 5 matches.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
      execute: async ({ query }) => {
        try {
          const results = await findCurriculumUnitImpl(supabase, ctx, query);
          if (results.length === 0)
            return "No unit with that title in the classes and subjects you teach. Do not stop here: a lesson plan, quiz or worksheet does not need a unit. Carry on with the chapter as the person named it.";
          return results;
        } catch (err) {
          return toolErrorMessage("findCurriculumUnit", err);
        }
      },
    }),

    getAttendancePattern: tool({
      description:
        "Get a student's attendance pattern (present/absent/late counts and recent absent days) for the current term. Only works for students this teacher teaches.",
      inputSchema: z.object({ studentId: uuid }),
      execute: async ({ studentId }) => {
        try {
          const student = await getStudentProfile(ctx, studentId);
          if (!student || !student.enrolment) {
            return "That student is not in your sections, or has no active enrolment.";
          }
          const termId = await getCurrentTermId(ctx, student.enrolment.academicYearId);
          if (!termId) return "No current term is configured for this student's academic year.";

          const pattern = await getSectionAttendancePatterns(ctx, student.enrolment.classSectionId, termId);
          if (!pattern) return "That student's section could not be found.";

          const row = pattern.students.find((s) => s.studentId === studentId);
          if (!row) return "No attendance records yet for this student this term.";

          return {
            presentCount: row.presentCount,
            absentCount: row.absentCount,
            lateCount: row.lateCount,
            halfDayCount: row.halfDayCount,
            recentAbsentDayOffsets: row.recentAbsentDayOffsets,
          };
        } catch (err) {
          return toolErrorMessage("getAttendancePattern", err);
        }
      },
    }),

    getExamResults: tool({
      description:
        "Look up a student's published exam results: grade, percentage, and per-subject marks. Only works for students this teacher teaches. Returns up to 5 most recent results, or one named exam if given.",
      inputSchema: z.object({ studentId: uuid, examName: z.string().trim().min(1).max(200).optional() }),
      execute: async ({ studentId, examName }) => {
        try {
          // Reused from the remark-drafting tool: "may this teacher see
          // this student's results" is the same "teaches this student"
          // bar as "may draft a remark for them" (remark-scope.ts), not an
          // exam-specific check.
          const allowed = await canDraftRemarkForResult(supabase, ctx, studentId);
          if (!allowed) return "You do not teach this student.";

          const { data: rows, error } = await supabase
            .from("results")
            .select("id, snapshot, percentage, grade, exams(name)")
            .eq("institution_id", ctx.institution.id)
            .eq("student_id", studentId)
            .is("superseded_by", null)
            .order("published_at", { ascending: false })
            .limit(20);
          if (error) throw error;

          const matches = examName
            ? (rows ?? []).filter(
                (row) => (row.exams as { name: string } | null)?.name?.toLowerCase() === examName.toLowerCase(),
              )
            : (rows ?? []);
          if (matches.length === 0) {
            return examName
              ? `No exam result named "${examName}" found for this student.`
              : "No exam results found for this student.";
          }

          const subjectIds = [
            ...new Set(
              matches.flatMap((row) => {
                const snapshot = row.snapshot as { subjects: Array<{ subject_id: string }> };
                return snapshot.subjects.map((s) => s.subject_id);
              }),
            ),
          ];
          const { data: subjectRows, error: subjectsError } =
            subjectIds.length > 0
              ? await supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).in("id", subjectIds)
              : { data: [], error: null };
          if (subjectsError) throw subjectsError;
          const subjectNameById = new Map((subjectRows ?? []).map((s) => [s.id, s.name]));

          return matches.slice(0, 5).map((row) => {
            const exam = row.exams as { name: string } | null;
            const snapshot = row.snapshot as {
              subjects: Array<{ subject_id: string; marks_obtained: number | null; max_marks: number; is_absent: boolean; grade: string | null }>;
            };
            return {
              examName: exam?.name ?? "",
              percentage: row.percentage,
              grade: row.grade,
              subjects: snapshot.subjects.map((s) => ({
                subjectName: subjectNameById.get(s.subject_id) ?? "",
                marksObtained: s.marks_obtained,
                maxMarks: s.max_marks,
                isAbsent: s.is_absent,
                grade: s.grade,
              })),
            };
          });
        } catch (err) {
          return toolErrorMessage("getExamResults", err);
        }
      },
    }),

    getAssignmentStatus: tool({
      description:
        "List a student's published assignments: title, subject, due date. Only works for students this teacher teaches. " +
        "This does not track individual student submissions — it cannot say whether a specific student has submitted.",
      inputSchema: z.object({ studentId: uuid }),
      execute: async ({ studentId }) => {
        try {
          const allowed = await canDraftRemarkForResult(supabase, ctx, studentId);
          if (!allowed) return "You do not teach this student.";

          const assignments = await listStudentAssignments(ctx, studentId);
          if (assignments.length === 0) return "No published assignments found for this student.";

          const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
          const { data: subjectRows, error } = await supabase
            .from("subjects")
            .select("id, name")
            .eq("institution_id", ctx.institution.id)
            .in("id", subjectIds);
          if (error) throw error;
          const subjectNameById = new Map((subjectRows ?? []).map((s) => [s.id, s.name]));

          return assignments.map((a) => ({
            title: a.title,
            subjectName: subjectNameById.get(a.subjectId) ?? "",
            dueAt: a.dueAt,
            aiGenerated: a.aiGenerated,
          }));
        } catch (err) {
          return toolErrorMessage("getAssignmentStatus", err);
        }
      },
    }),

    generateQuiz: tool({
      description:
        "Generate a DRAFT multiple-choice quiz for a curriculum unit. This is not saved anywhere — the teacher must review and save it from Assignments.",
      inputSchema: z.object({
        curriculumUnitId: uuid,
        difficulty: z.enum(["easy", "medium", "hard"]),
        questionCount: z.number().int().min(1).max(15),
      }),
      execute: async ({ curriculumUnitId, difficulty, questionCount }) => {
        try {
          const { data: unit, error: unitError } = await supabase
            .from("curriculum_units")
            .select("id, title, description, grade_id, subject_id")
            .eq("id", curriculumUnitId)
            .eq("institution_id", ctx.institution.id)
            .maybeSingle();
          if (unitError) throw unitError;
          // Fix round 1 (security review, LOW-4): same message whether the
          // unit doesn't exist or exists outside this teacher's scope — no
          // existence oracle on a model-supplied id.
          if (!unit) return "Curriculum unit not found, or not in your scope.";

          const allowed = await canGenerateQuizForUnit(supabase, ctx, unit.grade_id, unit.subject_id);
          if (!allowed) return "Curriculum unit not found, or not in your scope.";

          const [{ data: grade }, { data: subject }] = await Promise.all([
            supabase.from("grades").select("display_name").eq("id", unit.grade_id).maybeSingle(),
            supabase.from("subjects").select("name").eq("id", unit.subject_id).maybeSingle(),
          ]);

          const prompt = buildQuizPrompt({
            unitTitle: unit.title,
            unitDescription: unit.description,
            gradeLabel: grade?.display_name ?? "",
            subjectName: subject?.name ?? "",
            difficulty,
            questionCount,
          });

          const result = await runStructured({
            ctx,
            feature: "quiz_generation",
            agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
            schema: QuizGenerationSchema,
            instructions: QUIZ_GENERATION_INSTRUCTIONS,
            prompt,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          });
          if (!result.ok) return `Quiz generation failed: ${result.error.message}`;

          const strict = QuizContentSchema.safeParse(result.data.data);
          if (!strict.success) return "Quiz generation failed: the model's output didn't match the expected format.";

          return {
            draft: true,
            note: "This is a draft only, not saved — review and save it from Assignments, or use the save form in this chat.",
            curriculumUnitId,
            subjectId: unit.subject_id,
            defaultTitle: unit.title,
            questions: strict.data.questions,
          };
        } catch (err) {
          return toolErrorMessage("generateQuiz", err);
        }
      },
    }),

    draftResultRemark: tool({
      description:
        "Draft a report-card remark for a student's most recent (or named) exam result. This is not saved — the teacher must review and save it from the student's exam result.",
      inputSchema: z.object({ studentId: uuid, examName: z.string().trim().min(1).max(200).optional() }),
      execute: async ({ studentId, examName }) => {
        try {
          const { data: rows, error: resultsError } = await supabase
            .from("results")
            .select("id, student_id, snapshot, percentage, grade, exams(name), students(first_name, last_name)")
            .eq("institution_id", ctx.institution.id)
            .eq("student_id", studentId)
            .is("superseded_by", null)
            .order("published_at", { ascending: false })
            .limit(20);
          if (resultsError) throw resultsError;

          const candidate = (rows ?? []).find((row) => {
            if (!examName) return true;
            const exam = row.exams as { name: string } | null;
            return exam?.name?.toLowerCase() === examName.toLowerCase();
          });
          if (!candidate) {
            return examName
              ? `No exam result named "${examName}" found for this student.`
              : "No exam result found for this student.";
          }

          const allowed = await canDraftRemarkForResult(supabase, ctx, candidate.student_id);
          if (!allowed) return "You do not teach this student.";

          const snapshot = candidate.snapshot as {
            subjects: Array<{ subject_id: string; marks_obtained: number | null; max_marks: number; is_absent: boolean; grade: string | null }>;
          };
          const subjectIds = [...new Set(snapshot.subjects.map((s) => s.subject_id))];
          const { data: subjects, error: subjectsError } =
            subjectIds.length > 0
              ? await supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).in("id", subjectIds)
              : { data: [], error: null };
          if (subjectsError) throw subjectsError;
          const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));

          const exam = candidate.exams as { name: string } | null;
          const prompt = buildRemarkPrompt({
            examName: exam?.name ?? "",
            overallGrade: candidate.grade,
            percentage: candidate.percentage,
            subjects: snapshot.subjects.map((s) => ({
              subjectName: subjectNameById.get(s.subject_id) ?? "",
              marksObtained: s.marks_obtained,
              maxMarks: s.max_marks,
              isAbsent: s.is_absent,
              grade: s.grade,
            })),
          });

          const generated = await runStructured({
            ctx,
            feature: "result_remark_draft",
            agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
            schema: RemarkGenerationSchema,
            instructions: REMARK_GENERATION_INSTRUCTIONS,
            prompt,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          });
          if (!generated.ok) return `Remark draft failed: ${generated.error.message}`;

          // Same substitution as RemarkDraftEditor's own `handleGenerate`
          // (the model never sees the real name — `prompts/remark.ts`):
          // substituting a real name for the placeholder can push the text
          // past the 500-char save limit even though the model's draft
          // stayed under it with the short placeholder, so it's truncated
          // here too, before the model (or the chat UI) ever sees it.
          const student = candidate.students as { first_name: string; last_name: string | null } | null;
          const studentName = student ? [student.first_name, student.last_name].filter(Boolean).join(" ") : "this student";
          const remark = generated.data.data.remark.split("{studentLabel}").join(studentName).slice(0, 500);

          return {
            draft: true,
            note: "This is a draft only, not saved — review and save it from the student's exam result, or use the save form in this chat.",
            resultId: candidate.id,
            studentName,
            remark,
          };
        } catch (err) {
          return toolErrorMessage("draftResultRemark", err);
        }
      },
    }),
  };
}
