// Pure: which papers of an exam still miss marks, whose papers they are, and the daily reminders
// that follow (0154). Used by the exam page ("who has not submitted") and notify.marks_reminders.
// No imports: the job runner loads this file directly.

export interface PaperTeacher {
  staffId: string;
  /** The teacher's login; null for a staff record with no account (still named to the office). */
  userId: string | null;
  name: string;
}

export interface ProgressPaper {
  id: string;
  sectionId: string;
  subjectId: string;
  /** "11-A Physics" */
  label: string;
}

export interface PaperProgress {
  paperId: string;
  label: string;
  entered: number;
  total: number;
  done: boolean;
  teacher: PaperTeacher | null;
}

/** Each paper's count of entered marks against its section's active students; the teacher is the subject teacher, else the class teacher. */
export function marksProgress(
  papers: readonly ProgressPaper[],
  counts: ReadonlyMap<string, { entered: number; total: number }>,
  subjectTeachers: ReadonlyMap<string, PaperTeacher>,
  classTeachers: ReadonlyMap<string, PaperTeacher>,
): PaperProgress[] {
  return papers.map((p) => {
    const c = counts.get(p.id) ?? { entered: 0, total: 0 };
    const entered = Math.min(c.entered, c.total);
    return {
      paperId: p.id,
      label: p.label,
      entered,
      total: c.total,
      done: entered >= c.total,
      teacher: subjectTeachers.get(`${p.sectionId}:${p.subjectId}`) ?? classTeachers.get(p.sectionId) ?? null,
    };
  });
}

const DAY_MS = 86_400_000;

/** Whole days from `today` to `dueOn` (both YYYY-MM-DD); negative once the date has passed. */
export function daysLeft(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** Reminders start this many days before the due date and repeat daily while marks are missing. */
export const REMIND_DAYS_BEFORE = 2;
const SUMMARY_MAX = 300;
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });

export interface ReminderExam {
  id: string;
  name: string;
  dueOn: string;
}

export interface MarksReminder {
  recipientUserId: string;
  /** Idempotency with the recipient: one reminder per exam, day and audience. */
  entityId: string;
  summary: string;
}

const clip = (s: string) => (s.length <= SUMMARY_MAX ? s : `${s.slice(0, SUMMARY_MAX - 1)}…`);
const item = (p: PaperProgress) => `${p.label} (${p.entered}/${p.total})`;

/** Who to remind today: each teacher with missing papers (one message for all of theirs) and every office person (names who is late). */
export function marksReminders(
  exams: readonly ReminderExam[],
  progress: ReadonlyMap<string, readonly PaperProgress[]>,
  officeUserIds: readonly string[],
  today: string,
): MarksReminder[] {
  const out: MarksReminder[] = [];
  for (const exam of exams) {
    const left = daysLeft(exam.dueOn, today);
    if (left > REMIND_DAYS_BEFORE) continue;
    const pending = (progress.get(exam.id) ?? []).filter((p) => !p.done);
    if (pending.length === 0) continue;

    const day = dayFmt.format(new Date(`${exam.dueOn}T00:00:00Z`));
    const when = left > 0 ? `are due ${day}` : left === 0 ? "are due today" : `are ${-left} day${left === -1 ? "" : "s"} late (due ${day})`;

    // Group by teacher in paper order; papers with nobody assigned go last.
    const byTeacher = new Map<string, { teacher: PaperTeacher; papers: PaperProgress[] }>();
    const unassigned: PaperProgress[] = [];
    for (const p of pending) {
      if (!p.teacher) unassigned.push(p);
      else byTeacher.set(p.teacher.staffId, { teacher: p.teacher, papers: [...(byTeacher.get(p.teacher.staffId)?.papers ?? []), p] });
    }

    for (const { teacher, papers } of byTeacher.values()) {
      if (!teacher.userId) continue;
      out.push({
        recipientUserId: teacher.userId,
        entityId: `${exam.id}:${today}:teacher`,
        summary: clip(`${exam.name}: marks ${when} for ${papers.map(item).join(", ")}.`),
      });
    }

    const late = [
      ...[...byTeacher.values()].map(({ teacher, papers }) => `${teacher.name}: ${papers.map(item).join(", ")}`),
      ...(unassigned.length ? [`no teacher assigned: ${unassigned.map(item).join(", ")}`] : []),
    ];
    const officeSummary = clip(`${exam.name}: marks ${when}. Not submitted: ${late.join("; ")}.`);
    for (const userId of new Set(officeUserIds)) {
      out.push({ recipientUserId: userId, entityId: `${exam.id}:${today}:office`, summary: officeSummary });
    }
  }
  return out;
}
