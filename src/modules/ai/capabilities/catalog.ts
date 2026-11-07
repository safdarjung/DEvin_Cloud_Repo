// T1b (ai-roles) — the capability catalog: one entry per thing the AI can
// do today, mapped from the existing assistant/teacher/student tool sets
// and the task routes (`api/ai/*`). `roles` is a hard code-only ceiling
// (BRIEF-COMMON security lesson #1 — a shared permission can be broader
// than one role's actual view, e.g. `attendance.read` also belongs to
// student/guardian for their OWN record, so staff-wide capabilities list
// only the roles that may see other people's rows via this capability).
// `permission` is an extra floor on top of the ceiling; the underlying
// registry query/action re-checks its own permission regardless (M22/M24),
// so this field never widens access, only narrows which roles reach it at
// all today.
import type { ModuleKey } from "@/lib/modules/catalog";
import type { Permission, Role } from "@/lib/auth/permissions";
import type { FeatureKey } from "@/lib/auth/entitlements";

export type CapabilityKind = "chat_tool" | "task";
export type CapabilityData = "aggregate" | "personal" | "own";

export interface Capability {
  key: CapabilityKey;
  label: string;
  description: string;
  kind: CapabilityKind;
  roles: readonly Role[];
  permission: Permission;
  module: ModuleKey;
  data: CapabilityData;
  defaultOn: readonly Role[];
  queries?: readonly string[];
  tools?: readonly string[];
  legacyFeature?: FeatureKey;
}

// Staff roles whose AI uses the school assistant read groups. Accountant and
// exam_controller joined with the AI-roles ADR (owner decision 2026-11-07);
// their AI is off by default, and each query still re-checks its own
// permission and runs under the caller's RLS. Student/guardian never get a
// staff-wide read: they use their own `own` capabilities below.
const ASSISTANT_ROLES: readonly Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"];

