import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  ASSISTANT_CATALOG_VERSION,
  ASSISTANT_QUERIES,
  pickAssistantProvider,
  queriesFor,
  createSourceLog,
} from "@/modules/ai/assistant/catalog";

describe("assistant catalog", () => {
  describe("ASSISTANT_CATALOG_VERSION", () => {
    it("is exactly 'assistant_v1'", () => {
      expect(ASSISTANT_CATALOG_VERSION).toBe("assistant_v1");
    });
  });

  describe("ASSISTANT_QUERIES", () => {
    it("has exactly 117 entries (features-18 §E added 70; academics.mySubmissions for students 2026-11-13; learning.myWeakTopics 0151)", () => {
      const names = Object.keys(ASSISTANT_QUERIES);
      expect(names).toHaveLength(117);
    });

    it("has exactly 49 with aggregate flag", () => {
      const aggregateCount = Object.values(ASSISTANT_QUERIES).filter((q) => q.aggregate).length;
      expect(aggregateCount).toBe(49);
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
        "attendance.todayBySection",
        "people.enrolmentCounts",
        "timetable.todayFor",
        "exams.sectionScoreBands",
        "finance.listTermOptions",
        "finance.defaulterCounts",
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

  describe("Registry validation", () => {
    it("every catalog name is a defined query", () => {
      const SRC_DIR = path.join(process.cwd(), "src");
      const DEFINE_QUERY_NAME = /defineQuery\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;

      function walk(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".")) return walk(full);
          return /\.tsx?$/.test(entry.name) ? [full] : [];
        });
      }

      const queries = new Set<string>();
      for (const file of walk(SRC_DIR)) {
        if (file.endsWith(path.join("lib", "actions", "define-query.ts"))) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const match of content.matchAll(DEFINE_QUERY_NAME)) {
          queries.add(match[1]);
        }
      }

      for (const catalogName of Object.keys(ASSISTANT_QUERIES)) {
        expect(queries, `catalog query ${catalogName} is not defined`).toContain(catalogName);
      }
    });

    it("no catalog name matches excluded patterns", () => {
      const excludedPattern =
        /^(ai\.|documents?\.|imports\.|data\.|core\.(audit|modules)\.|agents?\.|reports?\.|notifications\.listMy|people\.(getMy|listMy)|exams\.reportCardHtml|website\.get)|Study/;

      for (const name of Object.keys(ASSISTANT_QUERIES)) {
        expect(name, `catalog name ${name} matches excluded pattern`).not.toMatch(excludedPattern);
      }
    });

    it("no catalog name collides, after toolNameFor, with buildAssistantTools' fixed names", () => {
      // buildAssistantTools (src/modules/ai/assistant/tools.ts) spreads the
      // read tools built from this catalog, then unconditionally overwrites
      // `navigate` / `createTask`. A catalog name with no dot maps to itself
      // (toolNameFor only replaces "."), so either literal name here would
      // be silently shadowed with no error.
      for (const name of Object.keys(ASSISTANT_QUERIES)) {
        const toolName = name.replace(/\./g, "_");
        expect(["navigate", "createTask"], `catalog name ${name} collides with a fixed tool`).not.toContain(
          toolName,
        );
      }
    });
  });

  describe("queriesFor", () => {
    it("returns all 117 queries for every provider (owner decision 2026-11-12)", () => {
      expect(Object.keys(queriesFor())).toHaveLength(117);
      expect(queriesFor()).toHaveProperty("people.listStudents");
    });

    it("returns descriptions keyed by the registry's dotted name", () => {
      const local = queriesFor();
      Object.keys(local).forEach((key) => {
        expect(key).toMatch(/\./);
      });
    });
  });

  describe("pickAssistantProvider", () => {
    const longText =
      "I need you to compare the attendance trends across both classes as well as analyze the performance metrics for each section, and also provide insights into the student retention rates and staff availability schedules.";
    const test_cases: Array<[boolean, string | undefined, "local" | "groq" | "gemini"]> = [
      [false, "any text", "local"],
      [false, undefined, "local"],
      [true, "short", "groq"],
      [true, "This is a medium length question about attendance patterns", "groq"],
      [true, longText, "gemini"],
      [true, undefined, "gemini"],
    ];

    test_cases.forEach(([cloudConfigured, text, expected]) => {
      it(`(cloudConfigured=${cloudConfigured}, "${text?.substring(0, 30)}...") returns ${expected}`, () => {
        expect(pickAssistantProvider(cloudConfigured, text)).toBe(expected);
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
