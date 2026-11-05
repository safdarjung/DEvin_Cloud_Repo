import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { detectMarks, marksDetector, type MarksSourceRow } from "@/modules/insights/detectors/marks";
import {
  detectSubmissions,
  submissionsDetector,
  type SubmissionsSourceRow,
} from "@/modules/insights/detectors/submissions";

const AS_OF = "2026-11-01"; // ISO week 2026-W44
const STUDENT = "11111111-1111-4111-8111-111111111111";
const SECTION = "22222222-2222-4222-8222-222222222222";
const EXAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function markRow(overrides: Partial<MarksSourceRow> = {}): MarksSourceRow {
  return {
    student_id: STUDENT,
    class_section_id: SECTION,
    section_label: "8-A",
    subject_id: "subj-math",
    subject_name: "Mathematics",
    prev_exam_id: "prev-exam",
    prev_pct: 80,
    last_exam_id: EXAM_A,
    last_pct: 64,
    last_published_on: "2026-10-20",
    ...overrides,
  };
}

function studentRow(missing: number, due: number): SubmissionsSourceRow {
  return {
    level: "student",
    class_section_id: SECTION,
    section_label: "8-A",
    student_id: STUDENT,
    due_count: due,
    missing_count: missing,
    awaiting_count: null,
    oldest_awaiting_days: null,
  };
}

function sectionRow(awaiting: number, oldest: number): SubmissionsSourceRow {
  return {
    level: "section",
    class_section_id: SECTION,
    section_label: "8-A",
    student_id: null,
    due_count: null,
    missing_count: null,
    awaiting_count: awaiting,
    oldest_awaiting_days: oldest,
  };
}

