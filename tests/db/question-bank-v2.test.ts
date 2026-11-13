import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  approveQuestion,
  archiveQuestion,
  createQuestion,
  duplicateQuestion,
  rejectQuestion,
  submitForReview,
  updateQuestion,
} from "@/modules/question-bank/actions";
import { exportQuestions, importQuestions } from "@/modules/question-bank/csv.actions";
import {
  addToCollection,
  createCollection,
  updateCollection,
} from "@/modules/question-bank/collections.actions";
import { deleteTopic, upsertTopic } from "@/modules/academics/topics.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

interface Base {
  gradeId: string;
  subjectTaught: string;
  subjectUntaught: string;
  unitId: string;
  teacherUserId: string;
}

let inst: TestInstitution;
let other: TestInstitution;
let base: Base;

async function buildBase(fixture: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(fixture.institutionId);
  const gradeId = await createGrade(fixture.institutionId);
  const sectionA = await createClassSection(fixture.institutionId, gradeId, yearId, { name: "A" });
  const subjectTaught = await createSubject(fixture.institutionId, { code: "MATH" });
  const subjectUntaught = await createSubject(fixture.institutionId, { code: "SCI" });
  const [teacher] = await sql`
    select user_id, staff_id from public.memberships where institution_id = ${fixture.institutionId} and role = 'teacher'
  `;
  await createSubjectAssignment(fixture.institutionId, sectionA, subjectTaught, teacher.staff_id as string);
  const [unit] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${fixture.institutionId}, ${subjectTaught}, ${gradeId}, 'Numbers', 1) returning id
  `;
  return { gradeId, subjectTaught, subjectUntaught, unitId: unit.id as string, teacherUserId: teacher.user_id as string };
}

function shortInput(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: base.subjectTaught,
    gradeId: base.gradeId,
    type: "short_answer" as const,
    difficulty: "easy" as const,
    body: `Explain place value ${crypto.randomUUID()}`,
    answer: "Digit value depends on position.",
    marks: 2,
    ...overrides,
  };
}

async function insertRaw(fixture: TestInstitution, b: Base, overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    institution_id: fixture.institutionId,
    subject_id: b.subjectTaught,
    grade_id: b.gradeId,
    type: "short_answer",
    difficulty: "easy",
    body: `Raw question ${crypto.randomUUID()}`,
    answer: "x",
    marks: 1,
    created_by: b.teacherUserId,
    ...overrides,
  };
  const [r] = await sql`insert into public.question_bank ${sql(row)} returning id`;
  return r.id as string;
}

beforeAll(async () => {
  [inst, other] = await Promise.all([createTestInstitution("qb-v2"), createTestInstitution("qb-v2-other")]);
  base = await buildBase(inst);
  await buildBase(other);
}, 60_000);

afterAll(async () => {
  await Promise.all([inst.cleanup(), other.cleanup()]);
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

describe("question bank v2 — status and review rules", () => {
  it("existing rows were backfilled: is_active mirrors approved", async () => {
    const id = await insertRaw(inst, base);
    const [row] = await sql`select status, origin, is_active, version from public.question_bank where id = ${id}`;
    expect(row).toMatchObject({ status: "approved", origin: "manual", is_active: true, version: 1 });
  });

  it("a manual question is saved approved; an AI question is saved as a draft", async () => {
    const manual = await callAs(inst, "teacher", createQuestion, shortInput());
    const ai = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai", aiModel: "gemini-test" }));
    expect(manual).toMatchObject({ ok: true, data: { status: "approved" } });
    expect(ai).toMatchObject({ ok: true, data: { status: "draft" } });
    if (!ai.ok) return;
    const [row] = await sql`select origin, ai_model, is_active from public.question_bank where id = ${ai.data.id}`;
    expect(row).toMatchObject({ origin: "ai", ai_model: "gemini-test", is_active: false });
  });

  it("teacher cannot approve an AI draft — not via the action, not via a direct update", async () => {
    const draft = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai" }));
    if (!draft.ok) throw new Error("setup failed");
    const viaAction = await callAs(inst, "teacher", approveQuestion, { id: draft.data.id });
    expect(viaAction).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const { error } = await inst.clientAs("teacher").from("question_bank").update({ status: "approved" }).eq("id", draft.data.id);
    expect(error?.message).toBe("code:forbidden");

    const { error: insertError } = await inst
      .clientAs("teacher")
      .from("question_bank")
      .insert({
        institution_id: inst.institutionId,
        subject_id: base.subjectTaught,
        grade_id: base.gradeId,
        type: "short_answer",
        difficulty: "easy",
        body: "Sneaky approved AI question",
        answer: "x",
        marks: 1,
        origin: "ai",
        status: "approved",
        created_by: base.teacherUserId,
      });
    expect(insertError?.message).toBe("code:forbidden");
  });

  it("submit -> reject needs a note -> resubmit -> approve stamps the reviewer", async () => {
    const draft = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai" }));
    if (!draft.ok) throw new Error("setup failed");
    const id = draft.data.id;

    expect(await callAs(inst, "teacher", submitForReview, { id })).toMatchObject({ ok: true, data: { status: "in_review" } });
    expect(await callAs(inst, "exam_controller", rejectQuestion, { id, note: "Answer is incomplete." })).toMatchObject({
      ok: true,
      data: { status: "rejected" },
    });
    expect(await callAs(inst, "exam_controller", approveQuestion, { id })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(await callAs(inst, "teacher", submitForReview, { id })).toMatchObject({ ok: true });
    expect(await callAs(inst, "exam_controller", approveQuestion, { id })).toMatchObject({ ok: true, data: { status: "approved" } });

    const [row] = await sql`select status, is_active, reviewed_by, reviewed_at, review_note from public.question_bank where id = ${id}`;
    const [controller] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'exam_controller'`;
    expect(row).toMatchObject({ status: "approved", is_active: true, reviewed_by: controller.user_id });
    expect(row.reviewed_at).not.toBeNull();
  });

  it("an approved AI question is locked for the teacher; duplicate makes an editable draft v2", async () => {
    const draft = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai" }));
    if (!draft.ok) throw new Error("setup failed");
    await callAs(inst, "exam_controller", approveQuestion, { id: draft.data.id });

    const edit = await callAs(inst, "teacher", updateQuestion, { ...shortInput(), id: draft.data.id, body: "Changed after approval" });
    expect(edit).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const copy = await callAs(inst, "teacher", duplicateQuestion, { id: draft.data.id });
    expect(copy).toMatchObject({ ok: true, data: { status: "draft" } });
    if (!copy.ok) return;
    const [row] = await sql`select version, parent_question_id, origin, status, created_by from public.question_bank where id = ${copy.data.id}`;
    expect(row).toMatchObject({ version: 2, parent_question_id: draft.data.id, origin: "ai", status: "draft", created_by: base.teacherUserId });
  });

  it("archive/restore goes through status; restoring an AI question returns it to draft", async () => {
    const ai = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai" }));
    if (!ai.ok) throw new Error("setup failed");
    await callAs(inst, "teacher", archiveQuestion, { id: ai.data.id, isActive: false });
    const restored = await callAs(inst, "teacher", archiveQuestion, { id: ai.data.id, isActive: true });
    expect(restored).toMatchObject({ ok: true, data: { isActive: false } });
    const [row] = await sql`select status from public.question_bank where id = ${ai.data.id}`;
    expect(row.status).toBe("draft");
  });
});

