// Capability chips for the App Orb: every enabled AI capability gets one (orb-groups.ts sorts them into sections).
// Chat capabilities send a concrete starter prompt; page tasks link to the
// page that runs them (or fall back to the matching chat prompt).
import { CAPABILITIES, type CapabilityKey } from "@/modules/ai/capabilities/catalog";

export type OrbChipKind = "ask" | "create" | "open";

export interface OrbChip {
  key: string;
  label: string;
  kind: OrbChipKind;
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
  lab_scenario: ["create", "Turn a described what-if into simulator assumptions."],
  lab_explain: ["ask", "Explain which sections stand out from the school average."],
  lesson_plan_writer: ["create", "Draft a lesson plan for a curriculum unit I teach."],
  question_paper_builder: ["create", "Build a question paper for a unit I teach from the question bank."],
  fee_reminder_writer: ["create", "Draft a reminder for the oldest overdue fee invoice."],
  ptm_brief: ["create", "Prepare a parent-teacher meeting brief for a student I teach."],
  helpdesk_triage: ["create", "Suggest a category, priority and reply for the oldest open helpdesk ticket."],
  translate: ["create", "Translate my latest notice into Hindi."],
  form_draft: ["create", "Draft a consent form for next week's school trip."],
  substitution_note: ["create", "Write a handover note for today's substitute teachers."],
  clubs_overview: ["ask", "Which house leads the points table, and what club events are coming up?"],
  hostel_overview: ["ask", "How full are the hostel rooms right now?"],
  expenses_overview: ["ask", "Which expense categories are over budget this year?"],
  concessions_overview: ["ask", "How many concession requests are pending, and what value is approved by grade?"],
  canteen_overview: ["ask", "What sold most in the canteen today?"],
  inventory_overview: ["ask", "Which inventory items are low on stock?"],
  helpdesk_overview: ["ask", "How many helpdesk tickets are open or overdue?"],
  forms_overview: ["ask", "How many people have answered each of our open forms?"],
  alumni_overview: ["ask", "How many alumni do we have per batch year?"],
  payroll_overview: ["ask", "How has monthly payroll cost changed over recent months?"],
  labs_overview: ["ask", "Which labs are booked most, and do any have safety warnings?"],
  achievements_overview: ["ask", "Summarise this year's student achievements by category and level."],
  resources_overview: ["ask", "Which subjects have the fewest published resources?"],
  compliance_overview: ["ask", "Which compliance items are overdue or due soon?"],
  duties_overview: ["ask", "How many duties of each type are on the roster this week?"],
  safety_overview: ["ask", "Are there any active safety alerts, and who has acknowledged them?"],
  behaviour_points: ["ask", "Which students have the most merit points this term?"],
  library_overview: ["ask", "Which library loans are overdue?"],
  visitors_overview: ["ask", "Who visited the school today, and which gate passes are open?"],
  workflows_overview: ["ask", "Which automation workflows ran recently, and did any fail?"],
  child_activities: ["ask", "What achievements, resources and forms does my child have right now?"],
  my_activities: ["ask", "Which forms and library books do I need to deal with?"],
  lab_safety_note: ["ask", "Which lab chemicals are expired or hazardous right now?"],
  import_mapping: ["ask", "Which columns does the student import need?"],
  website_page_draft: ["create", "Draft an admissions page for our school website."],
  website_theme_draft: ["create", "Suggest a warm, traditional look for our school website."],
  workflow_draft: ["create", "Every school day at 10:00, tell me how many students are absent in X-A."],
  study_studio: ["create", "Make revision notes and flashcards for my next exam's units."],
  teacher_study_studio: ["create", "Draft a flashcard deck for a unit I teach and share it with my section."],
};

/** Institution-relative page that runs each page-level task (where its component is rendered); the first one in the person's apps wins. */
const TASK_PAGES: Partial<Record<CapabilityKey, string | readonly string[]>> = {
  quiz_generator: "/assignments",
  report_remark: "/exams",
  enquiry_reply: "/admissions",
  attendance_insight: "/attendance",
  // Teachers have /today instead of /dashboard.
  daily_briefing: ["/dashboard", "/today"],
  practice_quiz: "/portal/practice",
  lab_scenario: "/fabric/simulator",
  lab_explain: "/fabric/lab",
  lesson_plan_writer: "/lesson-plans",
  question_paper_builder: "/question-bank",
  fee_reminder_writer: "/finance/defaulters",
  ptm_brief: "/ptm",
  helpdesk_triage: "/helpdesk",
  form_draft: "/forms",
  substitution_note: "/staff",
  lab_safety_note: "/labs",
  // /setup has no nav item; the dashboard's setup checklist links to its step 3 (people import).
  import_mapping: "/dashboard",
  website_page_draft: "/website",
  website_theme_draft: "/website/theme",
  workflow_draft: "/fabric/workflows",
  study_studio: "/portal/study/studio",
  teacher_study_studio: "/study-studio",
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
    const pages = cap.kind === "task" ? [TASK_PAGES[key] ?? []].flat() : [];
    // A sub-page counts when its section is in the person's apps (e.g. /finance/defaulters under /finance).
    const href = pages.map((p) => `/${opts.slug}${p}`).find((h) => opts.appHrefs.some((a) => h === a || h.startsWith(`${a}/`)));
    if (href) chips.push({ key, label: cap.label, kind: "open", href });
    else if (opts.chatOn) chips.push({ key, label: cap.label, kind, prompt });
  }
  return chips.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
