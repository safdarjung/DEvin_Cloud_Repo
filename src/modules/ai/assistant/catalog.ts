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

// 38 queries: 18 aggregate (cloud + local) + 20 personal (local only)
export const ASSISTANT_QUERIES: Readonly<Record<string, AssistantQuerySpec>> = {
  // Aggregate — safe for cloud (no person identifiers)
  "attendance.attendanceTodaySummary": {
    description: "Today's attendance summary by section",
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
};

/**
 * Return the queries available to a provider, keyed by registry name.
 * - `"local"` gets all 38 queries (aggregate + personal)
 * - `"groq"` and `"gemini"` get only the 18 aggregate queries
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
