// M25-T3 — timetable fill engine fill_v1 (pure) + SuggestFillSchema.
import { describe, expect, it } from "vitest";
import {
  MAX_SAME_SUBJECT_PER_DAY,
  SUGGEST_ENGINE_VERSION,
  suggestFill,
  type SuggestInput,
} from "../../src/modules/timetable/suggest";
import { SlotInputSchema, SuggestFillSchema } from "../../src/modules/timetable/schemas";

const uid = (kind: number, n: number) =>
  `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n: number) => uid(1, n); // period
const S = (n: number) => uid(2, n); // section
const SUB = (n: number) => uid(3, n); // subject
const T = (n: number) => uid(4, n); // teacher
const R = (n: number) => uid(5, n); // room

const periods = (n: number) => Array.from({ length: n }, (_, i) => ({ id: P(i + 1), seq: i + 1, name: `Period ${i + 1}` }));
const assign = (section: number, subject: number, subjectName: string, teacher: number) => ({
  classSectionId: S(section),
  subjectId: SUB(subject),
  subjectName,
  teacherId: T(teacher),
  teacherName: `Teacher ${teacher}`,
});
const slot = (section: number, weekday: number, period: number, subject: number, teacher: number, room: number | null = null) => ({
  classSectionId: S(section),
  weekday,
  periodId: P(period),
  subjectId: SUB(subject),
  teacherId: T(teacher),
  roomId: room === null ? null : R(room),
});

function input(over: Partial<SuggestInput>): SuggestInput {
  return {
    periods: periods(1),
    sections: [{ id: S(1), label: "6-A" }],
    assignments: [],
    slots: [],
    rooms: [],
    maxPeriodsWeek: 36,
    limit: 200,
    ...over,
  };
}

const cellKey = (s: { weekday: number; periodId: string }) => `${s.weekday}|${s.periodId}`;

describe("suggestFill (fill_v1)", () => {
  it("exports the engine version and same-subject cap", () => {
    expect(SUGGEST_ENGINE_VERSION).toBe(1);
    expect(MAX_SAME_SUBJECT_PER_DAY).toBe(2);
  });

  it("an empty cell gets the subject with the largest deficit", () => {
    // 1 period x 6 days, k=2 -> target 3 each. English has 2 (deficit 1), Maths 0 (deficit 3).
    const base = input({
      assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
      slots: [slot(1, 1, 1, 2, 2), slot(1, 2, 1, 2, 2)],
    });
    const out = suggestFill(base);
    expect(out.suggestions[0].slot).toMatchObject({ weekday: 3, subjectId: SUB(1), teacherId: T(1) });
  });

  it("a teacher busy in another section at that cell is skipped for the next candidate", () => {
    const out = suggestFill(
      input({
        sections: [{ id: S(1), label: "6-A" }],
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        // section 2 (out of scope) uses teacher 1 on Wed period 1
        slots: [slot(1, 1, 1, 2, 2), slot(1, 2, 1, 2, 2), slot(2, 3, 1, 1, 1)],
      }),
    );
    expect(out.suggestions[0].slot).toMatchObject({ weekday: 3, subjectId: SUB(2), teacherId: T(2) });
  });

  it("on equal deficit picks the teacher with the lower load before subject name", () => {
    const out = suggestFill(
      input({
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        // teacher 2 (English) already teaches 2 periods elsewhere, teacher 1 none
        slots: [slot(2, 5, 1, 2, 2), slot(2, 6, 1, 2, 2)],
      }),
    );
    expect(out.suggestions[0].slot).toMatchObject({ weekday: 1, subjectId: SUB(1), teacherId: T(1) });
  });

  it("writes the action, rationale and expected outcome texts", () => {
    const out = suggestFill(
      input({
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        slots: [slot(1, 1, 1, 2, 2, 1), slot(1, 2, 1, 2, 2, 1)],
        rooms: [{ id: R(1), name: "R101" }],
      }),
    );
    // 0141: the rationale now also names the rules the choice kept, and the
    // passed-over candidates come back as `alternatives`.
    expect(out.suggestions[0]).toEqual({
      action: "Add Maths to 6-A, Wed period 1 (Period 1), with Teacher 1 in R101",
      owner: "Timetable manager",
      rationale:
        "Teacher 1 is free in this period and R101 is free; Maths has 0 of 3 periods a week in 6-A. Rules kept: max 2 Maths a day; Teacher 1 at 1 of 36 a week.",
      expected_outcome: "6-A Maths: 1 of 3 periods a week.",
      status: "planned",
      slot: { classSectionId: S(1), weekday: 3, periodId: P(1), subjectId: SUB(1), teacherId: T(1), roomId: R(1) },
      rules: ["fill_target", "max_same_subject_per_day", "max_teacher_per_week"],
      alternatives: [
        {
          subject: "English",
          teacher: "Teacher 2",
          teacherId: T(2),
          rule: "ranked_lower",
          reason: "English needs 1 more a week; Maths needs 3 (or Teacher 1 has fewer periods)",
        },
      ],
    });
  });

  it("a teacher at maxPeriodsWeek is never proposed", () => {
    const out = suggestFill(
      input({
        periods: periods(2),
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        // teacher 1 already teaches 2 periods elsewhere; teacher 2 has 1
        slots: [slot(2, 1, 1, 1, 1), slot(2, 1, 2, 1, 1), slot(3, 6, 2, 2, 2)],
        maxPeriodsWeek: 3,
      }),
    );
    const byTeacher = (t: number) => out.suggestions.filter((s) => s.slot.teacherId === T(t)).length;
    expect(byTeacher(1)).toBe(1);
    expect(byTeacher(2)).toBe(2);

    const full = suggestFill(
      input({ assignments: [assign(1, 1, "Maths", 1)], slots: [slot(2, 1, 1, 1, 1)], maxPeriodsWeek: 1 }),
    );
    expect(full.suggestions).toEqual([]);
    expect(full.unfilled).toBe(6);
  });

  it("a section never gets a third same-subject period in one day", () => {
    const out = suggestFill(input({ periods: periods(4), assignments: [assign(1, 1, "Maths", 1)] }));
    const perDay = new Map<number, number>();
    for (const s of out.suggestions) perDay.set(s.slot.weekday, (perDay.get(s.slot.weekday) ?? 0) + 1);
    expect([...perDay.values()].every((n) => n === MAX_SAME_SUBJECT_PER_DAY)).toBe(true);
    expect(out.suggestions).toHaveLength(12);
    expect(out.unfilled).toBe(24 - 12);
  });

  it("uses the home room when free and omits roomId when it is busy", () => {
    const out = suggestFill(
      input({
        sections: [{ id: S(1), label: "6-A" }],
        periods: periods(2),
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        // home room of 6-A = R1 (2 slots) over R2 (1 slot); section 2 holds R1 on Wed period 1
        slots: [slot(1, 1, 1, 1, 1, 1), slot(1, 1, 2, 2, 2, 1), slot(1, 2, 1, 1, 1, 2), slot(2, 3, 1, 3, 3, 1)],
        rooms: [
          { id: R(1), name: "R101" },
          { id: R(2), name: "R102" },
        ],
      }),
    );
    const wedP1 = out.suggestions.find((s) => s.slot.weekday === 3 && s.slot.periodId === P(1));
    expect(wedP1).toBeDefined();
    expect("roomId" in wedP1!.slot).toBe(false);
    expect(wedP1!.action).not.toContain(" in ");
    expect(wedP1!.rationale).not.toContain("R101");
    const others = out.suggestions.filter((s) => s !== wedP1);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((s) => s.slot.roomId === R(1))).toBe(true);
  });

  it("breaks a home-room tie by room name", () => {
    const out = suggestFill(
      input({
        periods: periods(2),
        assignments: [assign(1, 1, "Maths", 1)],
        slots: [slot(1, 1, 1, 1, 1, 1), slot(1, 1, 2, 1, 1, 2)],
        rooms: [
          { id: R(1), name: "Room B" },
          { id: R(2), name: "Room A" },
        ],
      }),
    );
    expect(out.suggestions[0].slot.roomId).toBe(R(2));
  });

  it("keeps (section|teacher|room, weekday, period) unique across existing slots and suggestions", () => {
    const sections = [
      { id: S(1), label: "6-A" },
      { id: S(2), label: "6-B" },
      { id: S(3), label: "7-A" },
    ];
    const assignments = [
      assign(1, 1, "Maths", 1), assign(1, 2, "English", 2), assign(1, 3, "Science", 3),
      assign(2, 1, "Maths", 1), assign(2, 2, "English", 2), assign(2, 3, "Science", 4),
      assign(3, 1, "Maths", 5), assign(3, 2, "English", 2), assign(3, 3, "Science", 3),
    ];
    const slots = [slot(1, 1, 1, 1, 1, 1), slot(2, 1, 2, 2, 2, 2), slot(3, 2, 3, 3, 3, 3), slot(2, 1, 1, 3, 4, 2)];
    const rooms = [1, 2, 3].map((n) => ({ id: R(n), name: `R${n}` }));
    const out = suggestFill(input({ sections, periods: periods(4), assignments, slots, rooms }));
    expect(out.suggestions.length).toBeGreaterThan(30);

    const all = [...slots, ...out.suggestions.map((s) => ({ ...s.slot, roomId: s.slot.roomId ?? null }))];
    const unique = (keys: string[]) => new Set(keys).size === keys.length;
    expect(unique(all.map((s) => `${s.classSectionId}|${cellKey(s)}`))).toBe(true);
    expect(unique(all.map((s) => `${s.teacherId}|${cellKey(s)}`))).toBe(true);
    expect(unique(all.filter((s) => s.roomId).map((s) => `${s.roomId}|${cellKey(s)}`))).toBe(true);
  });

  it("is deterministic: same input twice or shuffled arrays give deep-equal output", () => {
    const base = input({
      sections: [
        { id: S(2), label: "10-A" },
        { id: S(1), label: "9-A" },
      ],
      periods: periods(3),
      assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2), assign(2, 1, "Maths", 1), assign(2, 3, "Hindi", 3)],
      slots: [slot(1, 1, 1, 1, 1, 1), slot(2, 1, 2, 3, 3, 2), slot(2, 4, 3, 1, 1, 1)],
      rooms: [
        { id: R(1), name: "R1" },
        { id: R(2), name: "R2" },
      ],
    });
    const rotate = <X>(xs: X[]) => [...xs.slice(1), xs[0]];
    const shuffled: SuggestInput = {
      ...base,
      sections: [...base.sections].reverse(),
      periods: rotate(base.periods),
      assignments: rotate([...base.assignments].reverse()),
      slots: rotate(base.slots),
      rooms: [...base.rooms].reverse(),
    };
    const first = suggestFill(base);
    expect(suggestFill(base)).toEqual(first);
    expect(suggestFill(shuffled)).toEqual(first);
  });

  it("visits sections by numeric label order", () => {
    const out = suggestFill(
      input({
        sections: [
          { id: S(1), label: "10-A" },
          { id: S(2), label: "9-A" },
        ],
        assignments: [assign(1, 1, "Maths", 1), assign(2, 1, "Maths", 2)],
        limit: 1,
      }),
    );
    expect(out.suggestions[0].slot.classSectionId).toBe(S(2));
  });

  it("limit 3 -> 3 suggestions, truncated, unfilled = empty cells - 3; a section without assignments counts as unfilled", () => {
    const over = {
      sections: [
        { id: S(1), label: "6-A" },
        { id: S(2), label: "6-B" },
      ],
      periods: periods(2),
      assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
    };
    const cut = suggestFill(input({ ...over, limit: 3 }));
    expect(cut.suggestions).toHaveLength(3);
    expect(cut.truncated).toBe(true);
    expect(cut.unfilled).toBe(24 - 3);

    const all = suggestFill(input(over));
    expect(all.suggestions).toHaveLength(12);
    expect(all.truncated).toBe(false);
    expect(all.unfilled).toBe(12);
    expect(all.suggestions.every((s) => s.slot.classSectionId === S(1))).toBe(true);
  });

  it("emits slots that parse with SlotInputSchema, texts within limits, status planned", () => {
    const long = "x".repeat(150);
    const out = suggestFill(
      input({
        sections: [{ id: S(1), label: `6-${long}` }],
        periods: [{ id: P(1), seq: 1, name: "y".repeat(30) }],
        assignments: [{ ...assign(1, 1, "Maths", 1), subjectName: `Maths ${long}`, teacherName: `Teacher ${long}` }],
        slots: [slot(1, 6, 1, 1, 1, 1)],
        rooms: [{ id: R(1), name: "z".repeat(40) }],
      }),
    );
    expect(out.suggestions.length).toBe(5);
    for (const s of out.suggestions) {
      expect(SlotInputSchema.safeParse(s.slot).success).toBe(true);
      expect(s.action.length).toBeLessThanOrEqual(200);
      expect(s.rationale.length).toBeLessThanOrEqual(500);
      expect(s.expected_outcome.length).toBeLessThanOrEqual(300);
      expect(s.action.endsWith("…")).toBe(true);
      expect(s.owner).toBe("Timetable manager");
      expect(s.status).toBe("planned");
    }
  });
});

describe("SuggestFillSchema", () => {
  const versionId = uid(9, 1);

  it("accepts a version id and defaults limit to 200", () => {
    const r = SuggestFillSchema.safeParse({ versionId });
    expect(r.success && r.data.limit).toBe(200);
  });

  it("accepts section ids and a limit within 1-200", () => {
    expect(SuggestFillSchema.safeParse({ versionId, classSectionIds: [S(1)], limit: 1 }).success).toBe(true);
    expect(SuggestFillSchema.safeParse({ versionId, limit: 200 }).success).toBe(true);
  });

  it("rejects limit 201, limit 0 and a fractional limit", () => {
    expect(SuggestFillSchema.safeParse({ versionId, limit: 201 }).success).toBe(false);
    expect(SuggestFillSchema.safeParse({ versionId, limit: 0 }).success).toBe(false);
    expect(SuggestFillSchema.safeParse({ versionId, limit: 1.5 }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(SuggestFillSchema.safeParse({ versionId, extra: 1 }).success).toBe(false);
  });

  it("rejects 101 section ids and an empty list", () => {
    const ids = Array.from({ length: 101 }, (_, i) => S(i + 1));
    expect(SuggestFillSchema.safeParse({ versionId, classSectionIds: ids }).success).toBe(false);
    expect(SuggestFillSchema.safeParse({ versionId, classSectionIds: [] }).success).toBe(false);
  });

  it("rejects a non-uuid version id", () => {
    expect(SuggestFillSchema.safeParse({ versionId: "nope" }).success).toBe(false);
  });
});
