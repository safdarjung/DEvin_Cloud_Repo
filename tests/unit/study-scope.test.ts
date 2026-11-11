// 0140 item 8: the scope schema and the server-side context builder.
import { describe, expect, it } from "vitest";
import { SCOPE_MAX_CHARS, SCOPE_MAX_UNITS, StudyScopeSchema, buildScopeContext, chapterSummary, type ScopeAllowed } from "@/modules/study/scope";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MATH = U(900);
const SCI = U(901);
const BOOK = U(800);
const OTHER_GRADE_BOOK = U(801);

const allowed: ScopeAllowed = {
  subjects: [
    { id: MATH, name: "Mathematics" },
    { id: SCI, name: "Science" },
  ],
  books: [{ id: BOOK, subjectId: MATH, title: "Mathematics", ncert: true, chapterCount: 14, chapterTitles: { "1": "Real Numbers", "2": "Polynomials" } }],
  units: [
    { id: U(1), subjectId: MATH, title: "Real numbers", description: "Euclid's division lemma; HCF.", chapter: { textbookId: BOOK, no: 1 } },
    { id: U(2), subjectId: MATH, title: "Polynomials", description: "Zeroes and coefficients.", chapter: { textbookId: BOOK, no: 2 } },
    { id: U(3), subjectId: MATH, title: "Linear equations", description: "Pairs of linear equations.", chapter: { textbookId: BOOK, no: 3 } },
    { id: U(4), subjectId: SCI, title: "Light", description: "Reflection.", chapter: null },
  ],
  files: [
    { id: U(500), title: "My notes", subjectId: MATH, readable: true },
    { id: U(501), title: "Huge scan", subjectId: MATH, readable: false },
  ],
};

const build = (scope: unknown, extra: Partial<Parameters<typeof buildScopeContext>[0]> = {}) =>
  buildScopeContext({ scope: StudyScopeSchema.parse(scope), allowed, progress: {}, teacherMaterials: [], ...extra });

describe("StudyScopeSchema", () => {
  it("is ids only, strict and capped", () => {
    expect(StudyScopeSchema.safeParse({ subjectIds: [MATH], chapters: [{ textbookId: BOOK, chapterNo: 1 }] }).success).toBe(true);
    expect(StudyScopeSchema.safeParse({ subjectIds: [MATH], unitTitles: ["x"] }).success).toBe(false);
    expect(StudyScopeSchema.safeParse({ subjectIds: [] }).success).toBe(false);
    expect(StudyScopeSchema.safeParse({ subjectIds: [MATH], goal: "x".repeat(201) }).success).toBe(false);
    expect(StudyScopeSchema.safeParse({ subjectIds: [MATH], fileIds: [U(1), U(2), U(3), U(4)] }).success).toBe(false);
  });
});

describe("buildScopeContext", () => {
  it("two chapters of the Mathematics book: their units and outlines, the chapter titles, and the NCERT honesty line", () => {
    const r = build({ subjectIds: [MATH], chapters: [{ textbookId: BOOK, chapterNo: 2 }, { textbookId: BOOK, chapterNo: 1 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.unitIds).toEqual([U(1), U(2)]);
    const text = r.context.lines.join("\n");
    expect(text).toContain("Chapters: 1 (Real Numbers), 2 (Polynomials)");
    expect(text).toContain("You have NOT read this book");
    expect(text).toContain("Euclid's division lemma");
    expect(text).not.toContain("Linear equations");
  });

  it("drops ids from another grade, subject or school, and unreadable or foreign files", () => {
    const r = build({
      subjectIds: [MATH, U(999)],
      textbookIds: [OTHER_GRADE_BOOK],
      chapters: [{ textbookId: OTHER_GRADE_BOOK, chapterNo: 1 }, { textbookId: BOOK, chapterNo: 99 }],
      unitIds: [U(4), U(77), U(3)],
      fileIds: [U(501), U(502), U(500)],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.subjectIds).toEqual([MATH]);
    expect(r.context.unitIds).toEqual([U(3)]); // Science's unit is outside the chosen subjects
    expect(r.context.fileIds).toEqual([U(500)]);
    expect(r.context.textbookIds).toEqual([]);
    expect(r.context.chapters).toEqual([]);
    expect(r.context.lines.join("\n")).not.toContain("Book:"); // the other grade's book and the out-of-range chapter are gone
  });

  it("refuses a scope with nothing of the student's own left in it", () => {
    expect(build({ subjectIds: [U(999)] }).ok).toBe(false);
    expect(build({ subjectIds: [MATH], unitIds: [U(77)] }).ok).toBe(false);
  });

  it("is deterministic whatever order ids arrive in", () => {
    const a = build({ subjectIds: [SCI, MATH], unitIds: [U(4), U(2), U(1)] });
    const b = build({ subjectIds: [MATH, SCI], unitIds: [U(1), U(4), U(2)] });
    expect(a).toEqual(b);
  });

  it("adds the student's own accuracy and teacher-shared material titles for scoped units", () => {
    const r = build(
      { subjectIds: [MATH], unitIds: [U(2)] },
      { progress: { [U(2)]: { accuracy: 40, minutes: 25, lastStudied: null } }, teacherMaterials: [{ unitId: U(2), title: "Quiz: Polynomials" }, { unitId: U(9), title: "Other" }] },
    );
    if (!r.ok) throw new Error("fixture");
    const text = r.context.lines.join("\n");
    expect(text).toContain("40% correct, 25 min studied");
    expect(text).toContain("Teacher-shared material: Quiz: Polynomials");
    expect(text).not.toContain("Other");
  });

  it("caps units and total size; the goal line stays inside the context", () => {
    const many: ScopeAllowed = {
      ...allowed,
      units: Array.from({ length: 30 }, (_, i) => ({ id: U(100 + i), subjectId: MATH, title: `Unit ${i}`, description: "x".repeat(400), chapter: null })),
    };
    const r = buildScopeContext({ scope: StudyScopeSchema.parse({ subjectIds: [MATH], unitIds: many.units.slice(0, 24).map((u) => u.id), goal: "Revise for the test" }), allowed: many, progress: {}, teacherMaterials: [] });
    if (!r.ok) throw new Error("fixture");
    expect(r.context.unitIds).toHaveLength(SCOPE_MAX_UNITS);
    expect(r.context.lines.join("\n").length).toBeLessThanOrEqual(SCOPE_MAX_CHARS);
    expect(r.context.lines.join("\n")).toContain("Revise for the test");
  });
});

describe("chapterSummary", () => {
  it("counts studied chapters and names the weakest", () => {
    const s = chapterSummary(allowed.books[0]!, allowed.units, {
      [U(1)]: { accuracy: 80, minutes: 10, lastStudied: null },
      [U(2)]: { accuracy: 35, minutes: 0, lastStudied: null },
      [U(3)]: { accuracy: null, minutes: 0, lastStudied: null },
    });
    expect(s).toEqual({ studied: 2, total: 14, weakest: 2 });
  });
});