export const CAPABILITY_KEYS = [
  // Staff assistant read groups (src/modules/ai/assistant/catalog.ts domains)
  "attendance_overview",
  "exam_overview",
  "mastery_curriculum",
  "timetable_overview",
  "finance_overview",
  "admissions_overview",
  "people_overview",
  "insights_forecasts",
  "calendar_notices",
  // Staff assistant custom tools
  "navigate",
  "create_task",
  // Teacher agent tools (src/modules/ai/agent/teacher-tools.ts)
  "find_student",
  "curriculum_unit",
  "attendance_pattern",
  "exam_results",
  "assignment_status",
  "generate_quiz",
  "draft_remark",
  // Student study chat (src/modules/ai/agent/student-tools.ts + notebook feature)
  "study_curriculum",
  "study_visuals",
  "study_notebook",
  // Guardian child reads (a student id the guardian's own permissions pass)
  "child_attendance",
  "child_results",
  "child_fees",
  "child_homework",
  // Page-level AI tasks (api/ai/* routes)
  "quiz_generator",
  "report_remark",
  "enquiry_reply",
  "attendance_insight",
  "daily_briefing",
  "practice_quiz",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const CAPABILITIES: Readonly<Record<CapabilityKey, Capability>> = {
  // ---- Staff assistant read groups ----------------------------------
  attendance_overview: {
    key: "attendance_overview",
    label: "Attendance",
    description: "Today's attendance summary, sections below threshold, the attendance trend, and a named student's attendance/pattern.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "attendance.read",
    module: "attendance",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: [
      "attendance.attendanceTodaySummary",
      "attendance.sectionsBelowThreshold",
      "dashboard.attendanceTrend",
      "attendance.getStudentAttendanceSummary",
      "attendance.getSectionAttendancePatterns",
    ],
  },
  exam_overview: {
    key: "exam_overview",
    label: "Exams",
    description: "Exam list, grade distribution, subject/section/term options, and a named student's or exam's results.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "exam.result.read",
    module: "exams",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: [
      "exams.listExams",
      "exams.examGradeDistribution",
      "exams.listSubjectOptions",
      "exams.listSectionOptions",
      "exams.listTermOptions",
      "exams.listResultsForStudent",
      "exams.listResultsForExam",
    ],
  },
  mastery_curriculum: {
    key: "mastery_curriculum",
    label: "Mastery & curriculum",
    description: "Subject mastery heatmap, curriculum coverage by section, and a named student's mastery gaps/success rows.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "mastery.read",
    module: "mastery",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: [
      "mastery.heatmapBySection",
      "curriculum.coverageBySection",
      "mastery.gapsForStudent",
      "mastery.studentSuccessRows",
    ],
  },
  timetable_overview: {
    key: "timetable_overview",
    label: "Timetable",
    description: "Room utilisation and a section's/teacher's schedule, teacher workload, and scheduling conflicts.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "timetable.read",
    module: "timetable",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: [
      "timetable.roomUtilisation",
      "timetable.forSection",
      "timetable.forTeacher",
      "timetable.teacherWorkload",
      "timetable.conflicts",
    ],
  },
  finance_overview: {
    key: "finance_overview",
    label: "Finance",
    description: "Term fee collection summary and report, students with outstanding fees, and a named student's invoices.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "finance.read",
    module: "fees",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: ["finance.termCollectionSummary", "finance.collectionReport", "finance.listDefaulters", "finance.listInvoicesForStudent"],
  },
  admissions_overview: {
    key: "admissions_overview",
    label: "Admissions",
    description: "Admission funnel counts, enquiries by stage, and submitted applications.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "admissions.enquiry.read",
    module: "admissions",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: ["admissions.getAdmissionsFunnelCounts", "admissions.listEnquiriesByStage", "admissions.listApplications"],
  },
  // ASSISTANT_QUERIES has no dedicated "approvals" or "assignments" domain
  // — core.approvals.pending and academics.submissionsForAssignment are
  // folded in here as the closest fit (both are people/ops lookups).
  people_overview: {
    key: "people_overview",
    label: "People",
    description: "Student directory, a student's profile, staff availability today, pending approvals, and assignment submissions.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "student.read",
    module: "people",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: [
      "people.listStudents",
      "people.getStudentProfile",
      "people.staffAvailabilityToday",
      "core.approvals.pending",
      "academics.submissionsForAssignment",
    ],
  },
  insights_forecasts: {
    key: "insights_forecasts",
    label: "Insights & forecasts",
    description: "At-risk indicators by section, performance forecasts, and generated insights.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "insight.read",
    module: "insights",
    data: "personal",
    defaultOn: ASSISTANT_ROLES,
    queries: ["insights.riskIndicators", "forecasts.cards", "insights.list"],
  },
  calendar_notices: {
    key: "calendar_notices",
    label: "Calendar & notices",
    description: "School calendar events and published website notices.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "academics.read",
    module: "calendar",
    data: "aggregate",
    defaultOn: ASSISTANT_ROLES,
    queries: ["calendar.forRole", "website.listNotices"],
  },

  // ---- Staff assistant custom tools ----------------------------------
  navigate: {
    key: "navigate",
    label: "Navigate",
    description: "Give the person a link to a page they can already see in this app.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "ai.chat",
    module: "core",
    data: "aggregate",
    defaultOn: ASSISTANT_ROLES,
    tools: ["navigate"],
  },
  create_task: {
    key: "create_task",
    label: "Draft a follow-up task",
    description: "Draft a follow-up task for an insight. Nothing is saved until the person reviews and presses Save.",
    kind: "chat_tool",
    roles: ASSISTANT_ROLES,
    permission: "insight.review",
    module: "insights",
    data: "aggregate",
    defaultOn: ASSISTANT_ROLES,
    tools: ["createTask"],
  },

  // ---- Teacher agent tools --------------------------------------------
  find_student: {
    key: "find_student",
    label: "Find student",
    description: "Find a student this teacher teaches, by name or admission number.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "student.read",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["teacher"],
    tools: ["findStudent"],
  },
  curriculum_unit: {
    key: "curriculum_unit",
    label: "Find curriculum unit",
    description: "Find a curriculum unit by title, limited to subjects and grades this teacher teaches.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "academics.read",
    module: "ai_teacher",
    data: "aggregate",
    defaultOn: ["teacher"],
    tools: ["findCurriculumUnit"],
  },
  attendance_pattern: {
    key: "attendance_pattern",
    label: "Student attendance pattern",
    description: "Get a taught student's attendance pattern for the current term.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "attendance.read",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["teacher"],
    tools: ["getAttendancePattern"],
  },
  exam_results: {
    key: "exam_results",
    label: "Student exam results",
    description: "Look up a taught student's published exam results.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "exam.result.read",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["teacher"],
    tools: ["getExamResults"],
  },
  assignment_status: {
    key: "assignment_status",
    label: "Student assignment status",
    description: "List a taught student's published assignments.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "assignment.read",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["teacher"],
    tools: ["getAssignmentStatus"],
  },
  generate_quiz: {
    key: "generate_quiz",
    label: "Generate quiz",
    description: "Generate a draft multiple-choice quiz for a curriculum unit. Not saved until reviewed.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "assignment.manage",
    module: "ai_teacher",
    data: "aggregate",
    defaultOn: ["teacher"],
    tools: ["generateQuiz"],
  },
  draft_remark: {
    key: "draft_remark",
    label: "Draft result remark",
    description: "Draft a report-card remark for a taught student's exam result. Not saved until reviewed.",
    kind: "chat_tool",
    roles: ["teacher"],
    permission: "exam.marks.enter",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["teacher"],
    tools: ["draftResultRemark"],
  },

  // ---- Student study chat ---------------------------------------------
  study_curriculum: {
    key: "study_curriculum",
    label: "Find curriculum unit",
    description: "Find a curriculum unit in the student's own grade by title.",
    kind: "chat_tool",
    roles: ["student"],
    permission: "ai.study",
    module: "ai_student",
    data: "own",
    defaultOn: ["student"],
    tools: ["findMyCurriculumUnit"],
  },
  study_visuals: {
    key: "study_visuals",
    label: "Study visuals",
    description: "Show visual study blocks (notes, mindmap, chart, flashcards, practice quiz, callout) alongside the reply.",
    kind: "chat_tool",
    roles: ["student"],
    permission: "ai.study",
    module: "ai_student",
    data: "own",
    defaultOn: [],
    legacyFeature: "student_ai_visuals",
    tools: ["showStudyBlocks"],
  },
  study_notebook: {
    key: "study_notebook",
    label: "Study notebook",
    description: "The student's saved notebook of study items.",
    kind: "chat_tool",
    roles: ["student"],
    permission: "ai.study",
    module: "ai_student",
    data: "own",
    defaultOn: [],
    legacyFeature: "student_ai_notebook",
  },

  // ---- Guardian child reads --------------------------------------------
  child_attendance: {
    key: "child_attendance",
    label: "Child's attendance",
    description: "This child's attendance summary for the current term.",
    kind: "chat_tool",
    roles: ["guardian"],
    permission: "attendance.read",
    module: "attendance",
    data: "own",
    defaultOn: ["guardian"],
    queries: ["attendance.getStudentAttendanceSummary"],
  },
  child_results: {
    key: "child_results",
    label: "Child's exam results",
    description: "This child's published exam results.",
    kind: "chat_tool",
    roles: ["guardian"],
    permission: "exam.result.read",
    module: "exams",
    data: "own",
    defaultOn: ["guardian"],
    queries: ["exams.listResultsForStudent"],
  },
  child_fees: {
    key: "child_fees",
    label: "Child's fees",
    description: "This child's invoice history.",
    kind: "chat_tool",
    roles: ["guardian"],
    permission: "finance.read",
    module: "fees",
    data: "own",
    defaultOn: ["guardian"],
    queries: ["finance.listInvoicesForStudent"],
  },
  child_homework: {
    key: "child_homework",
    label: "Child's homework",
    description: "This child's class diary entries (homework and notes).",
    kind: "chat_tool",
    roles: ["guardian"],
    permission: "assignment.read",
    module: "diary",
    data: "own",
    defaultOn: ["guardian"],
    queries: ["diary.forStudent"],
  },

  // ---- Page-level AI tasks (api/ai/* routes) ---------------------------
  quiz_generator: {
    key: "quiz_generator",
    label: "Quiz generator",
    description: "Generate a draft quiz from the Assignments page.",
    kind: "task",
    roles: ["owner", "principal", "admin", "admissions", "teacher"],
    permission: "ai.generate",
    module: "ai_teacher",
    data: "aggregate",
    defaultOn: ["owner", "principal", "admin", "admissions", "teacher"],
  },
  report_remark: {
    key: "report_remark",
    label: "Report remark drafting",
    description: "Draft a report-card remark from a student's exam result.",
    kind: "task",
    roles: ["owner", "principal", "exam_controller", "teacher"],
    permission: "exam.marks.enter",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["owner", "principal", "exam_controller", "teacher"],
  },
  // Route checks ai.generate AND admissions.enquiry.read (both) — teacher
  // holds ai.generate but not admissions.enquiry.read, so it is excluded.
  enquiry_reply: {
    key: "enquiry_reply",
    label: "Enquiry reply drafting",
    description: "Draft a reply to an admissions enquiry.",
    kind: "task",
    roles: ["owner", "principal", "admin", "admissions"],
    permission: "admissions.enquiry.read",
    module: "ai_teacher",
    data: "personal",
    defaultOn: ["owner", "principal", "admin", "admissions"],
  },
  // Route checks only attendance.read + module (no role/ai.generate check) —
  // student/guardian hold attendance.read for their OWN record but this is
  // a staff briefing widget, so the ceiling excludes them regardless.
  attendance_insight: {
    key: "attendance_insight",
    label: "Attendance insight",
    description: "AI-generated attendance insight briefing.",
    kind: "task",
    roles: ["owner", "principal", "admin", "exam_controller", "teacher"],
    permission: "attendance.read",
    module: "ai_briefings",
    data: "aggregate",
    defaultOn: ["owner", "principal", "admin", "exam_controller", "teacher"],
  },
  // Route checks insight.read AND ai.generate (both) — accountant/exam_controller
  // hold insight.read but not ai.generate, so they are excluded.
  daily_briefing: {
    key: "daily_briefing",
    label: "Daily briefing",
    description: "AI-generated dashboard briefing.",
    kind: "task",
    roles: ["owner", "principal", "admin", "admissions", "teacher"],
    permission: "insight.read",
    module: "ai_briefings",
    data: "aggregate",
    defaultOn: ["owner", "principal", "admin", "admissions", "teacher"],
  },
  practice_quiz: {
    key: "practice_quiz",
    label: "Practice quiz",
    description: "AI-generated practice quiz for a curriculum unit.",
    kind: "task",
    roles: ["student"],
    permission: "ai.study",
    module: "practice",
    data: "own",
    defaultOn: ["student"],
  },
};
