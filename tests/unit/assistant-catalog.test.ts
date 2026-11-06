import { describe, it, expect } from "vitest";
import {
  ASSISTANT_CATALOG_VERSION,
  ASSISTANT_QUERIES,
  pickAssistantProvider,
  queriesFor,
  createSourceLog,
} from "@/modules/ai/assistant/catalog";
import type { AiPolicy } from "@/lib/ai/policy";

describe("assistant catalog", () => {
  describe("ASSISTANT_CATALOG_VERSION", () => {
    it("is exactly 'assistant_v1'", () => {
      expect(ASSISTANT_CATALOG_VERSION).toBe("assistant_v1");
    });
  });

  describe("ASSISTANT_QUERIES", () => {
    it("has exactly 38 entries", () => {
      const names = Object.keys(ASSISTANT_QUERIES);
      expect(names).toHaveLength(38);
    });

    it("has exactly 18 with aggregate flag", () => {
      const aggregateCount = Object.values(ASSISTANT_QUERIES).filter((q) => q.aggregate).length;
      expect(aggregateCount).toBe(18);
    });

    it("has all descriptions between 1 and 120 chars", () => {
      Object.entries(ASSISTANT_QUERIES).forEach(([, spec]) => {
        expect(spec.description.length).toBeGreaterThanOrEqual(1);
        expect(spec.description.length).toBeLessThanOrEqual(120);
      });
    });

    it("does not include excluded patterns", () => {
      const excludedPattern =
        /^(ai\.|documents?\.|imports\.|data\.|core\.(audit|modules)\.|agents?\.|reports?\.|notifications\.listMy|people\.(getMy|listMy)|exams\.reportCardHtml|website\.get)|Study/;
      Object.keys(ASSISTANT_QUERIES).forEach((name) => {
        expect(name).not.toMatch(excludedPattern);
      });
    });

    it("includes all aggregate names from the table", () => {
      const aggregateNames = [
        "attendance.attendanceTodaySummary",
        "attendance.sectionsBelowThreshold",
        "dashboard.attendanceTrend",
        "exams.listExams",
        "exams.examGradeDistribution",
        "exams.listSubjectOptions",
        "exams.listSectionOptions",
        "exams.listTermOptions",
        "mastery.heatmapBySection",
        "curriculum.coverageBySection",
        "timetable.roomUtilisation",
        "finance.termCollectionSummary",
        "finance.collectionReport",
        "admissions.getAdmissionsFunnelCounts",
        "calendar.forRole",
        "insights.riskIndicators",
        "forecasts.cards",
        "website.listNotices",
      ];

      aggregateNames.forEach((name) => {
        expect(ASSISTANT_QUERIES).toHaveProperty(name);
        expect(ASSISTANT_QUERIES[name].aggregate).toBe(true);
      });
    });

    it("includes all personal names from the table", () => {
      const personalNames = [
        "people.listStudents",
        "people.getStudentProfile",
        "people.staffAvailabilityToday",
        "attendance.getStudentAttendanceSummary",
        "attendance.getSectionAttendancePatterns",
        "exams.listResultsForStudent",
        "exams.listResultsForExam",
        "mastery.gapsForStudent",
        "mastery.studentSuccessRows",
        "finance.listDefaulters",
        "finance.listInvoicesForStudent",
        "admissions.listEnquiriesByStage",
        "admissions.listApplications",
        "academics.submissionsForAssignment",
        "timetable.forSection",
        "timetable.forTeacher",
        "timetable.teacherWorkload",
        "timetable.conflicts",
        "core.approvals.pending",
        "insights.list",
      ];

      personalNames.forEach((name) => {
        expect(ASSISTANT_QUERIES).toHaveProperty(name);
        expect(ASSISTANT_QUERIES[name].aggregate).not.toBe(true);
      });
    });
  });

  describe("queriesFor", () => {
    it("returns all 38 queries for local provider", () => {
      const local = queriesFor("local");
      expect(Object.keys(local)).toHaveLength(38);
    });

    it("returns only aggregate queries for cloud providers", () => {
      const groq = queriesFor("groq");
      const gemini = queriesFor("gemini");

      // Cloud providers should only have aggregate queries (18)
      expect(Object.keys(groq)).toHaveLength(18);
      expect(Object.keys(gemini)).toHaveLength(18);

      // Verify they don't have personal queries
      expect(groq).not.toHaveProperty("finance.listDefaulters");
      expect(groq).not.toHaveProperty("people.listStudents");
      expect(gemini).not.toHaveProperty("finance.listDefaulters");
      expect(gemini).not.toHaveProperty("people.listStudents");

      // Verify they have aggregate queries
      expect(groq).toHaveProperty("attendance.sectionsBelowThreshold");
      expect(gemini).toHaveProperty("attendance.sectionsBelowThreshold");
    });

    it("returns descriptions keyed by the registry's dotted name", () => {
      const local = queriesFor("local");
      Object.keys(local).forEach((key) => {
        expect(key).toMatch(/\./);
      });
    });
  });

  describe("pickAssistantProvider", () => {
    const test_cases: Array<[AiPolicy, boolean, string | undefined, "local" | "groq" | "gemini"]> = [
      ["local_only", true, "any text", "local"],
      ["local_only", false, "any text", "local"],
      ["local_with_cloud_fallback", true, "any text", "local"],
      ["local_with_cloud_fallback", false, "any text", "local"],
      ["cloud_allowed", false, "any text", "local"],
      ["cloud_allowed", true, undefined, "local"],
      ["cloud_allowed", true, "", "local"],
      ["cloud_allowed", true, "short", "groq"],
      ["cloud_allowed", true, "This is a medium length question about attendance patterns", "groq"],
      ["cloud_allowed", true, "I need you to compare the attendance trends across both classes as well as analyze the performance metrics for each section, and also provide insights into the student retention rates and staff availability schedules.", "gemini"],
    ];

    test_cases.forEach(([policy, cloudEnabled, text, expected]) => {
      it(`(${policy}, ${cloudEnabled}, "${text?.substring(0, 30)}...") returns ${expected}`, () => {
        const result = pickAssistantProvider(policy, cloudEnabled, text);
        expect(result).toBe(expected);
      });
    });
  });

  describe("createSourceLog", () => {
    it("adds and lists sources", () => {
      const log = createSourceLog();
      log.add("attendance.sectionsBelowThreshold", {});
      log.add("finance.listDefaulters", { termId: "123" });

      const sources = log.list();
      expect(sources).toHaveLength(2);
      expect(sources[0]).toEqual({ query: "attendance.sectionsBelowThreshold", params: {} });
      expect(sources[1]).toEqual({ query: "finance.listDefaulters", params: { termId: "123" } });
    });

    it("ignores duplicate sources", () => {
      const log = createSourceLog();
      log.add("attendance.sectionsBelowThreshold", {});
      log.add("attendance.sectionsBelowThreshold", {});

      expect(log.list()).toHaveLength(1);
    });

    it("ignores sources beyond 20", () => {
      const log = createSourceLog();
      for (let i = 0; i < 25; i++) {
        log.add("query.name", { index: i });
      }

      expect(log.list()).toHaveLength(20);
    });

    it("stores params with >1000 char JSON as null", () => {
      const log = createSourceLog();
      const largeParams = { data: "x".repeat(1500) };
      log.add("some.query", largeParams);

      const sources = log.list();
      expect(sources[0].params).toBeNull();
    });

    it("returns a copy from list()", () => {
      const log = createSourceLog();
      log.add("query1", {});
      const list1 = log.list();
      const list2 = log.list();

      expect(list1).toEqual(list2);
      expect(list1).not.toBe(list2);

      list1.push({ query: "fake", params: {} });
      expect(log.list()).toHaveLength(1);
    });
  });
});
