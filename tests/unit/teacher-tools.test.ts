// T-0NN — scope-check behavior for the teacher tool-calling agent's tools
// (src/modules/ai/agent/teacher-tools.ts, D28). Each tool must never trust
// a model-supplied id on its own: it re-checks scope with the same
// functions the existing /api/ai/quiz and /api/ai/report-remark routes
// use, and returns a plain error STRING (not a thrown exception) when a
// lookup is out of scope or not found — same pattern as
// tests/unit/remark-scope.test.ts's hand-rolled fake Supabase builder.
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

const listStudentsMock = vi.fn();
const getStudentProfileMock = vi.fn();
const getCurrentTermIdMock = vi.fn();
const getSectionAttendancePatternsMock = vi.fn();
const canGenerateQuizForUnitMock = vi.fn();
const canDraftRemarkForResultMock = vi.fn();
const runStructuredMock = vi.fn();
const listStudentAssignmentsMock = vi.fn();

vi.mock("@/modules/people/queries", () => ({
  listStudents: listStudentsMock,
  getStudentProfile: getStudentProfileMock,
  getCurrentTermId: getCurrentTermIdMock,
}));
vi.mock("@/modules/attendance/queries", () => ({
  getSectionAttendancePatterns: getSectionAttendancePatternsMock,
}));
vi.mock("@/modules/academics/assignments.queries", () => ({
  listStudentAssignments: listStudentAssignmentsMock,
}));
vi.mock("@/modules/ai/quiz-scope", () => ({ canGenerateQuizForUnit: canGenerateQuizForUnitMock }));
vi.mock("@/modules/ai/remark-scope", () => ({ canDraftRemarkForResult: canDraftRemarkForResultMock }));
vi.mock("@/lib/ai/gateway", () => ({ runStructured: runStructuredMock }));

type TableData = Record<string, unknown[]>;

function fakeSupabase(tables: TableData) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        rows,
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        ilike() {
          return builder;
        },
        or() {
          return builder;
        },
        is() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          return { data: builder.rows[0] ?? null, error: null };
        },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return resolve({ data: builder.rows, error: null });
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase({})) }));

const { teacherTools } = await import("@/modules/ai/agent/teacher-tools");
const serverClient = await import("@/lib/supabase/server");

function baseCtx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Teacher", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(["ai.generate"]),
  } as unknown as TenantContext;
}

