import { describe, expect, test } from "vitest";
import { buildTimetableGrid, subjectPeriodRows } from "../../src/modules/timetable/grid";
import type { SectionTimetableSlot } from "../../src/modules/timetable/queries";

const slot = (weekday: number, seq: number): SectionTimetableSlot => ({
  weekday,
  period: { seq, name: `P${seq}`, startsAt: "09:00", endsAt: "09:40" },
  subject: { id: "s", name: "Maths" },
  teacher: { id: "t", name: "T" },
  room: null,
});

describe("buildTimetableGrid", () => {
  test("orders periods by seq and keys cells by weekday", () => {
    const g = buildTimetableGrid([slot(2, 2), slot(1, 1), slot(2, 1)]);
    expect(g.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(g.rows[0].cells.has(1)).toBe(true);
    expect(g.rows[0].cells.has(2)).toBe(true);
    expect(g.rows[1].cells.has(1)).toBe(false);
  });
  test("shows Mon-Sat by default and Sunday only when it has a slot", () => {
    expect(buildTimetableGrid([slot(1, 1)]).days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(buildTimetableGrid([slot(0, 1)]).days).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
  test("empty input yields no rows", () => {
    expect(buildTimetableGrid([]).rows).toEqual([]);
  });
});

describe("buildTimetableGrid with periods (0141 editor)", () => {
  test("empty periods still get a row so they can be filled", () => {
    const g = buildTimetableGrid([slot(1, 2)], [
      { seq: 1, name: "P1", startsAt: "08:00", endsAt: "08:45" },
      { seq: 2, name: "P2", startsAt: "08:45", endsAt: "09:30" },
    ]);
    expect(g.rows.map((r) => [r.seq, r.cells.size])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});

describe("subjectPeriodRows", () => {
  const withSubject = (name?: string) => ({ subject: name ? { id: name, name } : null });
  test("counts periods per subject, most first, with the real count as display text", () => {
    const rows = subjectPeriodRows([withSubject("Art"), withSubject("Maths"), withSubject("Maths"), withSubject()]);
    expect(rows).toEqual([
      { label: "Maths", value: 2, display: "2" },
      { label: "Art", value: 1, display: "1" },
      { label: "Period", value: 1, display: "1" },
    ]);
  });
});
