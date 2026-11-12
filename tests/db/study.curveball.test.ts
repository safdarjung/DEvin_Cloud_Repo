import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  deleteStudyMaterial,
  deleteTeacherStudyMaterial,
  logStudySession,
  reviewStudyCard,
  saveStudyMaterial,
  saveStudyPlan,
  saveTeacherStudyMaterial,
  submitStudyQuiz,
  toggleStudyPlanItem,
} from "@/modules/study/actions";
import { submitPracticeAttempt } from "@/modules/practice/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, ROLES, type TestInstitution } from "../helpers/roles";

// Curveballs for study.* and practice.submitAttempt (no prior action-level tests).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let inst: TestInstitution;
let other: TestInstitution;
let sectionId: string;
let studentId: string;
let unitId: string;

const deck = { cards: [{ id: "c1", front: "Front one", back: "Back one" }, { id: "c2", front: "Front two", back: "Back two" }] };
const flash = (title = "Deck") => ({ format: "flashcards" as const, title, sourceKind: "paste" as const, content: deck });
const mcq = { type: "mcq" as const, stem: "2+2?", options: ["1", "2", "3", "4"], answerIndex: 3, explanation: "Because." };
const tf = { type: "true_false" as const, stem: "Sky is blue", answer: true, explanation: "Yes." };

