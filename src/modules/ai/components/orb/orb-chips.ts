// Capability chips for the App Orb: every enabled AI capability gets one.
// Chat capabilities send a concrete starter prompt; page tasks link to the
// page that runs them (or fall back to the matching chat prompt).
import type { ModuleKey } from "@/lib/modules/catalog";
import { CAPABILITIES, type CapabilityKey } from "@/modules/ai/capabilities/catalog";
import type { OrbIconKey } from "./orb-icons";

export type OrbChipKind = "ask" | "create" | "open";

export interface OrbChip {
  key: string;
  label: string;
  kind: OrbChipKind;
  /** Icon on the orb, by the capability's module. */
  icon: OrbIconKey;
  /** Chat chips: the message sent on click. */
  prompt?: string;
  /** "open" chips: the page that runs the task. */
  href?: string;
}

type Starter = readonly ["ask" | "create", string];

// Record over every key: a new catalog capability fails typecheck until it gets a starter.
const STARTERS: Record<CapabilityKey, Starter> = {
  attendance_overview: ["ask", "Which sections are below the attendance threshold today?"],
  exam_overview: ["ask", "Show the grade distribution for the latest exam."],
  mastery_curriculum: ["ask", "Which subjects have the biggest mastery gaps?"],
  timetable_overview: ["ask", "Are there any timetable clashes or overloaded teachers this week?"],
  finance_overview: ["ask", "Summarise term fee collection and list the largest outstanding dues."],
  admissions_overview: ["ask", "How does the admissions funnel look this month, by stage?"],
  people_overview: ["ask", "Which staff are available today, and what approvals are pending?"],
  insights_forecasts: ["ask", "Which sections show at-risk indicators right now?"],
  calendar_notices: ["ask", "What's on the school calendar this week?"],
  navigate: ["ask", "Where in the app can I see fee collection?"],
  create_task: ["create", "Draft a follow-up task for the latest insight."],
  find_student: ["ask", "Find a student I teach by name or admission number."],
  curriculum_unit: ["ask", "Which curriculum units do I teach this term?"],
  attendance_pattern: ["ask", "Show this term's attendance pattern for a student I teach."],
  exam_results: ["ask", "Show the latest published exam results for a student I teach."],
  assignment_status: ["ask", "Which published assignments does a student I teach still have open?"],
  generate_quiz: ["create", "Generate a 5-question draft quiz for a unit I teach."],
  draft_remark: ["create", "Draft a report-card remark for a student I teach."],
  lesson_plan_draft: ["create", "Draft a 40-minute lesson plan for a curriculum unit I teach."],
  parent_message_draft: ["create", "Draft a short, warm message to a guardian about their child's progress."],
  differentiated_worksheet: ["create", "Plan one unit's worksheet at support, core and stretch levels."],
  study_curriculum: ["ask", "Which science units are in my grade this term?"],
  study_visuals: ["create", "Make a mind map and flashcards for my next science unit."],
  study_notebook: ["ask", "What have I saved in my study notebook so far?"],
  hints_first: ["ask", "Give me a hint, not the answer: how do I solve 3x + 5 = 20?"],
  weak_area_plan: ["create", "Make a one-week study plan for my weakest units."],
  study_language: ["ask", "Explain photosynthesis in Hindi, in simple words."],
  exam_prep: ["ask", "What should I revise first for my upcoming exams?"],
  child_attendance: ["ask", "How has my child's attendance been this term?"],
  child_results: ["ask", "Show my child's latest exam results."],
  child_fees: ["ask", "Show my child's invoices and anything still unpaid."],
  child_homework: ["ask", "What homework did my child get this week?"],
  explain_report_card: ["ask", "Explain my child's report card in plain language."],
  weekly_child_summary: ["ask", "Give me this week's summary for my child in five lines."],
  fee_explainer: ["ask", "Which fees are due next, by when, and how do I pay?"],
  translate_notices: ["create", "Translate the latest school notice into Hindi."],
  draft_leave_or_message: ["create", "Draft a leave request for my child for tomorrow."],
  do_it_in_chat: ["create", "Draft an announcement about next Friday's parent-teacher meeting."],
  weekly_report: ["create", "Write this week's one-page report: attendance, fees, insights, approvals."],
  fee_reminder_drafts: ["create", "Draft fee reminders for families with overdue invoices."],
  admissions_followups: ["create", "Draft follow-ups for open admission enquiries waiting over a week."],
  question_paper: ["create", "Draft a 50-mark question paper from the question bank for one unit."],
  grade_suggestions: ["create", "Suggest scores for the latest objective homework submissions."],
  mark_outlier_check: ["ask", "Check the latest exam for unusual marks before it is published."],
  quiz_generator: ["create", "Generate a 5-question draft quiz for a unit."],
  report_remark: ["create", "Draft a report-card remark from a student's latest result."],
  enquiry_reply: ["create", "Draft a reply to the newest admissions enquiry."],
  attendance_insight: ["ask", "Give me an attendance insight briefing for this week."],
  daily_briefing: ["ask", "Give me today's school briefing in five bullets."],
  practice_quiz: ["create", "Make me a 5-question practice quiz on my weakest unit."],
};

/** Institution-relative page that runs each page-level task (where its component is rendered). */
const TASK_PAGES: Partial<Record<CapabilityKey, string>> = {
  quiz_generator: "/assignments",
  report_remark: "/exams",
  enquiry_reply: "/admissions",
  attendance_insight: "/attendance",
  daily_briefing: "/dashboard",
  practice_quiz: "/portal/practice",
};

const MODULE_ICONS: Partial<Record<ModuleKey, OrbIconKey>> = {
  attendance: "CalendarCheck", exams: "GraduationCap", fees: "Banknote", finance_plus: "Banknote", admissions: "ClipboardList",
  timetable: "CalendarClock", assignments: "FileText", lesson_plans: "BookOpen", mastery: "Target", insights: "Lightbulb",
  messaging: "MessagesSquare", announcements: "Megaphone", calendar: "CalendarDays", people: "Users", question_bank: "ListChecks",
  practice: "Puzzle", diary: "NotebookPen", student_leave: "CalendarOff", website: "Globe", ai_briefings: "Sun", ai_student: "Book",
  ai_teacher: "Bot",
};

const ORDER: Record<OrbChipKind, number> = { ask: 0, create: 1, open: 2 };

export function orbChips(
  keys: readonly CapabilityKey[],
  opts: { slug: string; appHrefs: readonly string[]; chatOn: boolean },
): OrbChip[] {
  const chips: OrbChip[] = [];
  for (const key of keys) {
    const cap = CAPABILITIES[key];
    const [kind, prompt] = STARTERS[key];
    const page = cap.kind === "task" ? TASK_PAGES[key] : undefined;
    const href = page ? `/${opts.slug}${page}` : undefined;
    const icon = MODULE_ICONS[cap.module] ?? "Sparkles";
    if (href && opts.appHrefs.includes(href)) chips.push({ key, label: cap.label, kind: "open", icon, href });
    else if (opts.chatOn) chips.push({ key, label: cap.label, kind, icon, prompt });
  }
  return chips.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
