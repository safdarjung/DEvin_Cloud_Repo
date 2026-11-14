// notify.marks_reminders — once per local day per institution (public.enqueue_marks_reminders,
// 0154). For every exam still in marks entry whose due date is at most 2 days away (or passed):
// each teacher with papers missing marks gets one in-app reminder listing them, and every
// exam.manage member (the exam office) gets one naming who has not submitted. Idempotent: the
// notification key is marks_reminder:<exam>:<IST day>:<teacher|office>:<user>.
import { ROLE_PERMISSIONS, type Role } from "../../../lib/auth/permissions.ts";
import { createNotification } from "../../notifications/service.ts";
import { istDay } from "../../practice/scoring.ts";
import { marksProgress, marksReminders, REMIND_DAYS_BEFORE, type PaperTeacher } from "../../exams/marks-progress.ts";
import type { JobHandler } from "../types.ts";

const OFFICE_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes("exam.manage"));

export const notifyMarksReminders: JobHandler = async (job, { admin }) => {
  const institutionId = job.institution_id;
  if (!institutionId) throw new Error("notify.marks_reminders: missing institution_id");
  const today = istDay(new Date());
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + REMIND_DAYS_BEFORE * 86_400_000).toISOString().slice(0, 10);

  const { data: exams, error: examsError } = await admin
    .from("exams")
    .select("id, name, marks_due_on")
    .eq("institution_id", institutionId)
    .eq("status", "marks_entry")
    .not("marks_due_on", "is", null)
    .lte("marks_due_on", horizon);
  if (examsError) throw examsError;
  if (!exams?.length) return;

  const examIds = exams.map((e) => e.id);
  const [papers, assignments, sections, members] = await Promise.all([
    admin
      .from("exam_papers")
      .select("id, exam_id, class_section_id, subject_id, subjects(name), class_sections(name, grades(code))")
      .eq("institution_id", institutionId)
      .in("exam_id", examIds),
    admin.from("subject_assignments").select("class_section_id, subject_id, staff(id, user_id, full_name)").eq("institution_id", institutionId),
    admin.from("class_sections").select("id, staff(id, user_id, full_name)").eq("institution_id", institutionId).not("class_teacher_id", "is", null),
    admin.from("memberships").select("user_id, role, staff_id").eq("institution_id", institutionId).eq("status", "active"),
  ]);
  for (const r of [papers, assignments, sections, members]) if (r.error) throw r.error;

  // A teacher's login is the membership linked to their staff row (staff.user_id is often unset).
  const loginOf = new Map((members.data ?? []).flatMap((m) => (m.staff_id ? [[m.staff_id, m.user_id] as const] : [])));
  const officeUserIds = (members.data ?? []).filter((m) => (OFFICE_ROLES as string[]).includes(m.role)).map((m) => m.user_id);
  type StaffRow = { id: string; user_id: string | null; full_name: string } | null;
  const asTeacher = (s: StaffRow): PaperTeacher | null => (s ? { staffId: s.id, userId: loginOf.get(s.id) ?? s.user_id, name: s.full_name } : null);
  const subjectTeachers = new Map<string, PaperTeacher>();
  for (const a of assignments.data ?? []) {
    const t = asTeacher(a.staff as StaffRow);
    if (t) subjectTeachers.set(`${a.class_section_id}:${a.subject_id}`, t);
  }
  const classTeachers = new Map<string, PaperTeacher>();
  for (const s of sections.data ?? []) {
    const t = asTeacher(s.staff as StaffRow);
    if (t) classTeachers.set(s.id, t);
  }

  const progress = new Map<string, ReturnType<typeof marksProgress>>();
  for (const exam of exams) {
    const { data: counts, error } = await admin.rpc("exam_marks_progress", { p_institution_id: institutionId, p_exam_id: exam.id });
    if (error) throw error;
    const examPapers = (papers.data ?? [])
      .filter((p) => p.exam_id === exam.id)
      .map((p) => {
        const section = p.class_sections as { name: string; grades: { code: string } | null } | null;
        const subject = p.subjects as { name: string } | null;
        return { id: p.id, sectionId: p.class_section_id, subjectId: p.subject_id, label: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"} ${subject?.name ?? ""}`.trim() };
      });
    progress.set(exam.id, marksProgress(examPapers, new Map((counts ?? []).map((c) => [c.paper_id, { entered: c.entered, total: c.total }])), subjectTeachers, classTeachers));
  }

  const reminders = marksReminders(
    exams.map((e) => ({ id: e.id, name: e.name, dueOn: e.marks_due_on as string })),
    progress,
    officeUserIds,
    today,
  );
  for (const r of reminders) {
    await createNotification(admin, { institutionId, recipientUserId: r.recipientUserId, type: "marks_reminder", entityId: r.entityId, vars: { summary: r.summary } });
  }
};