// Minimal stand-in for `admin.rpc(...).order(...).range(...)`: serves `rows`
// in the requested window and records each call.
function fakeAdmin(rows: unknown[]) {
  const calls: { fn: string; args: unknown; from: number; to: number }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      const builder = {
        order: () => builder,
        range: (from: number, to: number) => {
          calls.push({ fn, args, from, to });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

describe("detectMarks", () => {
  it("flags a single 16-point subject drop as watch", () => {
    const [c] = detectMarks([markRow()], AS_OF);
    expect(c.signal).toBe("academics.marks_decline");
    expect(c.severity).toBe("watch");
    expect(c.confidence).toBe(0.61);
    expect(c.approval_required).toBe(false);
    expect(c.reviewer_role).toBe("exam_controller");
  });

  it("flags a 31-point drop as warning", () => {
    const [c] = detectMarks([markRow({ prev_pct: 81, last_pct: 50 })], AS_OF);
    expect(c.severity).toBe("warning");
  });

  it("treats a drop of exactly 30 points as warning despite float subtraction", () => {
    const [c] = detectMarks([markRow({ prev_pct: 75.3, last_pct: 45.3 })], AS_OF);
    expect(c.severity).toBe("warning");
  });

  it("flags three declined subjects as warning, one candidate per student", () => {
    const rows = [
      markRow({ subject_id: "s1", subject_name: "Mathematics" }),
      markRow({ subject_id: "s2", subject_name: "Science", prev_pct: 70, last_pct: 52 }),
      markRow({ subject_id: "s3", subject_name: "English", prev_pct: 90, last_pct: 74 }),
    ];
    const out = detectMarks(rows, AS_OF);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
    expect(out[0].confidence).toBe(0.83);
  });

  it("lists the top 3 subjects by drop plus a count, 7 evidence items max", () => {
    const rows = [
      markRow({ subject_id: "s1", subject_name: "Mathematics", prev_pct: 80, last_pct: 64 }), // 16
      markRow({ subject_id: "s2", subject_name: "Science", prev_pct: 90, last_pct: 55.6 }), // 34.4
      markRow({ subject_id: "s3", subject_name: "English", prev_pct: 70, last_pct: 50 }), // 20
      markRow({ subject_id: "s4", subject_name: "Hindi", prev_pct: 85, last_pct: 60 }), // 25
    ];
    const [c] = detectMarks(rows, AS_OF);
    expect(c.evidence).toEqual([
      { label: "Science latest", value: 55.6, unit: "%" },
      { label: "Science change", value: -34.4, unit: "pts" },
      { label: "Hindi latest", value: 60, unit: "%" },
      { label: "Hindi change", value: -25, unit: "pts" },
      { label: "English latest", value: 50, unit: "%" },
      { label: "English change", value: -20, unit: "pts" },
      { label: "Subjects declined", value: 4 },
    ]);
    expect(c.pattern).toBe(
      "4 subjects fell 15+ points between the last two exams; largest: Science 90% → 55.6%.",
    );
  });

  it("uses the latest exam as window, ties broken by the smallest exam id", () => {
    const later = detectMarks(
      [
        markRow({ subject_id: "s1", last_exam_id: EXAM_A, last_published_on: "2026-10-20" }),
        markRow({ subject_id: "s2", last_exam_id: EXAM_B, last_published_on: "2026-10-25" }),
      ],
      AS_OF,
    )[0];
    expect(later.dedupe_key).toBe(`academics.marks_decline:student:${STUDENT}:${EXAM_B}`);

    const tied = [
      markRow({ subject_id: "s1", last_exam_id: EXAM_B, last_published_on: "2026-10-25" }),
      markRow({ subject_id: "s2", last_exam_id: EXAM_A, last_published_on: "2026-10-25" }),
    ];
    expect(detectMarks(tied, AS_OF)[0].dedupe_key).toBe(`academics.marks_decline:student:${STUDENT}:${EXAM_A}`);
    expect(detectMarks([...tied].reverse(), AS_OF)[0].dedupe_key).toBe(
      `academics.marks_decline:student:${STUDENT}:${EXAM_A}`,
    );
  });

  it("scopes the candidate to the student without copying names or ids into text", () => {
    const [c] = detectMarks([markRow()], AS_OF);
    expect(c.entity_type).toBe("student");
    expect(c.entity_id).toBe(STUDENT);
    expect(c.entity_label).toBeNull();
    expect(c.class_section_id).toBe(SECTION);
    expect(c.title).toBe("Marks decline: a student in 8-A");
    expect(c.title).not.toContain(STUDENT);
    expect(c.pattern).not.toContain(STUDENT);
    expect(c.date_from).toBe("2025-11-01");
    expect(c.date_to).toBe(AS_OF);
    expect(c.sources).toEqual(["marks", "exam_papers", "exams"]);
    expect(c.recommended_actions.length).toBeGreaterThanOrEqual(1);
    expect(c.recommended_actions.length).toBeLessThanOrEqual(2);
    for (const a of c.recommended_actions) {
      expect(a.length).toBeLessThanOrEqual(160);
      expect(a).not.toMatch(/\d/);
    }
  });

  it("returns no candidates for no rows", () => {
    expect(detectMarks([], AS_OF)).toEqual([]);
  });
});

describe("detectSubmissions", () => {
  it("flags 3 missing of 4 due as missing_work watch", () => {
    const [c] = detectSubmissions([studentRow(3, 4)], AS_OF);
    expect(c.signal).toBe("academics.missing_work");
    expect(c.severity).toBe("watch");
    expect(c.confidence).toBe(0.7);
    expect(c.evidence).toEqual([
      { label: "Missing (4 weeks)", value: 3 },
      { label: "Due (4 weeks)", value: 4 },
    ]);
    expect(c.title).toBe("Missing work: a student in 8-A");
    expect(c.entity_type).toBe("student");
    expect(c.entity_id).toBe(STUDENT);
    expect(c.entity_label).toBeNull();
    expect(c.class_section_id).toBe(SECTION);
    expect(c.dedupe_key).toBe(`academics.missing_work:student:${STUDENT}:2026-W44`);
    expect(c.date_from).toBe("2026-10-05");
    expect(c.date_to).toBe(AS_OF);
    expect(c.pattern).not.toContain(STUDENT);
  });

  it("ignores 3 missing of 7 due (under half)", () => {
    expect(detectSubmissions([studentRow(3, 7)], AS_OF)).toEqual([]);
  });

  it("flags 5 missing as missing_work warning", () => {
    const [c] = detectSubmissions([studentRow(5, 6)], AS_OF);
    expect(c.severity).toBe("warning");
    expect(c.confidence).toBe(0.9);
  });

  it("flags a section with 15 awaiting as awaiting_review warning", () => {
    const [c] = detectSubmissions([sectionRow(15, 9)], AS_OF);
    expect(c.signal).toBe("academics.awaiting_review");
    expect(c.severity).toBe("warning");
    expect(c.confidence).toBe(0.9);
    expect(c.evidence).toEqual([
      { label: "Awaiting feedback", value: 15 },
      { label: "Oldest (days)", value: 9 },
    ]);
    expect(c.title).toBe("Submissions awaiting feedback in 8-A");
    expect(c.entity_type).toBe("section");
    expect(c.entity_id).toBe(SECTION);
    expect(c.entity_label).toBe("8-A");
    expect(c.dedupe_key).toBe(`academics.awaiting_review:section:${SECTION}:2026-W44`);
    expect(c.date_from).toBe("2026-10-23");
    expect(c.date_to).toBe(AS_OF);
  });

  it("rates a small, recent backlog as watch and an old one as warning", () => {
    expect(detectSubmissions([sectionRow(5, 8)], AS_OF)[0].severity).toBe("watch");
    expect(detectSubmissions([sectionRow(5, 14)], AS_OF)[0].severity).toBe("warning");
  });
});

describe("detector objects", () => {
  it("marksDetector pages the source in 1000s and passes the 15-point threshold", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => markRow({ student_id: `student-${i}` }));
    const { admin, calls } = fakeAdmin(rows);
    const out = await marksDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(marksDetector).toMatchObject({ key: "marks", module: "exams", version: 1 });
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls[0]).toMatchObject({
      fn: "insight_src_marks",
      args: { p_institution_id: "inst-1", p_as_of: AS_OF, p_min_drop_pts: 15 },
    });
    expect(out).toHaveLength(1001);
  });

  it("submissionsDetector stops after a short page", async () => {
    const { admin, calls } = fakeAdmin([studentRow(3, 4), sectionRow(15, 9)]);
    const out = await submissionsDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });
    expect(submissionsDetector).toMatchObject({ key: "submissions", module: "assignments", version: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: "insight_src_submissions", args: { p_institution_id: "inst-1", p_as_of: AS_OF } });
    expect(out.map((c) => c.signal)).toEqual(["academics.missing_work", "academics.awaiting_review"]);
  });
});