describe("teacherTools", () => {
  describe("findStudent", () => {
    it("returns an error string when no student matches", async () => {
      listStudentsMock.mockResolvedValueOnce({ students: [], total: 0, page: 1, pageSize: 50 });
      const tools = await teacherTools(baseCtx());
      const result = await tools.findStudent.execute!({ query: "nobody" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("No matching student found in your sections.");
    });

    it("returns up to 5 matches shaped for the model", async () => {
      listStudentsMock.mockResolvedValueOnce({
        students: [
          { id: "s1", admissionNo: "A1", firstName: "Aarav", lastName: "Sharma", status: "active", gradeName: "V", sectionName: "A" },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });
      const tools = await teacherTools(baseCtx());
      const result = await tools.findStudent.execute!({ query: "Aarav" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([{ id: "s1", name: "Aarav Sharma", grade: "V", section: "A" }]);
    });

    // Fix round 1 (security review, LOW-3): a raw DB/network error must
    // degrade to a generic string, never a thrown exception reaching Gemini.
    it("returns a generic error string, never throws, when the underlying query fails", async () => {
      listStudentsMock.mockRejectedValueOnce(new Error("connection reset"));
      const tools = await teacherTools(baseCtx());
      const result = await tools.findStudent.execute!({ query: "Aarav" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toMatch(/^Something went wrong looking that up\. Reference: /);
    });
  });

  describe("findCurriculumUnit", () => {
    it("filters out units outside the teacher's taught grade/subject", async () => {
      // Fix round 1 (security review, MED N+1): findCurriculumUnit now
      // batches the scope check via one `subject_assignments` query
      // (joined to `class_sections` for `grade_id`) instead of calling
      // `canGenerateQuizForUnit` per candidate row.
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          curriculum_units: [
            { id: "u1", title: "Photosynthesis", grade_id: "g1", subject_id: "sub1", grades: { display_name: "V" }, subjects: { name: "Science" } },
            { id: "u2", title: "Photosynthesis advanced", grade_id: "g2", subject_id: "sub2", grades: { display_name: "VI" }, subjects: { name: "Science" } },
          ],
          subject_assignments: [{ subject_id: "sub1", class_sections: { grade_id: "g1" } }],
        }),
      );

      const tools = await teacherTools(baseCtx());
      const result = await tools.findCurriculumUnit.execute!({ query: "Photo" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([{ id: "u1", title: "Photosynthesis", gradeLabel: "V", subjectName: "Science" }]);
    });

    it("returns an error string when nothing matches", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({ curriculum_units: [] }));
      const tools = await teacherTools(baseCtx());
      const result = await tools.findCurriculumUnit.execute!({ query: "nothing" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toMatch(/^No unit with that title in the classes and subjects you teach\. Do not stop here/);
    });

    it("matches a title said loosely, word by word", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          curriculum_units: [
            { id: "u1", title: "Metals and Non-metals", grade_id: "g1", subject_id: "sub1", grades: { display_name: "X" }, subjects: { name: "Science" } },
            { id: "u2", title: "Acids, Bases and Salts", grade_id: "g1", subject_id: "sub1", grades: { display_name: "X" }, subjects: { name: "Science" } },
          ],
          subject_assignments: [{ subject_id: "sub1", class_sections: { grade_id: "g1" } }],
        }),
      );
      const tools = await teacherTools(baseCtx());
      const result = await tools.findCurriculumUnit.execute!({ query: "chapter acid bases and salts" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([{ id: "u2", title: "Acids, Bases and Salts", gradeLabel: "X", subjectName: "Science" }]);
    });
  });

  describe("getAttendancePattern", () => {
    it("errors when the student is outside this teacher's scope", async () => {
      getStudentProfileMock.mockResolvedValueOnce(null);
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAttendancePattern.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("That student is not in your sections, or has no active enrolment.");
    });

    it("errors when the student has no active enrolment", async () => {
      getStudentProfileMock.mockResolvedValueOnce({ id: "s1", enrolment: null });
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAttendancePattern.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("That student is not in your sections, or has no active enrolment.");
    });

    it("returns counts for a student with attendance records this term", async () => {
      getStudentProfileMock.mockResolvedValueOnce({
        id: "s1",
        enrolment: { classSectionId: "sec1", academicYearId: "ay1" },
      });
      getCurrentTermIdMock.mockResolvedValueOnce("term1");
      getSectionAttendancePatternsMock.mockResolvedValueOnce({
        classTeacherId: "staff-1",
        students: [
          { studentId: "s1", name: "Aarav Sharma", presentCount: 40, absentCount: 2, lateCount: 1, recentAbsentDayOffsets: [3] },
        ],
      });
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAttendancePattern.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual({ presentCount: 40, absentCount: 2, lateCount: 1, recentAbsentDayOffsets: [3] });
    });
  });

  describe("getExamResults", () => {
    it("errors when the teacher does not teach this student", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          results: [{ id: "r1", student_id: "s1", snapshot: { subjects: [] }, percentage: 80, grade: "A", exams: { name: "Half-Yearly" } }],
        }),
      );
      canDraftRemarkForResultMock.mockResolvedValueOnce(false);
      const tools = await teacherTools(baseCtx());
      const result = await tools.getExamResults.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("You do not teach this student.");
    });

    it("errors when no exam result exists for the student", async () => {
      canDraftRemarkForResultMock.mockResolvedValueOnce(true);
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({ results: [] }));
      const tools = await teacherTools(baseCtx());
      const result = await tools.getExamResults.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("No exam results found for this student.");
    });

    it("returns per-subject marks for the matching results", async () => {
      canDraftRemarkForResultMock.mockResolvedValueOnce(true);
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          results: [
            {
              id: "r1",
              student_id: "s1",
              snapshot: { subjects: [{ subject_id: "sub1", marks_obtained: 80, max_marks: 100, is_absent: false, grade: "A" }] },
              percentage: 80,
              grade: "A",
              exams: { name: "Half-Yearly" },
            },
          ],
          subjects: [{ id: "sub1", name: "Science" }],
        }),
      );
      const tools = await teacherTools(baseCtx());
      const result = await tools.getExamResults.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([
        {
          examName: "Half-Yearly",
          percentage: 80,
          grade: "A",
          subjects: [{ subjectName: "Science", marksObtained: 80, maxMarks: 100, isAbsent: false, grade: "A" }],
        },
      ]);
    });
  });

  describe("getAssignmentStatus", () => {
    it("errors when the teacher does not teach this student", async () => {
      canDraftRemarkForResultMock.mockResolvedValueOnce(false);
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAssignmentStatus.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("You do not teach this student.");
    });

    it("errors when the student has no published assignments", async () => {
      canDraftRemarkForResultMock.mockResolvedValueOnce(true);
      listStudentAssignmentsMock.mockResolvedValueOnce([]);
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAssignmentStatus.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("No published assignments found for this student.");
    });

    it("returns title/subject/due date for each assignment", async () => {
      canDraftRemarkForResultMock.mockResolvedValueOnce(true);
      listStudentAssignmentsMock.mockResolvedValueOnce([
        {
          id: "a1",
          title: "Algebra basics",
          status: "published",
          classSectionId: "sec1",
          subjectId: "sub1",
          dueAt: "2026-11-01",
          aiGenerated: false,
          createdAt: "2026-10-01",
        },
      ]);
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({ subjects: [{ id: "sub1", name: "Maths" }] }));
      const tools = await teacherTools(baseCtx());
      const result = await tools.getAssignmentStatus.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([{ title: "Algebra basics", subjectName: "Maths", dueAt: "2026-11-01", aiGenerated: false }]);
    });
  });

  describe("generateQuiz", () => {
    it("errors when the teacher does not teach this subject/grade", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({ curriculum_units: [{ id: "u1", title: "Unit", description: null, grade_id: "g1", subject_id: "sub1" }] }),
      );
      canGenerateQuizForUnitMock.mockResolvedValueOnce(false);
      const tools = await teacherTools(baseCtx());
      const result = await tools.generateQuiz.execute!(
        { curriculumUnitId: "u1", difficulty: "easy", questionCount: 5 },
        { toolCallId: "1", messages: [], context: {} },
      );
      // Fix round 1 (security review, LOW-4): same message as "unit not
      // found" — no existence oracle on a model-supplied id.
      expect(result).toBe("Curriculum unit not found, or not in your scope.");
    });

    it("returns a labeled draft on success", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          curriculum_units: [{ id: "u1", title: "Unit", description: null, grade_id: "g1", subject_id: "sub1" }],
          grades: [{ display_name: "V" }],
          subjects: [{ name: "Science" }],
        }),
      );
      canGenerateQuizForUnitMock.mockResolvedValueOnce(true);
      const question = { stem: "Q1", options: ["A", "B", "C", "D"], answer: "A" };
      runStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { data: { questions: [question] }, provider: "cloud", model: "m", fallback: false },
      });
      const tools = await teacherTools(baseCtx());
      const result = await tools.generateQuiz.execute!(
        { curriculumUnitId: "u1", difficulty: "easy", questionCount: 1 },
        { toolCallId: "1", messages: [], context: {} },
      );
      expect(result).toMatchObject({
        draft: true,
        curriculumUnitId: "u1",
        subjectId: "sub1",
        defaultTitle: "Unit",
        questions: [question],
      });
    });
  });

  describe("draftResultRemark", () => {
    it("errors when no exam result exists for the student", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({ results: [] }));
      const tools = await teacherTools(baseCtx());
      const result = await tools.draftResultRemark.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("No exam result found for this student.");
    });

    it("errors when the teacher does not teach this student", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          results: [{ id: "r1", student_id: "s1", snapshot: { subjects: [] }, percentage: 80, grade: "A", exams: { name: "Half-Yearly" } }],
        }),
      );
      canDraftRemarkForResultMock.mockResolvedValueOnce(false);
      const tools = await teacherTools(baseCtx());
      const result = await tools.draftResultRemark.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("You do not teach this student.");
    });

    it("returns a labeled draft, substituting the real student name for the placeholder", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          results: [
            {
              id: "r1",
              student_id: "s1",
              snapshot: { subjects: [{ subject_id: "sub1", marks_obtained: 80, max_marks: 100, is_absent: false, grade: "A" }] },
              percentage: 80,
              grade: "A",
              exams: { name: "Half-Yearly" },
              students: { first_name: "Aarav", last_name: "Sharma" },
            },
          ],
          subjects: [{ id: "sub1", name: "Science" }],
        }),
      );
      canDraftRemarkForResultMock.mockResolvedValueOnce(true);
      runStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { data: { remark: "{studentLabel} did great work." }, provider: "cloud", model: "m", fallback: false },
      });
      const tools = await teacherTools(baseCtx());
      const result = await tools.draftResultRemark.execute!({ studentId: "s1" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toMatchObject({ draft: true, resultId: "r1", studentName: "Aarav Sharma", remark: "Aarav Sharma did great work." });
    });
  });
});
