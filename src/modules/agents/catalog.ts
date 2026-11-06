// Agent catalog — agent definitions, tools, actions, and risk levels.
// No imports (seed/jobs run this under plain node; importers use relative paths).

export const AGENT_CATALOG_VERSION = "agents_v2";

export type AgentSlug =
  | "academic"
  | "attendance"
  | "admissions"
  | "finance"
  | "communication"
  | "administrative"
  | "exams"
  | "student_success"
  | "staff_hr"
  | "operations"
  | "library";

export const AGENT_SLUGS: readonly AgentSlug[] = [
  "academic",
  "attendance",
  "admissions",
  "finance",
  "communication",
  "administrative",
  "exams",
  "student_success",
  "staff_hr",
  "operations",
  "library",
];

export type AgentRunStatus = "running" | "done" | "failed" | "awaiting_approval" | "rejected" | "queued";

export const AGENT_RUN_STATUSES = ["running", "done", "failed", "awaiting_approval", "rejected", "queued"] as const satisfies readonly AgentRunStatus[];

export type RiskClass = "read_only" | "low_risk_reversible" | "user_confirmed" | "human_approved" | "prohibited";

export const RISK_ORDER: readonly RiskClass[] = [
  "read_only",
  "low_risk_reversible",
  "user_confirmed",
  "human_approved",
  "prohibited",
];

export interface AgentSpec {
  readonly name: string;
  readonly roleDescription: string;
  // One plain sentence a principal understands, <=120 chars, no jargon.
  readonly summary: string;
  // 2-3 example tasks for the "Try asking" chips, each <=90 chars.
  readonly examples: readonly string[];
  readonly tools: Readonly<Record<string, string>>;
  readonly actions: Readonly<Record<string, string>>;
}

