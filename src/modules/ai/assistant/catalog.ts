import { pickAgentProvider, type AgentProvider } from "@/modules/ai/agent/provider-routing";

export const ASSISTANT_CATALOG_VERSION = "assistant_v1" as const;

export type AssistantQuerySpec = {
  description: string;
  aggregate?: true;
};

export type AssistantProvider = "local" | AgentProvider;

export type AssistantSource = {
  query: string;
  params: unknown;
};

export type SourceLog = {
  add(query: string, params: unknown): void;
  list(): AssistantSource[];
};

export type AssistantMessageMetadata = {
  provider: AssistantProvider;
  catalogVersion: typeof ASSISTANT_CATALOG_VERSION;
  sources: AssistantSource[];
};

// Aggregate entries go to cloud and local; the rest are local only.
// tests/unit/ai-feature-coverage.test.ts pins the reviewed aggregate list.
export const ASSISTANT_QUERIES: Readonly<Record<string, AssistantQuerySpec>> = {
  // Aggregate — safe for cloud (no person identifiers)
  "attendance.attendanceTodaySummary": {
    // The counts say "not taken yet" only implicitly; the model read 0 marked as "nobody absent".
    description: "Today's school attendance: marked count, present, percent (0 marked = not taken yet today)",
    aggregate: true,
  },
  "attendance.sectionsBelowThreshold": {
    description: "Sections with attendance below the alert threshold",
    aggregate: true,
  },
  "dashboard.attendanceTrend": {
    description: "Attendance trend over the past month by section",
    aggregate: true,
  },
  "exams.listExams": {
    description: "All exams in the current academic year",
    aggregate: true,
  },
  "exams.examGradeDistribution": {
    description: "Grade distribution for exam results",
    aggregate: true,
  },
  "exams.listSubjectOptions": {
    description: "Available subjects for exam creation",
    aggregate: true,
  },
  "exams.listSectionOptions": {
    description: "Available sections for exam administration",
    aggregate: true,
  },
  "exams.listTermOptions": {
    description: "Available terms for exam scheduling",
    aggregate: true,
  },
  "mastery.heatmapBySection": {
    description: "Subject mastery heatmap by section",
    aggregate: true,
  },
  "curriculum.coverageBySection": {
    description: "Curriculum coverage percentage by section",
    aggregate: true,
  },
  "timetable.roomUtilisation": {
    description: "Room utilization rates and schedules",
    aggregate: true,
  },
  "finance.termCollectionSummary": {
    description: "Fee collection summary for a term",
    aggregate: true,
  },
  "finance.collectionReport": {
    description: "Detailed fee collection report by grade or term",
    aggregate: true,
  },
  "admissions.getAdmissionsFunnelCounts": {
    description: "Admission enquiry stage distribution",
    aggregate: true,
  },
  "calendar.forRole": {
    description: "School calendar events and dates",
    aggregate: true,
  },
  "insights.riskIndicators": {
    description: "Risk indicators for at-risk students by section",
    aggregate: true,
  },
  "forecasts.cards": {
    description: "Academic and performance forecasts",
    aggregate: true,
  },
  "website.listNotices": {
    description: "Published notices on the school website",
    aggregate: true,
  },

  // Personal — local only (contain student/staff identifiers)
  "people.listStudents": {
    description: "List of all enrolled students",
  },
  "people.getStudentProfile": {
    description: "Student profile including contact and enrollment details",
  },
  "people.staffAvailabilityToday": {
    description: "Staff availability and schedule for today",
  },
  "attendance.getStudentAttendanceSummary": {
    description: "Attendance record and patterns for a student",
  },
  "attendance.getSectionAttendancePatterns": {
    description: "Detailed attendance patterns for section students",
  },
  "exams.listResultsForStudent": {
    description: "All exam results and grades for a student",
  },
  "exams.listResultsForExam": {
    description: "Student results and grades for an exam",
  },
  "mastery.gapsForStudent": {
    description: "Subject mastery gaps and learning needs for a student",
  },
  "mastery.studentSuccessRows": {
    description: "Student-level mastery metrics and progress",
  },
  "finance.listDefaulters": {
    description: "Students with outstanding fee payments",
  },
  "finance.listInvoicesForStudent": {
    description: "Invoice history for a student",
  },
  "admissions.listEnquiriesByStage": {
    description: "Admission enquiries grouped by processing stage",
  },
  "admissions.listApplications": {
    description: "Submitted admission applications",
  },
  "academics.submissionsForAssignment": {
    description: "Student submissions for an assignment",
  },
  "timetable.forSection": {
    description: "Class schedule and timetable for a section",
  },
  "timetable.forTeacher": {
    description: "Class schedule for a teacher",
  },
  "timetable.teacherWorkload": {
    description: "Teaching load and workload analysis by teacher",
  },
  "timetable.conflicts": {
    description: "Scheduling conflicts in the timetable",
  },
  "core.approvals.pending": {
    description: "Pending approvals awaiting review",
  },
  "insights.list": {
    description: "Generated insights for the school",
  },

  // ---- features-18 §E (2026-11-11). Aggregate only after reading each return
  // shape: counts, totals, catalogue names (items, categories, houses, labs,
  // rules of no person). Rows with names, person ids, notes or free text stay
  // local-only. Never listed: health.*, behaviour incidents/timeline,
  // helpdesk threads, payroll structures/payslips, concession awards, canteen
  // statements, safety pending acknowledgements, alumni.list, core.setup.*,
  // documents.*, *Html renders and bulk exports.
  "clubs.houseLeaderboard": { description: "House points leaderboard: house names, points and member counts", aggregate: true },
  "expenses.categories": { description: "Expense categories with their active flag", aggregate: true },
  "expenses.monthlyTotals": { description: "Net expense total per month for recent months", aggregate: true },
  "expenses.budgetVsActual": { description: "Budget vs actual spend per expense category and budget period", aggregate: true },
  "inventory.stock": { description: "Stock on hand per inventory item with its reorder level and low-stock flag", aggregate: true },
  "inventory.lowStockCount": { description: "Number of active inventory items at or below their reorder level", aggregate: true },
  "scholarships.summary": { description: "Concession counts by status and approved value by rule and by grade" },
  "canteen.items": { description: "Canteen menu items with prices and on-sale flag", aggregate: true },
  "canteen.daySales": { description: "Canteen sales by item and top-up totals for one day", aggregate: true },
  "hostel.rooms": { description: "Hostel rooms with capacity and current occupancy count", aggregate: true },
  "alumni.counts": { description: "Alumni count per batch year and the list of cities" },
  "payroll.runs": { description: "Latest payroll runs: month, status, payslip count, gross and net totals" },
  "payroll.monthlyCost": { description: "Payroll cost of finalized months: staff count, gross and net totals" },
  "schoolLabs.labs": { description: "School labs with kind, capacity and active flag", aggregate: true },
  "schoolLabs.utilisation": { description: "Bookings and periods used per lab in a date range", aggregate: true },
  "schoolLabs.safetyWarnings": { description: "A lab's expired, hazard-classed or out-of-stock register items", aggregate: true },
  "achievements.summary": { description: "Achievement counts by category and level", aggregate: true },
  "resources.summary": { description: "Published teaching resource counts by subject", aggregate: true },
  "duties.types": { description: "Duty types with slots per day and active flag", aggregate: true },
  "duties.countByType": { description: "Duty assignment count per duty type in a date range", aggregate: true },
  "compliance.summary": { description: "Compliance item counts by category and status", aggregate: true },
  "helpdesk.counts": { description: "Open and overdue helpdesk ticket counts", aggregate: true },
  "form.results": { description: "Per-field answer counts for one form, no names", aggregate: true },
  "examSeating.slots": { description: "Exam slots with sections, paper and student counts, and seating plan status", aggregate: true },
  "feePlans.lateFeeRules": { description: "Late-fee rule per fee structure: kind, amount, grace days, cap", aggregate: true },
  "lab.correlation": { description: "Attendance vs marks correlation by section and subject", aggregate: true },
  "lab.anomalies": { description: "Sections whose attendance, marks or fee overdue rate stand out (z-scores)", aggregate: true },
  "lab.feeRisk": { description: "Fee overdue rates by grade and attendance band", aggregate: true },
  "lab.trendBreaks": { description: "Sections whose recent attendance broke from their own trend", aggregate: true },

  "clubs.list": { description: "Clubs with patron teacher, capacity and active flag" },
  "clubs.events": { description: "Club events with dates, venue, capacity and status" },
  "clubs.members": { description: "Members of one club" },
  "expenses.list": { description: "Expense register page: description, payee, amount, voided flag" },
  "inventory.movements": { description: "Stock movements of inventory items with notes" },
  "scholarships.rules": { description: "Concession rules: name, criteria, percent or fixed amount, active flag" },
  "hostel.allocations": { description: "Current hostel room allocations" },
  "hostel.rollCall": { description: "Hostel roll call for a date" },
  "helpdesk.tickets": { description: "Helpdesk tickets with status, priority, due date, raiser and assignee" },
  "form.list": { description: "Forms with status, fields and response counts" },
  "form.responses": { description: "Every response to one form" },
  "achievements.list": { description: "Student achievements with category, level and verified flag" },
  "achievements.portfolio": { description: "One student's achievements" },
  "resources.browse": { description: "Teaching resources the caller may read, optionally for one subject" },
  "resources.forStudent": { description: "Published resources for one child's section" },
  "duties.roster": { description: "Duty roster with staff names for a date range" },
  "compliance.items": { description: "Compliance items with due status and owner" },
  "safety.alerts": { description: "Safety alerts the caller can see, active and recent" },
  "safety.alertSummary": { description: "One alert's acknowledgement counts and section headcount board" },
  "behaviour.pointTotals": { description: "Merit and demerit point totals per student" },
  "library.catalog": { description: "Library catalogue: titles, authors, copies and available copies" },
  "library.overdue": { description: "Overdue library loans with borrower and fine" },
  "library.myLoans": { description: "The caller's or their child's library loans" },
  "visitors.list": { description: "Visitor log for a date" },
  "visitors.gatePasses": { description: "Student gate passes and their status" },
  "visitors.pickupList": { description: "Authorised pickup people for one student" },
  "certificates.list": { description: "Issued certificates" },
  "examSeating.chart": { description: "Seating chart of one plan: rooms and seats" },
  "examSeating.studentSeats": { description: "One student's exam seats" },
  "feePlans.instalments": { description: "Instalments of one fee invoice" },
  "lifecycle.history": { description: "A student's promotion, transfer and exit history" },
  "workflows.list": { description: "Automation workflows and their status" },
  "workflows.runs": { description: "Recent automation workflow runs" },
  "people.pendingLeaveApprovals": { description: "Staff leave requests waiting for approval" },
  "people.leaveRequests": { description: "The caller's own staff leave requests" },
  "people.staffAttendanceForDate": { description: "Staff attendance for a date" },
  "timetable.coverNeeded": { description: "Periods that need a substitute teacher on a date" },
  "timetable.substitutionCandidates": { description: "Free teachers who could cover one period" },
  "timetable.substitutions": { description: "Substitutions assigned for a date" },
  "form.mine": { description: "Published forms waiting for the caller or their child" },
  "helpdesk.myTickets": { description: "The caller's own helpdesk tickets" },
};