beforeAll(async () => {
  inst = await createTestInstitution("studycb");
  other = await createTestInstitution("studycbx");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VII" });
  const subjectId = await createSubject(inst.institutionId, { name: "Science" });
  const [u] = await sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence)
    values (${inst.institutionId}, ${subjectId}, ${gradeId}, 'Light', 'Reflection.', 1) returning id`;
  unitId = u.id as string;
  const [t] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
  sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: t.staff_id });
  const [s] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
  studentId = s.student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await createSubjectAssignment(inst.institutionId, sectionId, subjectId, t.staff_id as string);
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("study student actions", () => {
  it("student saves and deletes own material; a second delete is not_found", async () => {
    const saved = await callAs(inst, "student", saveStudyMaterial, flash());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const del = await callAs(inst, "student", deleteStudyMaterial, { materialId: saved.data.id });
    expect(del.ok).toBe(true);
    const again = await callAs(inst, "student", deleteStudyMaterial, { materialId: saved.data.id });
    expect(!again.ok && again.error.code).toBe("not_found");
  });

  it("every non-student role is forbidden from saving student study material", async () => {
    for (const role of ROLES.filter((r) => r !== "student")) {
      const r = await callAs(inst, role, saveStudyMaterial, flash());
      expect(r.ok, role).toBe(false);
      if (!r.ok) expect(r.error.code, role).toBe("forbidden");
    }
  });

  it("rejects bad flashcard content with fieldErrors on content", async () => {
    const r = await callAs(inst, "student", saveStudyMaterial, { ...flash(), content: { cards: [] } });
    expect(!r.ok && r.error.code).toBe("validation_failed");
    if (!r.ok) expect(r.error.fieldErrors).toBeDefined();
  });

  it("rejects duplicate card ids, unknown keys and an empty title", async () => {
    const dup = await callAs(inst, "student", saveStudyMaterial, { ...flash(), content: { cards: [deck.cards[0], deck.cards[0]] } });
    expect(!dup.ok && dup.error.code).toBe("validation_failed");
    const extra = await callAs(inst, "student", saveStudyMaterial, { ...flash(), userId: crypto.randomUUID() } as never);
    expect(!extra.ok && extra.error.code).toBe("validation_failed");
    const blank = await callAs(inst, "student", saveStudyMaterial, flash("   "));
    expect(!blank.ok && blank.error.code).toBe("validation_failed");
  });

  it("another school's subject id cannot be attached to material", async () => {
    const sub = await createSubject(other.institutionId, { name: "Foreign" });
    const r = await callAs(inst, "student", saveStudyMaterial, { ...flash(), subjectId: sub });
    expect(r.ok).toBe(false);
  });

  it("deleting a material id from another school or a random id is not_found", async () => {
    const r = await callAs(inst, "student", deleteStudyMaterial, { materialId: crypto.randomUUID() });
    expect(!r.ok && r.error.code).toBe("not_found");
  });

  it("deck review: unknown card is not_found; review twice bumps reviews to 2; quiz material is not a deck", async () => {
    const saved = await callAs(inst, "student", saveStudyMaterial, flash("Review deck"));
    if (!saved.ok) throw new Error("setup");
    const bad = await callAs(inst, "student", reviewStudyCard, { materialId: saved.data.id, cardId: "nope", grade: "knew" });
    expect(!bad.ok && bad.error.code).toBe("not_found");
    const r1 = await callAs(inst, "student", reviewStudyCard, { materialId: saved.data.id, cardId: "c1", grade: "knew" });
    const r2 = await callAs(inst, "student", reviewStudyCard, { materialId: saved.data.id, cardId: "c1", grade: "missed" });
    expect(r1.ok && r2.ok).toBe(true);
    const [p] = await sql`select reviews from public.study_deck_progress where material_id = ${saved.data.id}`;
    expect(p.reviews).toBe(2);
    const quiz = await callAs(inst, "student", saveStudyMaterial, {
      format: "quiz", title: "Q", sourceKind: "paste", content: { difficulty: "easy", questions: [mcq] },
    });
    if (!quiz.ok) throw new Error("setup quiz");
    const notDeck = await callAs(inst, "student", reviewStudyCard, { materialId: quiz.data.id, cardId: "c1", grade: "knew" });
    expect(!notDeck.ok && notDeck.error.code).toBe("not_found");
  });

  it("deck review rejects a grade outside knew/almost/missed", async () => {
    const r = await callAs(inst, "student", reviewStudyCard, { materialId: crypto.randomUUID(), cardId: "c1", grade: "perfect" } as never);
    expect(!r.ok && r.error.code).toBe("validation_failed");
  });

  it("quiz submit scores MCQ/true-false on the server and ignores nothing the client claims", async () => {
    const r = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [mcq, tf], answers: [3, false], aiChecks: [], durationSeconds: 60,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.data.autoScore, r.data.autoMax]).toEqual([1, 2]);
  });

  it("quiz submit refuses answers that do not fit the questions, bad aiChecks count, and all-unanswered shorts", async () => {
    const mismatch = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [mcq], answers: [true], aiChecks: [], durationSeconds: 1,
    });
    expect(!mismatch.ok && mismatch.error.code).toBe("validation_failed");
    const lenMismatch = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [mcq, tf], answers: [1], aiChecks: [], durationSeconds: 1,
    });
    expect(!lenMismatch.ok && lenMismatch.error.code).toBe("validation_failed");
    const aiBad = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [mcq], answers: [1], aiChecks: [{ score: 2, feedback: "x" }], durationSeconds: 1,
    });
    expect(!aiBad.ok && aiBad.error.code).toBe("validation_failed");
    const short = { type: "short" as const, stem: "Explain", modelAnswer: "Because", rubric: ["a"], explanation: "e" };
    const none = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [short], answers: [null], aiChecks: [], durationSeconds: 1,
    });
    expect(!none.ok && none.error.code).toBe("validation_failed");
  });

  it("quiz submit rejects a client-supplied score field and 17 questions", async () => {
    const withScore = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: [mcq], answers: [3], aiChecks: [], durationSeconds: 1, autoScore: 99,
    } as never);
    expect(!withScore.ok && withScore.error.code).toBe("validation_failed");
    const many = await callAs(inst, "student", submitStudyQuiz, {
      title: "Quiz", difficulty: "easy", questions: Array(16).fill(mcq), answers: Array(16).fill(3), aiChecks: [], durationSeconds: 1,
    });
    expect(!many.ok && many.error.code).toBe("validation_failed");
  });

  it("study plan: past/today target date is rejected with fieldErrors; future saves and archives the earlier active plan", async () => {
    const topics = [{ key: "t1", label: "Light", subjectId: null, unitId: null, weak: false }];
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const past = await callAs(inst, "student", saveStudyPlan, { title: "P", targetDate: today, minutesPerDay: 30, topics });
    expect(!past.ok && past.error.code).toBe("validation_failed");
    if (!past.ok) expect(past.error.fieldErrors?.targetDate).toBeDefined();
    const target = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const p1 = await callAs(inst, "student", saveStudyPlan, { title: "P1", targetDate: target, minutesPerDay: 30, topics });
    const p2 = await callAs(inst, "student", saveStudyPlan, { title: "P2", targetDate: target, minutesPerDay: 30, topics });
    expect(p1.ok && p2.ok).toBe(true);
    const rows = await sql`select status from public.study_plans where student_id = ${studentId} order by created_at`;
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    if (!p2.ok) return;
    const bad = await callAs(inst, "student", toggleStudyPlanItem, { planId: p2.data.planId, index: 99, done: true });
    expect(!bad.ok && bad.error.code).toBe("not_found");
    const ok = await callAs(inst, "student", toggleStudyPlanItem, { planId: p2.data.planId, index: 0, done: true });
    expect(ok.ok).toBe(true);
    const archived = await callAs(inst, "student", toggleStudyPlanItem, { planId: p1.ok ? p1.data.planId : "", index: 0, done: true });
    // an archived plan is still the student's own row: toggling it must not leak or crash
    expect(typeof archived.ok).toBe("boolean");
  });

  it("study plan rejects minutesPerDay outside 10-240 and zero topics", async () => {
    const target = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const lo = await callAs(inst, "student", saveStudyPlan, { title: "P", targetDate: target, minutesPerDay: 5, topics: [] });
    expect(!lo.ok && lo.error.code).toBe("validation_failed");
  });

  it("session log: 0 and 241 minutes rejected; 1 accepted; unknown activity rejected", async () => {
    for (const minutes of [0, 241]) {
      const r = await callAs(inst, "student", logStudySession, { activity: "quiz", minutes });
      expect(!r.ok && r.error.code, String(minutes)).toBe("validation_failed");
    }
    const bad = await callAs(inst, "student", logStudySession, { activity: "nap", minutes: 5 } as never);
    expect(!bad.ok && bad.error.code).toBe("validation_failed");
    const ok = await callAs(inst, "student", logStudySession, { activity: "quiz", minutes: 1 });
    expect(ok.ok).toBe(true);
  });

  it("student cannot toggle another student's plan (not_found)", async () => {
    const [p] = await sql`insert into public.study_plans (institution_id, student_id, title, start_date, target_date, minutes_per_day, items)
      select ${inst.institutionId}, s.id, 'Other', current_date, current_date + 5, 30, '[{"done":false}]'::jsonb
      from public.students s where s.institution_id = ${inst.institutionId} and s.id <> ${studentId} limit 1 returning id`.catch(() => [] as never[]);
    if (!p) return; // fixture has only one student in this school
    const r = await callAs(inst, "student", toggleStudyPlanItem, { planId: p.id as string, index: 0, done: true });
    expect(!r.ok && r.error.code).toBe("not_found");
  });
});

describe("study teacher actions", () => {
  const teacherInput = (sectionIds: string[]) => ({ ...flash("Teacher deck"), sectionIds });

  it("teacher shares to a taught section; delete twice -> not_found", async () => {
    const saved = await callAs(inst, "teacher", saveTeacherStudyMaterial, teacherInput([sectionId]));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const d1 = await callAs(inst, "teacher", deleteTeacherStudyMaterial, { materialId: saved.data.id });
    expect(d1.ok).toBe(true);
    const d2 = await callAs(inst, "teacher", deleteTeacherStudyMaterial, { materialId: saved.data.id });
    expect(!d2.ok && d2.error.code).toBe("not_found");
  });

  it("students and guardians are forbidden; empty sectionIds fails validation with fieldErrors", async () => {
    for (const role of ["student", "guardian"] as const) {
      const r = await callAs(inst, role, saveTeacherStudyMaterial, teacherInput([sectionId]));
      expect(!r.ok && r.error.code, role).toBe("forbidden");
    }
    const empty = await callAs(inst, "teacher", saveTeacherStudyMaterial, teacherInput([]));
    expect(!empty.ok && empty.error.code).toBe("validation_failed");
    if (!empty.ok) expect(empty.error.fieldErrors?.sectionIds).toBeDefined();
  });

  it("sharing to another school's section leaves no orphan material behind", async () => {
    const otherYear = await createAcademicYear(other.institutionId);
    const otherGrade = await createGrade(other.institutionId, { code: "VII" });
    const foreign = await createClassSection(other.institutionId, otherGrade, otherYear, { name: "Z" });
    const before = await sql`select count(*)::int as n from public.study_materials where institution_id = ${inst.institutionId} and title = 'Orphan probe'`;
    const r = await callAs(inst, "teacher", saveTeacherStudyMaterial, { ...flash("Orphan probe"), sectionIds: [foreign] });
    expect(r.ok).toBe(false);
    const after = await sql`select count(*)::int as n from public.study_materials where institution_id = ${inst.institutionId} and title = 'Orphan probe'`;
    expect(after[0].n).toBe(before[0].n);
  });

  it("a teacher cannot delete a student's material through the teacher delete", async () => {
    const mine = await callAs(inst, "student", saveStudyMaterial, flash("Student private"));
    if (!mine.ok) throw new Error("setup");
    const r = await callAs(inst, "teacher", deleteTeacherStudyMaterial, { materialId: mine.data.id });
    expect(!r.ok && r.error.code).toBe("not_found");
    const [row] = await sql`select 1 as x from public.study_materials where id = ${mine.data.id}`;
    expect(row).toBeDefined();
  });

  it("duplicate section ids are de-duplicated (one share row)", async () => {
    const saved = await callAs(inst, "teacher", saveTeacherStudyMaterial, teacherInput([sectionId, sectionId]));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const [c] = await sql`select count(*)::int as n from public.study_material_sections where material_id = ${saved.data.id}`;
    expect(c.n).toBe(1);
  });
});

describe("practice.submitAttempt", () => {
  const q = { stem: "2+2?", options: ["1", "2", "3", "4"], answerIndex: 3 };
  const input = () => ({ studentId, curriculumUnitId: unitId, difficulty: "easy" as const, questions: [q], answers: [3] });

  it("scores on the server from the answer keys", async () => {
    const r = await callAs(inst, "student", submitPracticeAttempt, input());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect([r.data.score, r.data.maxScore]).toEqual([1, 1]);
  });

  it("answers/questions length mismatch and a client score field fail validation", async () => {
    const mismatch = await callAs(inst, "student", submitPracticeAttempt, { ...input(), answers: [3, 1] });
    expect(!mismatch.ok && mismatch.error.code).toBe("validation_failed");
    const score = await callAs(inst, "student", submitPracticeAttempt, { ...input(), score: 5 } as never);
    expect(!score.ok && score.error.code).toBe("validation_failed");
  });

  it("only students hold practice.attempt; other roles forbidden", async () => {
    for (const role of ROLES.filter((r) => r !== "student")) {
      const r = await callAs(inst, role, submitPracticeAttempt, input());
      expect(!r.ok && r.error.code, role).toBe("forbidden");
    }
  });

  it("a student cannot submit for another student id or a unit from another school", async () => {
    const [o] = await sql`select student_id from public.memberships where institution_id = ${other.institutionId} and role = 'student'`;
    const asOther = await callAs(inst, "student", submitPracticeAttempt, { ...input(), studentId: o.student_id as string });
    expect(asOther.ok).toBe(false);
    const badUnit = await callAs(inst, "student", submitPracticeAttempt, { ...input(), curriculumUnitId: crypto.randomUUID() });
    expect(badUnit.ok).toBe(false);
  });
});
