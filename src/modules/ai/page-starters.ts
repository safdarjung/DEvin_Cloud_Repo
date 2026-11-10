import type { Role } from "@/lib/auth/permissions";

// Starter questions for the Orb chat, keyed by the page the user came from.
// Every prompt maps to an existing chat tool for that audience
// (capabilities/catalog.ts); none asks for data the role cannot see.
// `pathname` is institution-relative ("/exams", not "/demo/exams").
type Audience = "staff" | "teacher" | "student" | "guardian";
// teacher omitted => same as staff; null => role default (page not meant for them).
type Rule = Partial<Record<Audience, readonly string[] | null>>;

const DEFAULTS: Record<Audience, readonly string[]> = {
  staff: ["Give me today's attendance summary.", "What's on the school calendar this week?", "Where in the app can I see fee collection?"],
  teacher: ["Show today's timetable.", "Find a student I teach.", "Draft a lesson plan for a curriculum unit I teach."],
  student: ["What should I revise for my upcoming exams?", "Make a short study plan for my weakest units.", "Find the curriculum unit for a topic in my grade."],
  guardian: ["Give me a weekly summary of my child.", "Show my child's attendance this term.", "What fees are due for my child?"],
};

const CALENDAR = ["What's on the school calendar this week?", "Which notices are published on the website?"];
const TEACHER_MSG = ["Draft a message to the guardian of a student I teach.", "What's on the school calendar this week?"];

const RULES: Record<string, Rule> = {
  "/dashboard": { staff: ["Give me today's attendance summary.", "Summarise term fee collection.", "Show the latest generated insights.", "What's on the school calendar this week?"] },
  "/today": { teacher: ["Show today's timetable.", "Summarise today's attendance.", "Draft a lesson plan for a curriculum unit I teach."] },
  "/students": {
    staff: ["Find a student by name or admission number.", "Which staff are available today?", "Show pending approvals."],
    teacher: ["Find a student I teach.", "Find a student I teach and show their attendance pattern this term."],
  },
  "/attendance": { staff: ["Give me today's attendance summary.", "Which sections are below the attendance threshold?", "How is the attendance trend looking?"] },
  "/assignments": {
    staff: ["Show recent assignment submissions.", "Show curriculum coverage by section."],
    teacher: ["Generate a draft quiz for a curriculum unit I teach.", "Find a student I teach and show their assignment status.", "Plan differentiated instruction for a unit at support, core and stretch levels."],
  },
  "/exams": {
    staff: ["List the exams this term.", "Show the grade distribution for the latest exam."],
    teacher: ["Find a student I teach and show their exam results.", "Draft a report-card remark for a student I teach.", "List the exams this term."],
  },
  "/lesson-plans": {
    staff: ["Show curriculum coverage by section.", "Which subjects have mastery gaps?"],
    teacher: ["Draft a lesson plan for a curriculum unit I teach.", "Find a curriculum unit by title.", "Plan differentiated instruction for a unit at support, core and stretch levels."],
  },
  "/question-bank": {
    staff: ["Show curriculum coverage by section.", "Which subjects have mastery gaps?"],
    teacher: ["Draft a question paper for chosen units and total marks.", "Generate a draft quiz for a curriculum unit I teach."],
  },
  "/timetable": {
    staff: ["Show a section's schedule.", "Are there any scheduling conflicts?", "How are rooms being used?", "Which teachers have the highest workload?"],
    teacher: ["Show my schedule.", "Are there any scheduling conflicts?"],
  },
  "/admissions": { staff: ["Show the admission funnel counts.", "How many enquiries are at each stage?", "Which applications have been submitted?"], teacher: null },
  "/finance": { staff: ["Summarise term fee collection.", "Which students have outstanding fees?"], teacher: null },
  "/website": { staff: CALENDAR },
  "/notifications": { staff: CALENDAR, teacher: TEACHER_MSG },
  "/messages": { staff: CALENDAR, teacher: TEACHER_MSG },
  "/diary": { staff: CALENDAR, teacher: TEACHER_MSG },
  "/ptm": { staff: CALENDAR, teacher: TEACHER_MSG },
  "/fabric": { staff: ["Show at-risk indicators by section.", "Show performance forecasts.", "Show the latest generated insights."], teacher: null },
  "/fabric/learning": { staff: ["Show curriculum coverage by section.", "Which subjects have mastery gaps?"] },
  "/fabric/students": { staff: ["Show at-risk indicators by section.", "Find a student and show their mastery gaps."] },
  "/fabric/operations": { staff: ["How are rooms being used?", "Which teachers have the highest workload?", "Are there any scheduling conflicts?"] },
  "/fabric/finance-intel": { staff: ["Summarise term fee collection.", "Which students have outstanding fees?"] },
  "/fabric/insights": { staff: ["Show the latest generated insights.", "Show at-risk indicators by section.", "Draft a follow-up task for an insight."] },
  "/portal": {
    student: ["What should I revise for my upcoming exams?", "Make a short study plan for my weakest units."],
    guardian: ["Give me a weekly summary of my child.", "Show my child's attendance this term."],
  },
  "/portal/subjects": { student: ["Find a curriculum unit in my grade by title.", "Make a short study plan for my weakest units."] },
  "/portal/study": { student: ["Explain a topic with notes and a mindmap.", "Make flashcards for a topic.", "Give me a hint first on a question I'm stuck on."] },
  "/portal/practice": { student: ["Make a practice quiz on a topic.", "What should I revise for my upcoming exams?"] },
  "/portal/assignments": {
    student: ["Give me a hint first on an assignment question I'm stuck on.", "Find the curriculum unit for a topic in my grade."],
    guardian: ["What homework did my child get recently?", "Show my child's class diary notes."],
  },
  "/portal/results": {
    student: ["What should I revise for my upcoming exams?", "Make a short study plan for my weakest units."],
    guardian: ["Explain my child's exam results in simple words.", "Show my child's published exam results."],
  },
  "/portal/attendance": { guardian: ["Show my child's attendance this term.", "How has my child's attendance been in the last 7 days?"] },
  "/portal/fees": { guardian: ["What fees are due for my child, and how do I pay?", "Show my child's invoice history."] },
  "/portal/updates": { guardian: ["Translate the latest school notice into Hindi.", "Give me a weekly summary of my child."] },
  "/portal/messages": { guardian: ["Draft a message to the school about my child.", "Draft a leave request for my child for tomorrow."] },
  "/portal/leave": { guardian: ["Draft a leave request for my child for tomorrow.", "Draft a message to the school about my child."] },
};

// Longest key first so "/fabric/insights" beats "/fabric".
const KEYS = Object.keys(RULES).sort((a, b) => b.length - a.length);

function audienceOf(role: Role): Audience {
  return role === "student" || role === "guardian" || role === "teacher" ? role : "staff";
}

export function starterPromptsFor(pathname: string, role: Role): string[] {
  const audience = audienceOf(role);
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const key = KEYS.find((k) => path === k || path.startsWith(`${k}/`));
  const rule = key ? RULES[key] : undefined;
  const own = rule?.[audience] ?? (audience === "teacher" && rule?.teacher === undefined ? rule?.staff : null);
  return [...(own ?? DEFAULTS[audience])];
}
