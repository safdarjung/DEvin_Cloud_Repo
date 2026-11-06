import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import {
  attendanceDetector,
  detectAttendance,
  type AttendanceSourceRow,
} from "@/modules/insights/detectors/attendance";

const AS_OF = "2026-11-01"; // ISO week 2026-W44
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "22222222-2222-4222-8222-222222222222";

function sectionRow(overrides: Partial<AttendanceSourceRow> = {}): AttendanceSourceRow {
  return {
    level: "section",
    class_section_id: SECTION_ID,
    section_label: "8-A",
    student_id: null,
    recent_days: 5,
    base_days: 20,
    recent_present: 32,
    recent_denominator: 40, // 80.0%
    base_present: 275,
    base_denominator: 299, // 91.97% -> 92.0
    ...overrides,
  };
}

function studentRow(overrides: Partial<AttendanceSourceRow> = {}): AttendanceSourceRow {
  return {
    level: "student",
    class_section_id: SECTION_ID,
    section_label: "8-A",
    student_id: STUDENT_ID,
    recent_days: 5,
    base_days: 20,
    recent_present: 3,
    recent_denominator: 5, // 60%
    base_present: 19,
    base_denominator: 20, // 95%
    ...overrides,
  };
}

describe("detectAttendance: section_drop", () => {
  it("section falling from 92% to 80% over 5 days fires a warning at confidence 0.95", () => {
    const [c, ...rest] = detectAttendance([sectionRow()], AS_OF);
    expect(rest).toHaveLength(0);
    expect(c.signal).toBe("attendance.section_drop");
    expect(c.severity).toBe("warning");
    expect(c.confidence).toBe(0.95);
    expect(c.evidence).toEqual([
      { label: "Last 7 days", value: 80, unit: "%" },
      { label: "Previous 4 weeks", value: 92, unit: "%" },
      { label: "Drop", value: 12, unit: "pts" },
      { label: "School days (last 7)", value: 5 },
    ]);
    expect(c.title).toBe("Attendance drop in 8-A");
    expect(c.pattern).toBe("Attendance in 8-A fell from 92% to 80% in the 7 days to 2026-11-01.");
    expect(c.entity_type).toBe("section");
    expect(c.entity_id).toBe(SECTION_ID);
    expect(c.entity_label).toBe("8-A");
    expect(c.class_section_id).toBe(SECTION_ID);
    expect(c.date_from).toBe("2026-09-28");
    expect(c.date_to).toBe(AS_OF);
    expect(c.detector_version).toBe(1);
    expect(c.domain).toBe("attendance");
    expect(c.reviewer_role).toBe("principal");
    expect(c.approval_required).toBe(false);
  });

  it("evidence percentages are rounded to 1 dp", () => {
    // base 22/24 = 91.666 -> 91.7; recent 13/16 = 81.25 -> 81.3; drop 10.4
    const [c] = detectAttendance(
      [sectionRow({ base_present: 22, base_denominator: 24, recent_present: 13, recent_denominator: 16 })],
      AS_OF,
    );
    expect(c.evidence.map((e) => e.value)).toEqual([81.3, 91.7, 10.4, 5]);
    expect(c.severity).toBe("warning");
  });

  it("a drop of 15+ points is critical and needs approval", () => {
    const [c] = detectAttendance([sectionRow({ recent_present: 30, recent_denominator: 40 })], AS_OF); // 75%, drop 17
    expect(c.severity).toBe("critical");
    expect(c.approval_required).toBe(true);
  });

  it("a drop under 10 points is watch", () => {
    const [c] = detectAttendance([sectionRow({ recent_present: 34, recent_denominator: 40 })], AS_OF); // 85%, drop 7
    expect(c.severity).toBe("watch");
  });

  it("a drop of 4 points does not fire", () => {
    // 88% vs 92%
    expect(detectAttendance([sectionRow({ recent_present: 22, recent_denominator: 25, base_present: 23, base_denominator: 25 })], AS_OF)).toEqual([]);
  });

  it("only 2 recent school days does not fire", () => {
    expect(detectAttendance([sectionRow({ recent_days: 2 })], AS_OF)).toEqual([]);
  });

  it("fewer than 10 baseline days does not fire", () => {
    expect(detectAttendance([sectionRow({ base_days: 9 })], AS_OF)).toEqual([]);
  });

  it("recent attendance of 90% or more does not fire even with a large drop", () => {
    expect(
      detectAttendance([sectionRow({ recent_present: 36, recent_denominator: 40, base_present: 40, base_denominator: 40 })], AS_OF),
    ).toEqual([]);
  });

  it("an empty denominator does not fire", () => {
    expect(detectAttendance([sectionRow({ recent_denominator: 0, recent_present: 0 })], AS_OF)).toEqual([]);
  });
});