/**
 * Return the queries available to a provider, keyed by registry name.
 * - `"local"` gets every query (aggregate + personal)
 * - `"groq"`, `"gemini"` and `"zai"` (every cloud provider) get only the aggregate queries
 *
 * Keys keep the registry's dotted name (`.` → `_` happens in `toolNameFor`,
 * M22's tool builder — not here).
 */
export function queriesFor(provider: AssistantProvider): Readonly<Record<string, string>> {
  const queries = Object.entries(ASSISTANT_QUERIES);

  const filtered =
    provider === "local"
      ? queries
      : queries.filter(([, spec]) => spec.aggregate === true);

  const result: Record<string, string> = {};
  for (const [name, spec] of filtered) {
    result[name] = spec.description;
  }
  return result;
}

/**
 * Owner decision 2026-11-02 (M24-tasks.md): the assistant extends the D28/D29
 * teacher-agent cloud exception — Gemini/Groq via `pickAgentProvider`,
 * regardless of the institution's `ai_policy`. Local only when no cloud key is
 * configured (a keyless self-hosted install).
 */
export function pickAssistantProvider(cloudConfigured: boolean, latestUserText: string | undefined): AssistantProvider {
  return cloudConfigured ? pickAgentProvider(latestUserText) : "local";
}

/**
 * Source log: tracks queries executed during a single assistant response.
 * Deduped by (query, params JSON), max 20 entries, params >1000 chars stored as null.
 */
export function createSourceLog(): SourceLog {
  const sources: AssistantSource[] = [];
  const seen = new Set<string>();

  return {
    add(query: string, params: unknown) {
      // Build dedup key
      let paramsStr: string | null = null;
      try {
        paramsStr = JSON.stringify(params ?? null);
      } catch {
        paramsStr = "null";
      }

      const dedupKey = `${query}|${paramsStr}`;

      // Skip if already seen
      if (seen.has(dedupKey)) {
        return;
      }

      // Skip if we already have 20
      if (sources.length >= 20) {
        return;
      }

      // Store params as null if >1000 chars
      const storedParams = paramsStr && paramsStr.length > 1000 ? null : params;

      sources.push({ query, params: storedParams });
      seen.add(dedupKey);
    },

    list() {
      // Return a copy
      return sources.map((s) => ({ ...s }));
    },
  };
}