export const AGENT_CATALOG: Readonly<Record<AgentSlug, AgentSpec>> = {
  academic: {
    name: "Academic agent",
    roleDescription:
      "Analyzes academic performance, curriculum coverage, and assignment submissions to generate insights and recommendations for lesson planning and student assessment.",
    summary: "Looks at exam results and classwork to suggest lesson plans and new assignments.",
    examples: [
      "Create an assignment for class 8B on fractions",
      "Draft a lesson plan for next week's science unit",
      "Check the grade distribution for the mid-term exam",
    ],
    tools: {
      "exams.listExams": "List exams by term with dates and status",
      "exams.examGradeDistribution": "View grade distribution for an exam across sections",
      "curriculum.coverageBySection": "Track curriculum unit coverage progress by section",
      "academics.submissionsForAssignment": "View student submissions for an assignment",
      "timetable.teacherWorkload": "Analyze teacher schedule and workload distribution",
    },
    actions: {
      "assignment.create": "Create a new assignment for a class",
      "curriculum.lessonPlan.upsert": "Create or update a lesson plan for a curriculum unit",
    },
  },

  attendance: {
    name: "Attendance agent",
    roleDescription:
      "Monitors attendance patterns, identifies at-risk sections, and coordinates coverage for substitute teaching and staff availability.",
    summary: "Watches daily attendance and staff availability, and lines up substitute teachers.",
    examples: [
      "Find sections with attendance below 80% this week",
      "Assign a substitute for period 3 tomorrow",
      "Announce tomorrow's attendance drive to parents",
    ],
    tools: {
      "attendance.attendanceTodaySummary": "View today's attendance summary by section",
      "attendance.sectionsBelowThreshold": "Identify sections with low attendance rates",
      "attendance.getSectionAttendancePatterns": "Analyze historical attendance patterns for a section",
      "people.staffAvailabilityToday": "Check staff availability for today",
      "timetable.coverNeeded": "Identify periods needing cover or substitution",
    },
    actions: {
      "announcement.create": "Create an announcement for the school",
      "timetable.substitution.assign": "Assign a substitute teacher to a period",
    },
  },

  admissions: {
    name: "Admissions agent",
    roleDescription:
      "Manages the admissions funnel, tracks enquiry stage progression, and processes applications with escalation for human review.",
    summary: "Tracks enquiries through the admissions funnel and flags follow-ups needed.",
    examples: [
      "Show enquiries stuck in the visited stage",
      "Add a note to an enquiry about a sibling discount",
      "Move an enquiry to the application stage",
    ],
    tools: {
      "admissions.getAdmissionsFunnelCounts": "View counts at each admissions stage",
      "admissions.listEnquiriesByStage": "List enquiries filtered by stage",
      "admissions.listApplications": "View pending and processed applications",
    },
    actions: {
      "admissions.enquiry.note": "Add a note to an enquiry",
      "admissions.enquiry.assign": "Assign an enquiry to staff",
      "admissions.enquiry.status": "Update enquiry stage in the funnel",
    },
  },

  finance: {
    name: "Finance agent",
    roleDescription:
      "Analyzes collection trends, identifies payment defaulters, and proposes reminder campaigns to improve cash flow.",
    summary: "Finds families with overdue fees and drafts payment reminder campaigns.",
    examples: [
      "List fee defaulters for this term",
      "Send payment reminders to overdue families",
      "Show this term's fee collection summary",
    ],
    tools: {
      "finance.termCollectionSummary": "View term collection statistics",
      "finance.listDefaulters": "List students with overdue fees",
      "finance.collectionReport": "Generate collection analytics by term",
      "finance.listInvoices": "View issued invoices with payment status",
    },
    actions: {
      "finance.reminders.send": "Send payment reminders to families",
    },
  },

  communication: {
    name: "Communication agent",
    roleDescription:
      "Manages announcements, publishes notices to the website, and coordinates messaging across notification channels.",
    summary: "Drafts and publishes school announcements and website notices.",
    examples: [
      "Publish a notice about the sports day schedule",
      "Create an announcement about the holiday calendar",
      "Check which notifications failed to deliver",
    ],
    tools: {
      "notifications.listDeliveryLog": "View notification delivery history",
      "calendar.forRole": "View calendar events relevant to role",
      "website.listNotices": "List notices published on the website",
    },
    actions: {
      "announcement.create": "Create an announcement for the school",
      "announcement.publish": "Publish an announcement",
      "website.notice.upsert": "Create or update a notice on the website",
    },
  },

  administrative: {
    name: "Administrative agent",
    roleDescription:
      "Resolves operational bottlenecks, manages maintenance requests, and surfaces attention-needed jobs.",
    summary: "Surfaces stuck background jobs and maintenance requests needing attention.",
    examples: [
      "List maintenance requests waiting for assignment",
      "Retry the failed report-card generation job",
      "Check for scheduling conflicts in the timetable",
    ],
    tools: {
      "jobs.listAttentionJobs": "View jobs requiring attention or retry",
      "facilities.maintenanceRequests": "Track maintenance requests and status",
      "timetable.conflicts": "Identify scheduling conflicts in timetables",
      "core.audit.list": "View system audit log",
    },
    actions: {
      "maintenance.assign": "Assign a maintenance request",
      "job.requeue": "Retry a failed job",
    },
  },

  exams: {
    name: "Exams agent",
    roleDescription:
      "Tracks exam schedules and grade results, and flags recheck requests and marks disputes for the exam controller to decide.",
    summary: "Tracks exam schedules and grades, and flags marks disputes for review.",
    examples: [
      "Show recheck requests waiting for a decision",
      "Check the grade distribution for the term 2 exam",
      "Find scheduling conflicts in next week's exams",
    ],
    tools: {
      "exams.listExams": "List exams by term with dates and status",
      "exams.examGradeDistribution": "View grade distribution for an exam across sections",
      "exams.listRecheckQueue": "List recheck requests pending review",
      "exams.scheduleConflicts": "Identify scheduling conflicts in the exam timetable",
    },
    // Read-only by rule 6: AI never decides marks or rechecks; it flags them for the exam controller.
    actions: {},
  },

  student_success: {
    name: "Student success agent",
    roleDescription:
      "Finds students falling behind in mastery of topics and tracks the intervention plans put in place to help them.",
    summary: "Finds students falling behind and tracks the help plans put in place for them.",
    examples: [
      "Show students at risk in class 9A this term",
      "List open intervention plans and their progress",
      "Which students need a new intervention plan?",
    ],
    tools: {
      "mastery.studentSuccessRows": "View students with mastery scores and risk flags for a section",
      "mastery.heatmapBySection": "View topic mastery heatmap for a section",
      "mastery.interventions": "List intervention plans and their status",
    },
    // Read-only by rule 6: intervention plans are welfare decisions a person makes.
    actions: {},
  },

  staff_hr: {
    name: "Staff & HR agent",
    roleDescription:
      "Tracks staff leave requests and daily availability, and finds periods needing a substitute.",
    summary: "Tracks staff leave requests and availability, and finds periods needing cover.",
    examples: [
      "List leave requests waiting for approval",
      "Suggest a substitute for a teacher on leave today",
      "Check which staff are free to cover a class today",
    ],
    tools: {
      "people.staffAvailabilityToday": "Check which staff are available today",
      "people.pendingLeaveApprovals": "List staff leave requests awaiting approval",
      "timetable.coverNeeded": "List periods needing a substitute teacher",
    },
    // Leave decisions stay with people (rule 6); the agent can only propose cover.
    actions: {
      "timetable.substitution.assign": "Assign a substitute teacher to a period",
    },
  },

  operations: {
    name: "Operations agent",
    roleDescription:
      "Tracks transport routes, classroom usage, and maintenance requests, and assigns maintenance jobs to staff.",
    summary: "Tracks transport routes, room usage, and maintenance, and assigns repair jobs.",
    examples: [
      "List today's open maintenance requests",
      "Assign a maintenance request to the caretaker",
      "Check classroom usage rates for this term",
    ],
    tools: {
      "transport.routes": "List school transport routes and capacity",
      "facilities.maintenanceRequests": "Track maintenance requests and status",
      "timetable.roomUtilisation": "View classroom usage rates across the timetable",
    },
    actions: {
      "maintenance.assign": "Assign a maintenance request",
    },
  },

  library: {
    name: "Library agent",
    roleDescription: "Tracks the book catalog and overdue loans, and renews loans on request.",
    summary: "Tracks the book catalog and overdue loans, and renews loans on request.",
    examples: [
      "Show which books are overdue this month",
      "Renew a student's library loan by two weeks",
      "Search the catalog for science books",
    ],
    tools: {
      "library.catalog": "Search the book catalog and copy availability",
      "library.overdue": "List overdue book loans",
    },
    actions: {
      "library.loan.renew": "Renew a student's book loan",
    },
  },
};

