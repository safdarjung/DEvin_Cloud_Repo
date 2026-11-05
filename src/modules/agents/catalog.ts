// Agent catalog — agent definitions, tools, actions, and risk levels.
// No imports (seed/jobs run this under plain node; importers use relative paths).

export const AGENT_CATALOG_VERSION = "agents_v1";

export type AgentSlug = "academic" | "attendance" | "admissions" | "finance" | "communication" | "administrative";

export const AGENT_SLUGS: readonly AgentSlug[] = [
  "academic",
  "attendance",
  "admissions",
  "finance",
  "communication",
  "administrative",
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
  readonly tools: Readonly<Record<string, string>>;
  readonly actions: Readonly<Record<string, string>>;
}

export const AGENT_CATALOG: Readonly<Record<AgentSlug, AgentSpec>> = {
  academic: {
    name: "Academic agent",
    roleDescription:
      "Analyzes academic performance, curriculum coverage, and assignment submissions to generate insights and recommendations for lesson planning and student assessment.",
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
