// "Which loose threads does your school run on?": the picker on the landing page. Each thread (a domain in
// story.ts) names the modules a school would switch on first to replace it. tests/unit/home-threads.test.ts
// pins every key to the real module catalog.
import { PROBLEMS, THREADS, type ThreadKey } from "./story.ts";

export const THREAD_MODULES: Readonly<Record<ThreadKey, readonly string[]>> = {
  attendance: ["attendance", "student_leave", "staff_attendance"],
  fees: ["fees", "fee_plans", "online_payments"],
  exams: ["exams", "question_bank", "exam_seating"],
  admissions: ["admissions", "website"],
  parents: ["announcements", "diary", "messaging", "ptm"],
  learning: ["practice", "ai_student", "mastery"],
  office: ["insights", "scheduled_reports", "ai_briefings"],
};

const KEYS = new Set<string>(THREADS.map((t) => t.key));

/** The thread keys in a `?threads=a,b` query value, in story order, unknown ones dropped. */
export function parseThreads(param: string | undefined): ThreadKey[] {
  const asked = new Set((param ?? "").split(",").filter((k) => KEYS.has(k)));
  return THREADS.map((t) => t.key).filter((k) => asked.has(k));
}

/** The message the contact form starts with when a visitor arrives from the picker; "" when nothing was picked. */
export function threadsMessage(param: string | undefined): string {
  const picked = parseThreads(param);
  if (picked.length === 0) return "";
  const artefacts = picked.map((k) => PROBLEMS.find((p) => p.thread === k)?.artefact.replace(/^The /, "the ")).filter(Boolean);
  return `We still run on ${artefacts.join(", ")}. We would like to see how Fabric replaces ${artefacts.length === 1 ? "it" : "them"}.`;
}