// Risk levels for every action in the catalog.
// No action here should be read_only or prohibited; those are data-determined at runtime.
export const ACTION_RISK: Readonly<Record<string, RiskClass>> = {
  "assignment.create": "low_risk_reversible",
  "curriculum.lessonPlan.upsert": "user_confirmed",
  "announcement.create": "low_risk_reversible",
  "timetable.substitution.assign": "human_approved",
  "admissions.enquiry.note": "user_confirmed",
  "admissions.enquiry.assign": "user_confirmed",
  "admissions.enquiry.status": "user_confirmed",
  "finance.reminders.send": "human_approved",
  "announcement.publish": "human_approved",
  "website.notice.upsert": "human_approved",
  "maintenance.assign": "user_confirmed",
  "job.requeue": "user_confirmed",
  "library.loan.renew": "low_risk_reversible",
};

export interface AgentProposal {
  readonly action: string;
  readonly input: unknown;
  readonly risk_class: "low_risk_reversible" | "user_confirmed" | "human_approved";
  readonly status: "proposed" | "executed" | "failed" | "skipped";
  readonly error_code: string | null;
}

export type AgentLogEntry = {
  readonly at: string;
  readonly level: "info" | "warn" | "error";
  readonly text: string;
};

// Return the highest risk from a list.
export function maxRisk(classes: readonly RiskClass[]): RiskClass {
  if (classes.length === 0) return "read_only";
  let highest: RiskClass = "read_only";
  for (const c of classes) {
    const highestIdx = RISK_ORDER.indexOf(highest);
    const cIdx = RISK_ORDER.indexOf(c);
    if (cIdx > highestIdx) highest = c;
  }
  return highest;
}

// Return the max risk for an agent's actions.
export function agentMaxRisk(slug: AgentSlug): RiskClass {
  const spec = AGENT_CATALOG[slug];
  const risks = Object.keys(spec.actions).map((action) => ACTION_RISK[action]);
  return maxRisk(risks);
}

// Whether a risk class requires approval.
export function needsApproval(risk: RiskClass): boolean {
  return risk === "user_confirmed" || risk === "human_approved";
}

// Determine who can approve a run.
export function canDecideRun(
  actor: { userId: string; canApprove: boolean },
  run: { risk_class: RiskClass; requested_by: string }
): boolean {
  if (run.risk_class === "human_approved") {
    return actor.canApprove;
  }
  if (run.risk_class === "user_confirmed") {
    return actor.userId === run.requested_by || actor.canApprove;
  }
  return false;
}