describe("question bank v2 — security review fixes", () => {
  async function approvedAi(): Promise<string> {
    const draft = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "ai" }));
    if (!draft.ok) throw new Error("setup failed");
    const ok = await callAs(inst, "exam_controller", approveQuestion, { id: draft.data.id });
    if (!ok.ok) throw new Error("approve failed");
    return draft.data.id;
  }

  it("M1: teacher cannot change any content column of an approved AI question by direct update", async () => {
    const id = await approvedAi();
    for (const patch of [
      { marking_scheme: "1 mark for anything" },
      { explanation: "changed" },
      { learning_outcome: "changed" },
      { curriculum_unit_id: base.unitId },
      { source_page: null, source_chapter_no: null, source_subject_textbook_id: null, stem_question_id: null, explanation: "x" },
    ]) {
      const { error } = await inst.clientAs("teacher").from("question_bank").update(patch).eq("id", id);
      expect(error?.message).toBe("code:forbidden");
    }
    const [row] = await sql`select explanation, marking_scheme, curriculum_unit_id from public.question_bank where id = ${id}`;
    expect(row).toMatchObject({ explanation: null, marking_scheme: null, curriculum_unit_id: null });
  });

  it("M1: deleting a topic an approved AI question links to still works (FK set null is not a user edit)", async () => {
    const [t] = await sql`
      insert into public.curriculum_topics (institution_id, curriculum_unit_id, title, sequence)
      values (${inst.institutionId}, ${base.unitId}, 'Doomed', 1) returning id
    `;
    const id = await insertRaw(inst, base, { origin: "ai", status: "approved", curriculum_unit_id: base.unitId, curriculum_topic_id: t.id });
    expect(await callAs(inst, "admin", deleteTopic, { id: t.id })).toMatchObject({ ok: true });
    const [row] = await sql`select curriculum_topic_id from public.question_bank where id = ${id}`;
    expect(row.curriculum_topic_id).toBeNull();
  });

  it("L7: un-approving a reviewed AI question clears the review stamp", async () => {
    const id = await approvedAi();
    expect(await callAs(inst, "teacher", archiveQuestion, { id, isActive: false })).toMatchObject({ ok: true });
    const [row] = await sql`select status, reviewed_by, reviewed_at from public.question_bank where id = ${id}`;
    expect(row).toMatchObject({ status: "archived", reviewed_by: null, reviewed_at: null });
  });

  it("M2: createQuestion stores origin manual unless the caller says ai — never import", async () => {
    const r = await callAs(inst, "teacher", createQuestion, shortInput({ origin: "import" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await sql`select origin from public.question_bank where id = ${r.data.id}`;
    expect(row.origin).toBe("manual");
  });

  it("M3: export escapes formula cells; import of that export restores them", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const body = `=HYPERLINK("http://x") ${tag}`;
    expect(await callAs(inst, "teacher", createQuestion, shortInput({ body }))).toMatchObject({ ok: true });
    const out = await callAs(inst, "teacher", exportQuestions, { gradeId: base.gradeId, subjectId: base.subjectTaught });
    if (!out.ok) throw new Error("export failed");
    const line = out.data.csv.split("\n").find((l) => l.includes(tag));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/(^|,)"?=/);
    expect(line).toContain(`'=HYPERLINK`);

    const header = out.data.csv.split("\n")[0];
    const back = await callAs(inst, "teacher", importQuestions, { gradeId: base.gradeId, subjectId: base.subjectTaught, csv: `${header}\n${line}\n` });
    expect(back).toMatchObject({ ok: true, data: { inserted: 1 } });
    if (!back.ok) return;
    const [row] = await sql`select body from public.question_bank where id = ${back.data.ids[0]}`;
    expect(row.body).toBe(body);
  });

  it("L4: near-duplicate lookup ignores candidate bodies over 4000 characters", async () => {
    const body = `Name the largest planet ${crypto.randomUUID()}`;
    await insertRaw(inst, base, { body });
    const args = { p_institution_id: inst.institutionId, p_grade_id: base.gradeId, p_subject_id: base.subjectTaught };
    const hit = await inst.clientAs("teacher").rpc("question_bank_near_duplicates", { ...args, p_bodies: [body] });
    expect(hit.data?.length).toBeGreaterThan(0);
    const long = await inst.clientAs("teacher").rpc("question_bank_near_duplicates", { ...args, p_bodies: [body + " ".repeat(4000)] });
    expect(long.error).toBeNull();
    expect(long.data).toHaveLength(0);
  });

  it("L8: the source textbook must be for the question's grade and subject", async () => {
    const [admin] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'admin'`;
    const [book] = await sql`
      insert into public.subject_textbooks (institution_id, grade_id, subject_id, custom_title, created_by)
      values (${inst.institutionId}, ${base.gradeId}, ${base.subjectUntaught}, 'Science book', ${admin.user_id}) returning id
    `;
    const r = await callAs(inst, "exam_controller", createQuestion, shortInput({ sourceSubjectTextbookId: book.id, sourceChapterNo: 1 }));
    expect(r).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const okBook = await callAs(inst, "exam_controller", createQuestion, shortInput({ subjectId: base.subjectUntaught, sourceSubjectTextbookId: book.id }));
    expect(okBook).toMatchObject({ ok: true });
  });
});

describe("question bank v2 — read scope", () => {
  it("teacher cannot see questions of a subject they do not teach", async () => {
    const hidden = await insertRaw(inst, base, { subject_id: base.subjectUntaught });
    const { data, error } = await inst.clientAs("teacher").from("question_bank").select("id").eq("id", hidden);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("students and guardians read no question_bank rows", async () => {
    await insertRaw(inst, base);
    for (const role of ["student", "guardian"] as const) {
      const { data, error } = await inst.clientAs(role).from("question_bank").select("id").eq("institution_id", inst.institutionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    }
  });

  it("cross-tenant: another school's exam_controller can neither read nor approve", async () => {
    const id = await insertRaw(inst, base, { origin: "ai", status: "in_review" });
    const { data } = await other.clientAs("exam_controller").from("question_bank").select("id").eq("id", id);
    expect(data).toHaveLength(0);
    const approve = await callAs(other, "exam_controller", approveQuestion, { id });
    expect(approve).toMatchObject({ ok: false, error: { code: "not_found" } });
    const [row] = await sql`select status from public.question_bank where id = ${id}`;
    expect(row.status).toBe("in_review");
  });
});

describe("question bank v2 — types, near-duplicates, CSV", () => {
  it("saves a multi_select with an answer key and derives the readable answer", async () => {
    const result = await callAs(
      inst,
      "teacher",
      createQuestion,
      shortInput({ type: "multi_select", options: ["2", "3", "4", "9"], answerKey: ["2", "3"], answer: undefined }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await sql`select answer, answer_key from public.question_bank where id = ${result.data.id}`;
    expect(row.answer_key).toEqual(["2", "3"]);
    expect(row.answer).toBe("2; 3");
  });

  it("SQL rejects a multi_select without an answer key", async () => {
    await expect(insertRaw(inst, base, { type: "multi_select", options: sql.json(["a", "b"]) })).rejects.toThrow(/answer_key_shape/);
  });

  it("warns (does not block) on a near-duplicate body in the same grade and subject", async () => {
    const body = "What is the place value of 7 in the number 4,712?";
    await callAs(inst, "teacher", createQuestion, shortInput({ body }));
    const second = await callAs(inst, "teacher", createQuestion, shortInput({ body: "What is the place value of 7 in the number 4712?" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.warnings.length).toBeGreaterThan(0);
    expect(second.data.warnings[0].body).toBe(body);
  });

  it("import saves valid rows as import drafts; one bad row saves nothing", async () => {
    const bad = await callAs(inst, "teacher", importQuestions, {
      gradeId: base.gradeId,
      subjectId: base.subjectTaught,
      csv: "type,difficulty,body,answer,marks,options\nmcq,easy,Pick two,5,1,3|4\n",
    });
    expect(bad).toMatchObject({ ok: false, error: { code: "validation_failed" } });

    const tag = crypto.randomUUID().slice(0, 8);
    const good = await callAs(inst, "teacher", importQuestions, {
      gradeId: base.gradeId,
      subjectId: base.subjectTaught,
      csv: `type,difficulty,body,answer,marks,options\nmcq,easy,Imported ${tag} one,4,1,3|4\nshort_answer,medium,Imported ${tag} two,yes,2,\n`,
    });
    expect(good).toMatchObject({ ok: true, data: { inserted: 2 } });
    const rows = await sql`select origin, status from public.question_bank where body like ${`Imported ${tag}%`}`;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.origin === "import" && r.status === "draft")).toBe(true);
  });

  it("export returns approved questions only by default", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    await callAs(inst, "teacher", createQuestion, shortInput({ body: `Export ${tag} approved` }));
    await callAs(inst, "teacher", createQuestion, shortInput({ body: `Export ${tag} draft`, origin: "ai" }));
    const result = await callAs(inst, "teacher", exportQuestions, { gradeId: base.gradeId, subjectId: base.subjectTaught });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.csv).toContain(`Export ${tag} approved`);
    expect(result.data.csv).not.toContain(`Export ${tag} draft`);
  });
});

describe("question collections", () => {
  it("private collections are owner-only until shared with the school", async () => {
    const q = await callAs(inst, "teacher", createQuestion, shortInput());
    const coll = await callAs(inst, "teacher", createCollection, { name: "Unit 1 revision" });
    if (!q.ok || !coll.ok) throw new Error("setup failed");
    expect(await callAs(inst, "teacher", addToCollection, { collectionId: coll.data.id, questionIds: [q.data.id] })).toMatchObject({
      ok: true,
      data: { added: 1 },
    });

    const hidden = await inst.clientAs("exam_controller").from("question_collections").select("id").eq("id", coll.data.id);
    expect(hidden.data).toHaveLength(0);
    const intrude = await callAs(inst, "exam_controller", addToCollection, { collectionId: coll.data.id, questionIds: [q.data.id] });
    expect(intrude.ok).toBe(false);

    await callAs(inst, "teacher", updateCollection, { id: coll.data.id, visibility: "school" });
    const shared = await inst.clientAs("exam_controller").from("question_collection_items").select("question_id").eq("collection_id", coll.data.id);
    expect(shared.data).toEqual([{ question_id: q.data.id }]);
    const studentView = await inst.clientAs("student").from("question_collections").select("id").eq("id", coll.data.id);
    expect(studentView.data).toHaveLength(0);
  });
});

describe("curriculum topics + textbook rights", () => {
  it("admin creates a topic and subtopic; teacher cannot; question links to the topic", async () => {
    const topic = await callAs(inst, "admin", upsertTopic, { curriculumUnitId: base.unitId, title: "Place value", sequence: 1 });
    expect(topic.ok).toBe(true);
    if (!topic.ok) return;
    const sub = await callAs(inst, "admin", upsertTopic, { curriculumUnitId: base.unitId, parentId: topic.data.id, title: "Expanded form", sequence: 1 });
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    const tooDeep = await callAs(inst, "admin", upsertTopic, { curriculumUnitId: base.unitId, parentId: sub.data.id, title: "Too deep", sequence: 1 });
    expect(tooDeep).toMatchObject({ ok: false, error: { code: "validation_failed" } });

    const { error } = await inst
      .clientAs("teacher")
      .from("curriculum_topics")
      .insert({ institution_id: inst.institutionId, curriculum_unit_id: base.unitId, title: "Teacher topic", sequence: 9 });
    expect(error).not.toBeNull();

    const q = await callAs(inst, "teacher", createQuestion, shortInput({ curriculumUnitId: base.unitId, curriculumTopicId: sub.data.id }));
    expect(q.ok).toBe(true);
    const wrongSubject = await callAs(inst, "exam_controller", createQuestion, shortInput({ subjectId: base.subjectUntaught, curriculumTopicId: sub.data.id }));
    expect(wrongSubject).toMatchObject({ ok: false, error: { code: "validation_failed" } });

    expect(await callAs(inst, "admin", deleteTopic, { id: topic.data.id })).toMatchObject({ ok: true });
    const [left] = await sql`select count(*)::int as n from public.curriculum_topics where id in (${topic.data.id}, ${sub.data.id})`;
    expect(left.n).toBe(0);
  });

  it("L5: topics stay two levels deep — no cycles, no grandchildren, by direct write too", async () => {
    const admin = inst.clientAs("admin");
    const row = (title: string, parentId: string | null = null) => ({
      institution_id: inst.institutionId,
      curriculum_unit_id: base.unitId,
      parent_id: parentId,
      title,
      sequence: 1,
    });
    const { data: a } = await admin.from("curriculum_topics").insert(row("A")).select("id").single();
    const { data: b } = await admin.from("curriculum_topics").insert(row("B", a!.id)).select("id").single();
    expect(b).not.toBeNull();
    const grandchild = await admin.from("curriculum_topics").insert(row("C", b!.id));
    expect(grandchild.error?.message).toBe("code:validation_failed");
    const cycle = await admin.from("curriculum_topics").update({ parent_id: b!.id }).eq("id", a!.id);
    expect(cycle.error?.message).toBe("code:validation_failed");
    const { data: d } = await admin.from("curriculum_topics").insert(row("D")).select("id").single();
    const nestParent = await admin.from("curriculum_topics").update({ parent_id: d!.id }).eq("id", a!.id);
    expect(nestParent.error?.message).toBe("code:validation_failed");
  });

  it("L6: ncert_code is not client-updatable, so an NCERT book cannot leave link_only", async () => {
    const [ncert] = await sql`select code from public.ncert_textbooks limit 1`;
    const [admin] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'admin'`;
    const [book] = await sql`
      insert into public.subject_textbooks (institution_id, grade_id, subject_id, ncert_code, created_by)
      values (${inst.institutionId}, ${base.gradeId}, ${base.subjectUntaught}, ${ncert.code}, ${admin.user_id}) returning id
    `;
    const { error } = await inst
      .clientAs("admin")
      .from("subject_textbooks")
      .update({ ncert_code: null, custom_title: "Mine now", rights_status: "school_owned" })
      .eq("id", book.id);
    expect(error).not.toBeNull();
    const [after] = await sql`select ncert_code, rights_status from public.subject_textbooks where id = ${book.id}`;
    expect(after).toMatchObject({ ncert_code: ncert.code, rights_status: "link_only" });
  });

  it("an NCERT-mapped book is always link_only; a custom book defaults to unknown", async () => {
    const [ncert] = await sql`select code from public.ncert_textbooks limit 1`;
    const [admin] = await sql`select user_id from public.memberships where institution_id = ${inst.institutionId} and role = 'admin'`;
    const [book] = await sql`
      insert into public.subject_textbooks (institution_id, grade_id, subject_id, ncert_code, created_by)
      values (${inst.institutionId}, ${base.gradeId}, ${base.subjectTaught}, ${ncert.code}, ${admin.user_id}) returning id, rights_status
    `;
    expect(book.rights_status).toBe("link_only");
    const { error } = await inst.clientAs("admin").from("subject_textbooks").update({ rights_status: "school_owned" }).eq("id", book.id);
    expect(error).toBeNull();
    const [after] = await sql`select rights_status from public.subject_textbooks where id = ${book.id}`;
    expect(after.rights_status).toBe("link_only");

    const [custom] = await sql`
      insert into public.subject_textbooks (institution_id, grade_id, subject_id, custom_title, created_by)
      values (${inst.institutionId}, ${base.gradeId}, ${base.subjectTaught}, 'My Maths', ${admin.user_id}) returning rights_status
    `;
    expect(custom.rights_status).toBe("unknown");
  });
});
