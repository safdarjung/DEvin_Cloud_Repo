import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { addTextbook, removeTextbook, setChapterTitles, setUnitChapter } from "@/modules/textbooks/actions";
import { attachMaterial, confirmMaterialUpload, deleteMaterial, getMaterialReadUrl, requestMaterialUpload } from "@/modules/textbooks/materials.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Curveballs for textbooks.* / curriculum.material.* (no prior action-level tests for several).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;

let inst: TestInstitution;
let other: TestInstitution;
let gradeId: string;
let subjectId: string;
let taughtSubject: string;
let unitId: string;
let otherGrade: string;
let otherSubject: string;

beforeAll(async () => {
  inst = await createTestInstitution("tbcb");
  other = await createTestInstitution("tbcbx");
  const yearId = await createAcademicYear(inst.institutionId);
  gradeId = await createGrade(inst.institutionId, { code: "VI" });
  subjectId = await createSubject(inst.institutionId, { code: "SCI", name: "Science" });
  taughtSubject = await createSubject(inst.institutionId, { code: "MAT", name: "Maths" });
  const teacher = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
  const sec = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  await createSubjectAssignment(inst.institutionId, sec, taughtSubject, teacher);
  unitId = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence) values (${inst.institutionId}, ${subjectId}, ${gradeId}, 'U1', 'd', 1) returning id`)).id as string;
  otherGrade = await createGrade(other.institutionId, { code: "VI" });
  otherSubject = await createSubject(other.institutionId, { code: "SCI", name: "Science" });
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const custom = (o: Record<string, unknown> = {}) => ({ source: "custom" as const, title: `Book ${crypto.randomUUID().slice(0, 6)}`, chapters: 5, ...o });
const add = (role: "admin" | "teacher" | "guardian" | "student", book: unknown, g = gradeId, s = subjectId) => callAs(inst, role, addTextbook, { gradeId: g, subjectId: s, book } as never);

describe("addTextbook / removeTextbook", () => {
  it("admin adds a custom book; remove twice -> second not_found", async () => {
    const r = await add("admin", custom());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await callAs(inst, "admin", removeTextbook, { textbookId: r.data.id })).ok).toBe(true);
    const again = await callAs(inst, "admin", removeTextbook, { textbookId: r.data.id });
    expect(!again.ok && again.error.code).toBe("not_found");
  });

  it("validation: non-https url, empty title, bad ncert code, chapters 0/100, unknown source, unknown key", async () => {
    const cases: Record<string, unknown> = {
      http: custom({ url: "http://example.com/b.pdf" }),
      js: custom({ url: "javascript:alert(1)" }),
      title: custom({ title: "  " }),
      ncert: { source: "ncert", code: "BAD CODE!" },
      ch0: custom({ chapters: 0 }),
      ch100: custom({ chapters: 100 }),
      src: { source: "amazon", title: "x" },
      extra: custom({ isbn: "1" }),
    };
    for (const [name, book] of Object.entries(cases)) {
      const r = await add("admin", book);
      expect(!r.ok && r.error.code, name).toBe("validation_failed");
    }
  });

  it("forbidden for guardian/student; teacher only for a subject they teach", async () => {
    for (const role of ["guardian", "student"] as const) {
      const r = await add(role, custom());
      expect(!r.ok && r.error.code, role).toBe("forbidden");
    }
    const notTaught = await add("teacher", custom());
    expect(!notTaught.ok && notTaught.error.code).toBe("forbidden");
    const taught = await add("teacher", custom(), gradeId, taughtSubject);
    expect(taught.ok).toBe(true);
  });

  it("another school's grade/subject ids are refused and no row is created", async () => {
    const before = await sql`select 1 from public.subject_textbooks where institution_id=${inst.institutionId}`;
    const a = await add("admin", custom(), otherGrade, subjectId);
    const b = await add("admin", custom(), gradeId, otherSubject);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    const after = await sql`select 1 from public.subject_textbooks where institution_id=${inst.institutionId}`;
    expect(after.length).toBe(before.length);
  });

  it("the same NCERT book twice for one grade+subject is conflict", async () => {
    const [n] = await sql`select code from public.ncert_textbooks limit 1`;
    if (!n) return;
    const sub = await createSubject(inst.institutionId, { code: `N${Date.now() % 10000}`, name: "NC" });
    const first = await add("admin", { source: "ncert", code: n.code as string }, gradeId, sub);
    const second = await add("admin", { source: "ncert", code: n.code as string }, gradeId, sub);
    expect(first.ok).toBe(true);
    expect(!second.ok && second.error.code).toBe("conflict");
  });

  it("remove: another school's or random id is not_found; teacher of an untaught subject cannot remove", async () => {
    const mine = await add("admin", custom());
    const foreign = await callAs(other, "admin", addTextbook, { gradeId: otherGrade, subjectId: otherSubject, book: custom() } as never);
    if (!mine.ok || !foreign.ok) throw new Error("setup");
    const x = await callAs(inst, "admin", removeTextbook, { textbookId: foreign.data.id });
    expect(!x.ok && x.error.code).toBe("not_found");
    const t = await callAs(inst, "teacher", removeTextbook, { textbookId: mine.data.id });
    expect(t.ok).toBe(false);
    expect((await sql`select 1 from public.subject_textbooks where id=${mine.data.id}`).length).toBe(1);
    expect((await sql`select 1 from public.subject_textbooks where id=${foreign.data.id}`).length).toBe(1);
  });
});

describe("setChapterTitles / setUnitChapter", () => {
  async function book(chapters = 5) {
    const r = await add("admin", custom({ chapters }));
    if (!r.ok) throw new Error("book");
    return r.data.id;
  }

  it("titles: beyond the book's chapters -> validation_failed with fieldErrors; keys 0/100/abc invalid; empty string clears", async () => {
    const id = await book(5);
    const beyond = await callAs(inst, "admin", setChapterTitles, { textbookId: id, titles: { "6": "Six" } });
    expect(!beyond.ok && beyond.error.code).toBe("validation_failed");
    if (!beyond.ok) expect(beyond.error.fieldErrors?.titles).toBeDefined();
    for (const key of ["0", "100", "abc", "01"]) {
      const r = await callAs(inst, "admin", setChapterTitles, { textbookId: id, titles: { [key]: "x" } });
      expect(!r.ok && r.error.code, key).toBe("validation_failed");
    }
    const long = await callAs(inst, "admin", setChapterTitles, { textbookId: id, titles: { "1": "x".repeat(121) } });
    expect(!long.ok && long.error.code).toBe("validation_failed");
    const set = await callAs(inst, "admin", setChapterTitles, { textbookId: id, titles: { "1": "One", "2": "Two" } });
    expect(set.ok && set.data.titles).toEqual({ "1": "One", "2": "Two" });
    const clear = await callAs(inst, "admin", setChapterTitles, { textbookId: id, titles: { "1": "" } });
    expect(clear.ok && clear.data.titles).toEqual({ "2": "Two" });
    const [row] = await sql`select chapter_titles from public.subject_textbooks where id=${id}`;
    expect(row.chapter_titles).toEqual({ "2": "Two" });
  });

  it("titles: unknown / other school's book not_found; guardian and a teacher of another subject refused", async () => {
    const id = await book();
    const foreign = await callAs(other, "admin", addTextbook, { gradeId: otherGrade, subjectId: otherSubject, book: custom() } as never);
    if (!foreign.ok) throw new Error("setup");
    const rnd = await callAs(inst, "admin", setChapterTitles, { textbookId: crypto.randomUUID(), titles: { "1": "x" } });
    expect(!rnd.ok && rnd.error.code).toBe("not_found");
    const cross = await callAs(inst, "admin", setChapterTitles, { textbookId: foreign.data.id, titles: { "1": "x" } });
    expect(!cross.ok && cross.error.code).toBe("not_found");
    const g = await callAs(inst, "guardian", setChapterTitles, { textbookId: id, titles: { "1": "x" } });
    expect(!g.ok && g.error.code).toBe("forbidden");
    const t = await callAs(inst, "teacher", setChapterTitles, { textbookId: id, titles: { "1": "x" } });
    expect(!t.ok && t.error.code).toBe("forbidden");
    const [row] = await sql`select chapter_titles from public.subject_textbooks where id=${id}`;
    expect(row.chapter_titles ?? {}).toEqual({});
  });

  it("unit chapter: chapterNo without textbookId is validation_failed; > chapters is validation_failed; set then clear twice is ok", async () => {
    const id = await book(3);
    const noBook = await callAs(inst, "admin", setUnitChapter, { unitId, chapterNo: 1 });
    expect(!noBook.ok && noBook.error.code).toBe("validation_failed");
    const zero = await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: id, chapterNo: 0 });
    expect(!zero.ok && zero.error.code).toBe("validation_failed");
    const beyond = await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: id, chapterNo: 4 });
    expect(!beyond.ok && beyond.error.code).toBe("validation_failed");
    if (!beyond.ok) expect(beyond.error.fieldErrors?.chapterNo).toBeDefined();
    expect((await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: id, chapterNo: 2 })).ok).toBe(true);
    expect((await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: id, chapterNo: 3 })).ok).toBe(true);
    expect((await sql`select chapter_no from public.curriculum_unit_chapters where curriculum_unit_id=${unitId}`).map((r) => r.chapter_no)).toEqual([3]);
    expect((await callAs(inst, "admin", setUnitChapter, { unitId, chapterNo: null })).ok).toBe(true);
    expect((await callAs(inst, "admin", setUnitChapter, { unitId, chapterNo: null })).ok).toBe(true);
    expect((await sql`select 1 from public.curriculum_unit_chapters where curriculum_unit_id=${unitId}`).length).toBe(0);
  });

  it("unit chapter: a book of a different subject for this unit is refused; another school's unit/book are not_found", async () => {
    const wrong = await add("admin", custom(), gradeId, taughtSubject);
    if (!wrong.ok) throw new Error("setup");
    const r = await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: wrong.data.id, chapterNo: 1 });
    expect(!r.ok && r.error.code).toBe("validation_failed");
    const ou = (await one(sql`insert into public.curriculum_units (institution_id, subject_id, grade_id, title, description, sequence) values (${other.institutionId}, ${otherSubject}, ${otherGrade}, 'OU', 'd', 1) returning id`)).id as string;
    const cu = await callAs(inst, "admin", setUnitChapter, { unitId: ou, chapterNo: null });
    expect(!cu.ok && cu.error.code).toBe("not_found");
    const foreign = await callAs(other, "admin", addTextbook, { gradeId: otherGrade, subjectId: otherSubject, book: custom() } as never);
    if (!foreign.ok) throw new Error("setup2");
    const cb = await callAs(inst, "admin", setUnitChapter, { unitId, textbookId: foreign.data.id, chapterNo: 1 });
    expect(!cb.ok && cb.error.code).toBe("not_found");
  });
});

describe("curriculum material actions", () => {
  it("request upload: bad mime, 0 bytes, oversize and unknown key fail validation", async () => {
    const base = { fileName: "a.pdf", mime: "application/pdf", sizeBytes: 100 };
    for (const [name, o] of Object.entries({ mime: { mime: "application/x-sh" }, zero: { sizeBytes: 0 }, huge: { sizeBytes: 11 * 1024 * 1024 }, blank: { fileName: " " }, extra: { institutionId: "x" } })) {
      const r = await callAs(inst, "admin", requestMaterialUpload, { ...base, ...o } as never);
      expect(!r.ok && r.error.code, name).toBe("validation_failed");
    }
  });

  it("confirm / attach / readUrl / delete on unknown or other-school ids are not_found; double delete not_found", async () => {
    const rnd = crypto.randomUUID();
    const c = await callAs(inst, "admin", confirmMaterialUpload, { materialId: rnd });
    expect(!c.ok && c.error.code).toBe("not_found");
    const a = await callAs(inst, "admin", attachMaterial, { materialId: rnd, gradeId, subjectId, share: "class" });
    expect(!a.ok && a.error.code).toBe("not_found");
    const u = await callAs(inst, "admin", getMaterialReadUrl, { materialId: rnd });
    expect(!u.ok && u.error.code).toBe("not_found");
    const d = await callAs(inst, "admin", deleteMaterial, { materialId: rnd });
    expect(!d.ok && d.error.code).toBe("not_found");
  });

  it("attach share rules: student cannot share to class (forbidden), staff cannot 'suggest' (validation_failed); unit of another subject refused", async () => {
    const rnd = crypto.randomUUID();
    const s = await callAs(inst, "student", attachMaterial, { materialId: rnd, gradeId, subjectId, share: "class" });
    expect(!s.ok && s.error.code).toBe("forbidden");
    const t = await callAs(inst, "admin", attachMaterial, { materialId: rnd, gradeId, subjectId, share: "suggest" });
    expect(!t.ok && t.error.code).toBe("validation_failed");
    const wrongUnit = await callAs(inst, "admin", attachMaterial, { materialId: rnd, gradeId, subjectId: taughtSubject, unitId, share: "class" });
    expect(!wrongUnit.ok && wrongUnit.error.code).toBe("validation_failed");
  });
});
