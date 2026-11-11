// 0141 — configurable timetable rules: engine behaviour per rule, "why not"
// explanations, the violations checklist, version diff, rollback
// compensation and substitute ranking. All pure.
import { describe, expect, it } from "vitest";
import { suggestFill, type SuggestInput } from "../../src/modules/timetable/suggest";
import { defaultRules, resolveRules, TimetableRulesSchema, type TimetableRules } from "../../src/modules/timetable/rules";
import {
  changesToReach,
  checkViolations,
  diffSlots,
  rankSubstitutes,
  rollbackChange,
  type CellSlot,
  type CheckModel,
} from "../../src/modules/timetable/checks";

const uid = (kind: number, n: number) => `${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n: number) => uid(1, n);
const S = (n: number) => uid(2, n);
const SUB = (n: number) => uid(3, n);
const T = (n: number) => uid(4, n);
const R = (n: number) => uid(5, n);

const periods = (n: number, lunchAfter = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: P(i + 1),
    seq: i + 1,
    name: `Period ${i + 1}`,
    ...(lunchAfter ? { band: (i + 1 <= lunchAfter ? "before_lunch" : "after_lunch") as "before_lunch" | "after_lunch" } : {}),
  }));
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

function rules(patch: Partial<TimetableRules> = {}): TimetableRules {
  return { ...defaultRules(36), ...patch };
}

function input(over: Partial<SuggestInput>): SuggestInput {
  return { periods: periods(1), sections: [{ id: S(1), label: "6-A" }], assignments: [], slots: [], rooms: [], maxPeriodsWeek: 36, limit: 200, ...over };
}

const perDay = (out: ReturnType<typeof suggestFill>, subject = SUB(1)) => {
  const m = new Map<number, number>();
  for (const s of out.suggestions) if (s.slot.subjectId === subject) m.set(s.slot.weekday, (m.get(s.slot.weekday) ?? 0) + 1);
  return m;
};

describe("rules: defaults, resolve and validation", () => {
  it("defaults reproduce the old engine: same slots as with rules omitted", () => {
    const base = input({ periods: periods(4), assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)], slots: [slot(1, 1, 1, 2, 2)] });
    const withDefaults = suggestFill({ ...base, rules: defaultRules(36) });
    expect(withDefaults.suggestions.map((s) => s.slot)).toEqual(suggestFill(base).suggestions.map((s) => s.slot));
  });

  it("a stored rule with a bad value falls back to its default, valid keys are kept", () => {
    const r = resolveRules({ max_same_subject_per_day: { enabled: true, value: 99 }, max_teacher_per_day: { enabled: true, value: 5 }, junk: 1 }, 30);
    expect(r.max_same_subject_per_day).toEqual({ enabled: true, value: 2 });
    expect(r.max_teacher_per_day).toEqual({ enabled: true, value: 5 });
    expect(r.max_teacher_per_week.value).toBe(30);
  });

  it("the full schema rejects out-of-range values and unknown keys", () => {
    expect(TimetableRulesSchema.safeParse(defaultRules()).success).toBe(true);
    expect(TimetableRulesSchema.safeParse({ ...defaultRules(), max_teacher_per_day: { enabled: true, value: 0 } }).success).toBe(false);
    expect(TimetableRulesSchema.safeParse({ ...defaultRules(), extra: { enabled: true, value: 1 } }).success).toBe(false);
  });
});

describe("suggestFill with configurable rules", () => {
  it("same subject per day: value 1 gives one Maths a day, off lets it fill every period", () => {
    const base = input({ periods: periods(4), assignments: [assign(1, 1, "Maths", 1)] });
    const one = suggestFill({ ...base, rules: rules({ max_same_subject_per_day: { enabled: true, value: 1 } }) });
    expect([...perDay(one).values()].every((n) => n === 1)).toBe(true);
    const off = suggestFill({ ...base, rules: rules({ max_same_subject_per_day: { enabled: false, value: 2 } }) });
    expect(off.suggestions).toHaveLength(24);
  });

  it("teacher periods per day caps one teacher's day across sections", () => {
    const base = input({
      periods: periods(4),
      sections: [{ id: S(1), label: "6-A" }, { id: S(2), label: "6-B" }],
      assignments: [assign(1, 1, "Maths", 1), assign(2, 1, "Maths", 1)],
      rules: rules({ max_same_subject_per_day: { enabled: false, value: 2 }, max_teacher_per_day: { enabled: true, value: 3 } }),
    });
    const out = suggestFill(base);
    const day1 = out.suggestions.filter((s) => s.slot.weekday === 1).length;
    expect(day1).toBe(3);
    // Mon P4 stays empty, and says why.
    const monP4 = out.blocked.find((b) => b.classSectionId === S(1) && b.weekday === 1 && b.periodId === P(4));
    expect(monP4?.label).toBe("6-A · Mon · Period 4");
    expect(monP4?.reasons[0]).toMatchObject({ rule: "max_teacher_per_day", reason: "Teacher 1 already has 3 periods on Mon (max 3)" });
  });

  it("back-to-back periods: max 2 in a row leaves a gap in a 4-period day", () => {
    const out = suggestFill(
      input({
        periods: periods(4),
        assignments: [assign(1, 1, "Maths", 1)],
        rules: rules({ max_same_subject_per_day: { enabled: false, value: 2 }, max_consecutive_teacher: { enabled: true, value: 2 } }),
      }),
    );
    const mon = out.suggestions.filter((s) => s.slot.weekday === 1).map((s) => s.slot.periodId);
    expect(mon).toEqual([P(1), P(2), P(4)]);
  });

  it("teacher periods per week: value 2 stops after two", () => {
    const out = suggestFill(input({ periods: periods(2), assignments: [assign(1, 1, "Maths", 1)], rules: rules({ max_teacher_per_week: { enabled: true, value: 2 } }) }));
    expect(out.suggestions).toHaveLength(2);
  });

  it("teacher unavailable: never placed on that day; off places them", () => {
    const unavailable = { enabled: true, value: [{ teacherId: T(1), weekday: 1 }] };
    const on = suggestFill(input({ assignments: [assign(1, 1, "Maths", 1)], rules: rules({ teacher_unavailable: unavailable }) }));
    expect(on.suggestions.some((s) => s.slot.weekday === 1)).toBe(false);
    const off = suggestFill(input({ assignments: [assign(1, 1, "Maths", 1)], rules: rules({ teacher_unavailable: { ...unavailable, enabled: false } }) }));
    expect(off.suggestions.some((s) => s.slot.weekday === 1)).toBe(true);
  });

  it("subject time band: Maths before lunch only goes in morning periods", () => {
    const band = { enabled: true, value: [{ subjectId: SUB(1), band: "before_lunch" as const }] };
    const out = suggestFill(input({ periods: periods(4, 2), assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "Art", 2)], rules: rules({ subject_time_band: band }) }));
    const mathsPeriods = new Set(out.suggestions.filter((s) => s.slot.subjectId === SUB(1)).map((s) => s.slot.periodId));
    expect([...mathsPeriods].every((p) => p === P(1) || p === P(2))).toBe(true);
    const off = suggestFill(input({ periods: periods(4, 2), assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "Art", 2)] }));
    expect(off.suggestions.some((s) => s.slot.subjectId === SUB(1) && (s.slot.periodId === P(3) || s.slot.periodId === P(4)))).toBe(true);
  });

  it("lab subjects go in a free lab; with no lab free they are not placed and say why", () => {
    const lab = { enabled: true, value: [SUB(1)] };
    const rooms = [{ id: R(1), name: "Room 1", kind: "classroom" }, { id: R(2), name: "Lab 1", kind: "lab" }];
    const out = suggestFill(input({ assignments: [assign(1, 1, "Science", 1)], rooms, slots: [slot(1, 6, 1, 1, 1, 1)], rules: rules({ lab_rooms: lab }) }));
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out.suggestions.every((s) => s.slot.roomId === R(2))).toBe(true);

    const busyLab = suggestFill(
      input({
        assignments: [assign(1, 1, "Science", 1), assign(1, 2, "English", 2)],
        rooms,
        slots: [slot(2, 1, 1, 9, 9, 2)], // section 2 holds the lab on Monday
        rules: rules({ lab_rooms: lab }),
      }),
    );
    const mon = busyLab.suggestions.find((s) => s.slot.weekday === 1)!;
    expect(mon.slot.subjectId).toBe(SUB(2));
    expect(mon.alternatives.find((a) => a.subject === "Science")?.rule).toBe("lab_rooms");
  });

  it("spread across the week: Maths is not doubled on Monday while later days are free", () => {
    // English already has its 6; the free cells are Mon P1+P2 and Tue-Fri P2.
    const english = [slot(1, 2, 1, 2, 2), slot(1, 3, 1, 2, 2), slot(1, 4, 1, 2, 2), slot(1, 5, 1, 2, 2), slot(1, 6, 1, 2, 2), slot(1, 6, 2, 2, 2)];
    const base = input({ periods: periods(2), assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)], slots: english });
    const plain = suggestFill(base);
    expect(perDay(plain).get(1)).toBe(2);
    const spread = suggestFill({ ...base, rules: rules({ spread_across_week: { enabled: true, value: 1 } }) });
    expect([...perDay(spread).values()].every((n) => n === 1)).toBe(true);
    const monP2 = spread.suggestions.find((s) => s.slot.weekday === 2)!;
    expect(monP2).toBeDefined();
  });

  it("every suggestion names its rules and states them in the rationale", () => {
    const out = suggestFill(input({ periods: periods(2), assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)] }));
    for (const s of out.suggestions) {
      expect(s.rules).toContain("fill_target");
      expect(s.rules).toContain("max_same_subject_per_day");
      expect(s.rules).toContain("max_teacher_per_week");
      expect(s.rationale).toContain("Rules kept:");
    }
  });

  it("why not Ms X: a passed-over teacher comes with the rule and the numbers", () => {
    const out = suggestFill(
      input({
        periods: periods(3),
        assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2)],
        // teacher 2 already teaches 2 periods on Monday elsewhere; 6-A's Mon P1/P2 are taken by teacher 3
        slots: [slot(2, 1, 1, 2, 2), slot(2, 1, 2, 2, 2), slot(1, 1, 1, 3, 3), slot(1, 1, 2, 3, 3)],
        rules: rules({ max_teacher_per_day: { enabled: true, value: 2 } }),
      }),
    );
    const monP3 = out.suggestions.find((s) => s.slot.weekday === 1 && s.slot.periodId === P(3))!;
    expect(monP3.slot.teacherId).toBe(T(1));
    expect(monP3.alternatives).toContainEqual({
      subject: "English",
      teacher: "Teacher 2",
      teacherId: T(2),
      rule: "max_teacher_per_day",
      reason: "Teacher 2 already has 2 periods on Mon (max 2)",
    });
  });

  it("is deterministic with rules on: shuffled input gives the same output", () => {
    const r = rules({ max_teacher_per_day: { enabled: true, value: 3 }, spread_across_week: { enabled: true, value: 1 } });
    const base = input({
      periods: periods(3),
      sections: [{ id: S(1), label: "6-A" }, { id: S(2), label: "6-B" }],
      assignments: [assign(1, 1, "Maths", 1), assign(1, 2, "English", 2), assign(2, 1, "Maths", 1), assign(2, 3, "Hindi", 3)],
      rules: r,
    });
    const shuffled = { ...base, sections: [...base.sections].reverse(), assignments: [...base.assignments].reverse(), periods: [...base.periods].reverse() };
    expect(suggestFill(shuffled)).toEqual(suggestFill(base));
  });
});

const names = { sectionLabels: { [S(1)]: "6-A" }, subjectNames: { [SUB(1)]: "Maths", [SUB(2)]: "Science" }, teacherNames: { [T(1)]: "Ms Iyer" } };
const model = (slots: CellSlot[], r: TimetableRules, extra: Partial<CheckModel> = {}): CheckModel => ({
  periods: periods(4, 2),
  slots,
  rooms: [{ id: R(1), name: "Room 1", kind: "classroom" }],
  rules: r,
  ...names,
  ...extra,
});

describe("checkViolations (publish checklist)", () => {
  const threeMathsMonday = [slot(1, 1, 1, 1, 1, 1), slot(1, 1, 2, 1, 1, 1), slot(1, 1, 3, 1, 1, 1)];

  it("lists each broken rule with section/teacher and a readable message", () => {
    const v = checkViolations(
      model(threeMathsMonday, rules({ max_teacher_per_day: { enabled: true, value: 2 }, max_consecutive_teacher: { enabled: true, value: 2 } })),
    );
    expect(v.map((x) => x.rule)).toEqual(["max_consecutive_teacher", "max_same_subject_per_day", "max_teacher_per_day"]);
    expect(v.find((x) => x.rule === "max_same_subject_per_day")).toMatchObject({ sectionId: S(1), message: "6-A has 3 Maths on Mon (max 2)" });
    expect(v.find((x) => x.rule === "max_teacher_per_day")?.message).toBe("Ms Iyer has 3 periods on Mon (max 2)");
  });

  it("a disabled rule reports nothing", () => {
    expect(checkViolations(model(threeMathsMonday, rules({ max_same_subject_per_day: { enabled: false, value: 2 } })))).toEqual([]);
  });

  it("flags unavailable teachers, wrong time band and lab subjects outside labs", () => {
    const r = rules({
      teacher_unavailable: { enabled: true, value: [{ teacherId: T(1), weekday: 2, periodId: P(4) }] },
      subject_time_band: { enabled: true, value: [{ subjectId: SUB(1), band: "before_lunch" }] },
      lab_rooms: { enabled: true, value: [SUB(2)] },
    });
    const v = checkViolations(model([slot(1, 2, 4, 1, 1, 1), slot(1, 3, 1, 2, 1, 1)], r));
    expect(v.map((x) => x.rule)).toEqual(["lab_rooms", "subject_time_band", "teacher_unavailable"]);
  });

  it("spread: two Maths on one day while other days are free is a violation", () => {
    const v = checkViolations(model([slot(1, 1, 1, 1, 1), slot(1, 1, 3, 1, 1)], rules({ spread_across_week: { enabled: true, value: 1 } })));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("spread_across_week");
  });
});

describe("diffSlots (Compare with…)", () => {
  it("reports added, removed and changed cells and skips identical ones", () => {
    const a = [slot(1, 1, 1, 1, 1, 1), slot(1, 1, 2, 1, 1, 1), slot(1, 1, 3, 2, 1, 1)];
    const b = [slot(1, 1, 1, 1, 1, 1), slot(1, 1, 3, 2, 1, null), slot(1, 2, 1, 1, 1, 1)];
    const d = diffSlots(a, b);
    expect(d.map((x) => [x.weekday, x.periodId, x.kind])).toEqual([
      [1, P(2), "removed"],
      [1, P(3), "changed"],
      [2, P(1), "added"],
    ]);
    expect(d[1]).toMatchObject({ before: { roomId: R(1) }, after: { roomId: null } });
  });

  it("changesToReach turns the diff into guarded changes", () => {
    const ch = changesToReach([slot(1, 1, 1, 1, 1)], [slot(1, 1, 1, 2, 1)], "Restored snapshot");
    expect(ch).toEqual([
      {
        classSectionId: S(1),
        weekday: 1,
        periodId: P(1),
        after: { subjectId: SUB(2), teacherId: T(1), roomId: null },
        expect: { subjectId: SUB(1), teacherId: T(1), roomId: null },
        reason: "Restored snapshot",
      },
    ]);
  });
});

describe("rollbackChange (undo compensation)", () => {
  const cell = { classSectionId: S(1), weekday: 2, periodId: P(3), kind: "manual", label: "6-A · Tue · Period 3" };
  const maths = { subjectId: SUB(1), teacherId: T(1), roomId: null };
  const science = { subjectId: SUB(2), teacherId: T(1), roomId: R(1) };

  it("puts back what was there, guarded by what the change left", () => {
    expect(rollbackChange({ ...cell, reason: "Lab free on Tuesday", before: maths, after: science })).toEqual({
      classSectionId: S(1),
      weekday: 2,
      periodId: P(3),
      after: maths,
      expect: science,
      reason: "Rollback of: Lab free on Tuesday",
    });
  });

  it("undoing an add clears the cell; a note is appended", () => {
    const undo = rollbackChange({ ...cell, reason: "Filled", before: null, after: maths }, "wrong class");
    expect(undo.after).toBeNull();
    expect(undo.expect).toEqual(maths);
    expect(undo.reason).toBe("Rollback of: Filled Note: wrong class");
  });
});

describe("rankSubstitutes", () => {
  const cands = [
    { staffId: "a", name: "Mr Apte", periodsWeek: 20, periodsToday: 5, teachesSubject: false, teachesGrade: false, coveringToday: 0 },
    { staffId: "b", name: "Ms Bose", periodsWeek: 30, periodsToday: 2, teachesSubject: true, teachesGrade: true, coveringToday: 0 },
    { staffId: "c", name: "Mr Rao", periodsWeek: 25, periodsToday: 1, teachesSubject: true, teachesGrade: false, coveringToday: 1 },
  ];

  it("off: fewest periods a week first (the old order)", () => {
    expect(rankSubstitutes(cands, defaultRules()).map((c) => c.staffId)).toEqual(["a", "c", "b"]);
  });

  it("on: same subject and grade first, with the reasons spelled out", () => {
    const on = rankSubstitutes(cands, rules({ substitute_ranking: { enabled: true, value: { sameSubject: 4, sameGrade: 2, fewestToday: 1, notCovering: 3 } } }), "Maths");
    expect(on.map((c) => c.staffId)).toEqual(["b", "c", "a"]);
    expect(on[0].why).toBe("teaches Maths, teaches this grade, 2 periods that day, not covering, 30 a week");
  });
});