describe("detectAttendance: student_drop", () => {
  it("student falling from 95% to 60% over 5 marked days is watch", () => {
    const [c, ...rest] = detectAttendance([studentRow()], AS_OF);
    expect(rest).toHaveLength(0);
    expect(c.signal).toBe("attendance.student_drop");
    expect(c.severity).toBe("watch");
    expect(c.confidence).toBe(0.95); // 0.35 + 0.35 + 0.25
    expect(c.pattern).toBe("A student's attendance fell from 95% to 60% in the 7 days to 2026-11-01.");
    expect(c.date_from).toBe("2026-09-28");
    expect(c.date_to).toBe(AS_OF);
  });

  it("student at 40% recent is a warning", () => {
    const [c] = detectAttendance([studentRow({ recent_present: 2 })], AS_OF);
    expect(c.severity).toBe("warning");
  });

  it("a baseline denominator of 7 does not fire", () => {
    expect(detectAttendance([studentRow({ base_present: 7, base_denominator: 7 })], AS_OF)).toEqual([]);
  });

  it("a drop under 20 points does not fire", () => {
    // 80% vs 95%: recent <= 75 fails too, so use 75% vs 90%: drop 15
    expect(detectAttendance([studentRow({ recent_present: 3, recent_denominator: 4, base_present: 18, base_denominator: 20 })], AS_OF)).toEqual([]);
  });

  it("student candidates carry no name or id in text and no entity label", () => {
    const [c] = detectAttendance([studentRow()], AS_OF);
    expect(c.entity_type).toBe("student");
    expect(c.entity_id).toBe(STUDENT_ID);
    expect(c.entity_label).toBeNull();
    expect(c.class_section_id).toBe(SECTION_ID);
    expect(c.title).toBe("Attendance drop: a student in 8-A");
    for (const text of [c.title, c.pattern, ...c.recommended_actions]) {
      expect(text).not.toContain(STUDENT_ID);
      expect(text).not.toContain(SECTION_ID);
    }
  });
});

describe("detectAttendance: common", () => {
  it("dedupe keys use the ISO week of asOf", () => {
    const [s, st] = detectAttendance([sectionRow(), studentRow()], AS_OF);
    expect(s.dedupe_key).toBe(`attendance.section_drop:section:${SECTION_ID}:2026-W44`);
    expect(st.dedupe_key).toBe(`attendance.student_drop:student:${STUDENT_ID}:2026-W44`);
  });

  it("recommended actions are 1-2 plain strings of at most 160 chars with no digits", () => {
    for (const c of detectAttendance([sectionRow(), studentRow()], AS_OF)) {
      expect(c.recommended_actions.length).toBeGreaterThanOrEqual(1);
      expect(c.recommended_actions.length).toBeLessThanOrEqual(2);
      for (const a of c.recommended_actions) {
        expect(a.length).toBeLessThanOrEqual(160);
        expect(a).not.toMatch(/\d/);
      }
      expect(c.sources).toEqual(["attendance_sessions", "attendance_records"]);
    }
  });
});

describe("attendanceDetector", () => {
  it("is the attendance detector, version 1, on the attendance module", () => {
    expect(attendanceDetector.key).toBe("attendance");
    expect(attendanceDetector.module).toBe("attendance");
    expect(attendanceDetector.version).toBe(1);
  });

  it("run() pages the source in 1000s until a short page and passes the 75% student cap", async () => {
    const quiet = sectionRow({ recent_present: 40, recent_denominator: 40 }); // 100%, never fires
    const pages: AttendanceSourceRow[][] = [Array.from({ length: 1000 }, () => quiet), [sectionRow()]];
    const calls: { fn: string; args: unknown; from: number; to: number }[] = [];
    const admin = {
      rpc(fn: string, args: unknown) {
        const builder = {
          order: () => builder,
          range: async (from: number, to: number) => {
            calls.push({ fn, args, from, to });
            return { data: pages[calls.length - 1] ?? [], error: null };
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    const out = await attendanceDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} });

    expect(calls).toEqual([
      { fn: "insight_src_attendance", args: { p_institution_id: "inst-1", p_as_of: AS_OF, p_student_max_recent_pct: 75 }, from: 0, to: 999 },
      { fn: "insight_src_attendance", args: { p_institution_id: "inst-1", p_as_of: AS_OF, p_student_max_recent_pct: 75 }, from: 1000, to: 1999 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].signal).toBe("attendance.section_drop");
  });

  it("run() throws the source error", async () => {
    const failure = { message: "boom", code: "XX000" };
    const admin = {
      rpc() {
        const builder = { order: () => builder, range: async () => ({ data: null, error: failure }) };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;
    await expect(attendanceDetector.run(admin, { institutionId: "inst-1", asOf: AS_OF, settings: {} })).rejects.toBe(failure);
  });
});
