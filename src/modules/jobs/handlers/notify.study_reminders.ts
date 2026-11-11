// notify.study_reminders — once per local day per institution
// (public.enqueue_study_reminders, 0138). In-app only, and only to students
// who use the study studio: flashcards due today, today's unfinished plan
// items, and an exam paper for their section within 3 days. Idempotent: the
// notification key is study_reminder:<student>:<IST day>:<user>.
import { createNotification } from "../../notifications/service.ts";
import { istDay } from "../../practice/scoring.ts";
import { DeckStateSchema, dueCardIds } from "../../study/srs.ts";
import type { JobHandler } from "../types.ts";

const EXAM_WINDOW_DAYS = 3;
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export const notifyStudyReminders: JobHandler = async (job, { admin }) => {
  const institutionId = job.institution_id;
  if (!institutionId) throw new Error("notify.study_reminders: missing institution_id");
  const now = new Date();
  const today = istDay(now);

  const [progress, plans] = await Promise.all([
    admin.from("study_deck_progress").select("student_id, state, study_materials(content)").eq("institution_id", institutionId),
    admin.from("study_plans").select("student_id, items").eq("institution_id", institutionId).eq("status", "active"),
  ]);
  if (progress.error || plans.error) throw progress.error ?? plans.error;

  const due = new Map<string, number>();
  for (const p of progress.data ?? []) {
    const content = (p.study_materials as { content: unknown } | null)?.content as { cards?: { id: string }[] } | null;
    const state = DeckStateSchema.safeParse(p.state);
    if (!state.success) continue;
    due.set(p.student_id, (due.get(p.student_id) ?? 0) + dueCardIds(content?.cards ?? [], state.data, today).length);
  }
  const todays = new Map<string, { label: string; minutes: number }[]>();
  for (const plan of plans.data ?? []) {
    const items = (Array.isArray(plan.items) ? plan.items : []) as { day?: string; done?: boolean; label?: string; minutes?: number }[];
    const open = items.filter((i) => i.day === today && !i.done).map((i) => ({ label: String(i.label ?? "Study"), minutes: Number(i.minutes ?? 0) }));
    if (open.length) todays.set(plan.student_id, open);
  }
  const studentIds = [...new Set([...due.keys(), ...todays.keys()])];
  if (studentIds.length === 0) return;

  const [enrolments, members] = await Promise.all([
    admin.from("enrolments").select("student_id, class_section_id").eq("institution_id", institutionId).eq("status", "active").in("student_id", studentIds),
    admin.from("memberships").select("user_id, student_id").eq("institution_id", institutionId).eq("role", "student").eq("status", "active").in("student_id", studentIds),
  ]);
  if (enrolments.error || members.error) throw enrolments.error ?? members.error;
  const sectionOf = new Map((enrolments.data ?? []).map((e) => [e.student_id, e.class_section_id]));
  const sectionIds = [...new Set(sectionOf.values())];
  const papers = sectionIds.length
    ? await admin
        .from("exam_papers")
        .select("class_section_id, scheduled_at, subjects(name), exams!inner(status)")
        .eq("institution_id", institutionId)
        .in("class_section_id", sectionIds)
        .neq("exams.status", "draft")
        .gte("scheduled_at", now.toISOString())
        .lt("scheduled_at", new Date(now.getTime() + EXAM_WINDOW_DAYS * 86_400_000).toISOString())
        .order("scheduled_at")
    : { data: [], error: null };
  if (papers.error) throw papers.error;

  for (const m of members.data ?? []) {
    if (!m.student_id) continue;
    const parts: string[] = [];
    const n = due.get(m.student_id) ?? 0;
    if (n > 0) parts.push(`${n} flashcard${n === 1 ? "" : "s"} due`);
    const plan = todays.get(m.student_id);
    if (plan?.length) parts.push(`Plan: ${plan[0]!.label} (${plan[0]!.minutes} min)${plan.length > 1 ? ` and ${plan.length - 1} more` : ""}`);
    const exam = (papers.data ?? []).find((p) => p.class_section_id === sectionOf.get(m.student_id!));
    if (exam?.scheduled_at) parts.push(`${(exam.subjects as { name: string } | null)?.name ?? "An"} exam on ${dayFmt.format(new Date(exam.scheduled_at))}`);
    if (parts.length === 0) continue;
    await createNotification(admin, {
      institutionId,
      recipientUserId: m.user_id,
      type: "study_reminder",
      entityId: `${m.student_id}:${today}`,
      vars: { summary: parts.join(" · ").slice(0, 300) },
    });
  }
};
