// 0148 — content extraction: rights gate (custom books with an allowing
// rights_status only; NCERT never), the content.extract job (unpdf text
// pages -> chunks, scan-like pages -> needs_ocr), OCR through a mocked
// gateway (never under local_only), corrections keep original_body, search
// and reads follow the textbook file's readers, nothing crosses schools.
import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
const gateway = vi.hoisted(() => ({ runStructuredFile: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => gateway);

import { ok } from "@/lib/actions/result";
import { ocrExtractionPages, retryExtraction, startExtraction, updateChunk } from "@/modules/content/actions";
import { contentExtract } from "@/modules/jobs/handlers/content.extract";
import type { JobRow } from "@/modules/jobs/types";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, createSubjectAssignment } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { tinyPdf } from "../helpers/tiny-pdf";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
const BUCKET = "tenant-docs";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

let inst: TestInstitution;
let other: TestInstitution;
let mathsBook: string; // grade VI maths, school_owned, taught by `teacher`
let scienceBook: string; // grade VII science, licensed, nobody teaches it
let unknownBook: string; // grade VI maths, rights unknown
let ncertBook: string; // NCERT mapping: link_only, forced by 0147
let mathsDoc: string;

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

async function book(gradeId: string, subjectId: string, title: string, rights: string): Promise<string> {
  const owner = inst.users.owner.id;
  return (await one(sql`insert into public.subject_textbooks (institution_id, grade_id, subject_id, custom_title, chapter_titles, rights_status, created_by)
    values (${inst.institutionId}, ${gradeId}, ${subjectId}, ${title}, ${sql.json({ "1": "Knowing Numbers" })}, ${rights}, ${owner}) returning id`)).id as string;
}

/** An active textbook PDF (object + documents row), as the 0142 upload flow leaves it. */
async function attachPdf(bookId: string, bytes: Uint8Array): Promise<string> {
  const documentId = crypto.randomUUID();
  const path = `${inst.institutionId}/subject_textbook/${bookId}/${documentId}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf" });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  await sql`insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
    values (${documentId}, ${inst.institutionId}, 'subject_textbook', ${bookId}, 'textbook', 'book.pdf', 'application/pdf', ${bytes.byteLength}, ${path}, ${inst.users.owner.id}, 'active')`;
  return documentId;
}

const chunkCount = async (role: FixtureRole, bookId: string, fixture = inst) => {
  const { data, error } = await fixture.clientAs(role).from("content_chunks").select("id").eq("subject_textbook_id", bookId);
  expect(error).toBeNull();
  return (data ?? []).length;
};

beforeAll(async () => {
  inst = await createTestInstitution("cx");
  other = await createTestInstitution("cx-o");
  await sql`update public.institutions set ai_policy = 'cloud_allowed' where id = ${inst.institutionId}`;
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeVI = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
  const gradeVII = await createGrade(inst.institutionId, { code: "VII", sortKey: 7 });
  const maths = await createSubject(inst.institutionId, { name: "Maths" });
  const science = await createSubject(inst.institutionId, { name: "Science" });
  const sectionVIA = await createClassSection(inst.institutionId, gradeVI, yearId, { name: "A" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  await createSubjectAssignment(inst.institutionId, sectionVIA, maths, teacherStaff);
  const studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionVIA, yearId);

  mathsBook = await book(gradeVI, maths, "Maths for Class 6", "school_owned");
  scienceBook = await book(gradeVII, science, "Science for Class 7", "licensed");
  unknownBook = await book(gradeVI, maths, "Old notes", "unknown");
  const ncertCode = (await one(sql`select code from public.ncert_textbooks order by code limit 1`)).code as string;
  ncertBook = (await one(sql`insert into public.subject_textbooks (institution_id, grade_id, subject_id, ncert_code, created_by)
    values (${inst.institutionId}, ${gradeVI}, ${science}, ${ncertCode}, ${inst.users.owner.id}) returning id`)).id as string;

  mathsDoc = await attachPdf(
    mathsBook,
    tinyPdf([
      ["Chapter 1", "Large numbers are read in groups of three digits called periods."],
      [], // a scanned page: no text layer
      ["Estimation helps us check whether a sum of large numbers is sensible."],
    ]),
  );
  await attachPdf(scienceBook, tinyPdf([["Chapter 1 Nutrition in Plants", "Green plants make their food by photosynthesis using sunlight."]]));
  await attachPdf(unknownBook, tinyPdf([["Some text that is long enough to be read as a page."]]));
}, 120_000);

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 120_000);

describe("rights gate", () => {
  it("refuses a book whose rights are unknown, and an NCERT book (link-only)", async () => {
    for (const id of [unknownBook, ncertBook]) {
      const r = await callAs(inst, "owner", startExtraction, { subjectTextbookId: id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_state");
    }
    const [{ n }] = await sql`select count(*)::int as n from public.content_extractions where subject_textbook_id in (${unknownBook}, ${ncertBook})`;
    expect(n).toBe(0);
  });
});

describe("extraction", () => {
  it("a teacher reads their subject's book: text pages -> chunks, the scan-like page waits for OCR", async () => {
    const r = await callAs(inst, "teacher", startExtraction, { subjectTextbookId: mathsBook });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ status: "partial", pagesTotal: 3, pagesDone: 2, needsOcrPages: [2], chunkCount: 2 });
    const rows = await sql`select chapter_no, page_from, heading, original_body from public.content_chunks where subject_textbook_id = ${mathsBook} order by page_from`;
    expect(rows.map((c) => [c.page_from, c.chapter_no, c.heading])).toEqual([
      [1, 1, "Knowing Numbers"],
      [3, 1, "Knowing Numbers"],
    ]);
    const [job] = await sql`select status from public.jobs where idempotency_key = ${`content.extract:${r.data.id}`}`;
    expect(job.status).toBe("succeeded");
  });

  it("a teacher cannot read a book of a subject they do not teach; a second live run is refused", async () => {
    const t = await callAs(inst, "teacher", startExtraction, { subjectTextbookId: scienceBook });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error.code).toBe("forbidden");
    await sql`update public.content_extractions set status = 'running' where subject_textbook_id = ${mathsBook}`;
    const again = await callAs(inst, "owner", startExtraction, { subjectTextbookId: mathsBook });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("invalid_state");
    await sql`update public.content_extractions set status = 'partial' where subject_textbook_id = ${mathsBook}`;
  });

  it("rerunning the same job replaces the chunks (no duplicates)", async () => {
    const [run] = await sql`select id from public.content_extractions where subject_textbook_id = ${mathsBook}`;
    await sql`update public.content_extractions set status = 'queued' where id = ${run.id}`;
    const job = { id: crypto.randomUUID(), institution_id: inst.institutionId, type: "content.extract", payload: { extractionId: run.id } } as unknown as JobRow;
    await contentExtract(job, { admin: admin as never });
    await contentExtract({ ...job }, { admin: admin as never }); // finished: a second delivery is a no-op
    const [{ n }] = await sql`select count(*)::int as n from public.content_chunks where subject_textbook_id = ${mathsBook}`;
    expect(n).toBe(2);
  });

  it("the owner reads a book nobody teaches; rejects junk bytes as a failed reading", async () => {
    const r = await callAs(inst, "owner", startExtraction, { subjectTextbookId: scienceBook });
    expect(r.ok && r.data.status).toBe("done");
    const junkBook = await book((await one(sql`select grade_id from public.subject_textbooks where id = ${mathsBook}`)).grade_id as string,
      (await one(sql`select subject_id from public.subject_textbooks where id = ${mathsBook}`)).subject_id as string, "Junk", "open_licence");
    await attachPdf(junkBook, new TextEncoder().encode("%PDF-1.4 this is not really a pdf"));
    const junk = await callAs(inst, "owner", startExtraction, { subjectTextbookId: junkBook });
    expect(junk.ok && junk.data).toMatchObject({ status: "failed", error: "This file could not be read as a PDF.", chunkCount: 0 });
    const retry = await callAs(inst, "owner", retryExtraction, { extractionId: junk.ok ? junk.data.id : crypto.randomUUID() });
    expect(retry.ok && retry.data.status).toBe("failed");
  });
});

describe("OCR", () => {
  it("never sends pages to the cloud under local_only: they stay 'needs OCR'", async () => {
    await sql`update public.institutions set ai_policy = 'local_only' where id = ${inst.institutionId}`;
    const [run] = await sql`select id from public.content_extractions where subject_textbook_id = ${mathsBook}`;
    const r = await callAs(inst, "teacher", ocrExtractionPages, { extractionId: run.id as string });
    await sql`update public.institutions set ai_policy = 'cloud_allowed' where id = ${inst.institutionId}`;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ai_policy_blocked");
    expect(gateway.runStructuredFile).not.toHaveBeenCalled();
    const [after] = await sql`select needs_ocr_pages from public.content_extractions where id = ${run.id}`;
    expect(after.needs_ocr_pages).toEqual([2]);
  });

  it("OCR'd pages through the gateway become chunks and finish the reading", async () => {
    gateway.runStructuredFile.mockResolvedValueOnce(
      ok({ data: { pages: [{ page: 2, text: "Roman numerals use I, V, X, L, C, D and M to write numbers." }, { page: 3, text: "ignored: not asked" }] }, provider: "cloud", model: "gemini-test", fallback: false }),
    );
    const [run] = await sql`select id from public.content_extractions where subject_textbook_id = ${mathsBook}`;
    const r = await callAs(inst, "teacher", ocrExtractionPages, { extractionId: run.id as string });
    expect(r.ok && r.data).toEqual({ extractionId: run.id, pagesRead: [2], remaining: 0, status: "done" });
    const rows = await sql`select page_from, chapter_no from public.content_chunks where subject_textbook_id = ${mathsBook} order by page_from`;
    expect(rows.map((c) => [c.page_from, c.chapter_no])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const [after] = await sql`select pages_ocr, pages_done from public.content_extractions where id = ${run.id}`;
    expect(after).toMatchObject({ pages_ocr: 1, pages_done: 3 });
  });

  it("save_content_ocr_pages accepts only pages still waiting", async () => {
    const [run] = await sql`select id from public.content_extractions where subject_textbook_id = ${mathsBook}`;
    const { error } = await inst.clientAs("owner").rpc("save_content_ocr_pages", { p_extraction_id: run.id, p_pages: [1], p_chunks: [] });
    expect(error?.message).toMatch(/^code:(invalid_state|validation_failed)/);
  });
});

describe("reads, search and corrections", () => {
  it("chunks are read like the textbook file: staff and that grade+subject's students; never another school", async () => {
    for (const role of ["owner", "admin", "accountant", "teacher", "student"] as FixtureRole[]) expect(await chunkCount(role, mathsBook)).toBe(3);
    expect(await chunkCount("student", scienceBook)).toBe(0); // grade VII; the student is in VI
    expect(await chunkCount("guardian", mathsBook)).toBe(0); // not linked to any child
    expect(await chunkCount("owner", mathsBook, other)).toBe(0);
    const { data } = await other.clientAs("owner").from("content_extractions").select("id").eq("subject_textbook_id", mathsBook);
    expect(data).toEqual([]);
  });

  it("search ranks matches, highlights them, and returns only rows the caller may read", async () => {
    type Hit = { book_title: string | null; snippet: string };
    const search = async (role: FixtureRole, q: string, fixture = inst) => {
      const { data, error } = await fixture.clientAs(role).rpc("search_content_chunks", { p_institution_id: inst.institutionId, p_q: q });
      return { error, data: data as Hit[] | null };
    };
    const t = await search("teacher", "photosynthesis or periods");
    expect(t.error).toBeNull();
    expect(t.data?.map((h) => h.book_title).sort()).toEqual(["Maths for Class 6", "Science for Class 7"]);
    expect(t.data?.find((h) => h.book_title === "Maths for Class 6")?.snippet).toContain("«periods»");
    const s = await search("student", "photosynthesis or periods");
    expect(s.data?.map((h) => h.book_title)).toEqual(["Maths for Class 6"]);
    const x = await search("owner", "periods", other);
    expect(x.data).toEqual([]);
  });

  it("a correction keeps the first text in original_body; only the book's writers may correct", async () => {
    const [chunk] = await sql`select id, body from public.content_chunks where subject_textbook_id = ${mathsBook} and page_from = 1`;
    const r = await callAs(inst, "teacher", updateChunk, { chunkId: chunk.id as string, body: "Corrected text about periods." });
    expect(r.ok).toBe(true);
    await callAs(inst, "teacher", updateChunk, { chunkId: chunk.id as string, body: "Second correction." });
    const [after] = await sql`select body, original_body, edited_by from public.content_chunks where id = ${chunk.id}`;
    expect(after).toEqual({ body: "Second correction.", original_body: chunk.body, edited_by: inst.users.teacher.id });
    const [event] = await sql`select before, after from public.audit_events where entity_id = ${chunk.id} and action = 'content.chunk.update' order by created_at desc limit 1`;
    expect(event).toEqual({
      before: { sha256: sha256("Corrected text about periods."), chars: 29 },
      after: { sha256: sha256("Second correction."), chars: 18, heading: false },
    });

    const [sci] = await sql`select id from public.content_chunks where subject_textbook_id = ${scienceBook} limit 1`;
    const t = await callAs(inst, "teacher", updateChunk, { chunkId: sci.id as string, body: "Not my subject." });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error.code).toBe("not_found");
    const acc = await callAs(inst, "accountant", updateChunk, { chunkId: chunk.id as string, body: "Nope." });
    expect(acc.ok).toBe(false);
    if (!acc.ok) expect(acc.error.code).toBe("forbidden");
    const direct = await inst.clientAs("owner").from("content_chunks").insert({ institution_id: inst.institutionId, extraction_id: crypto.randomUUID(), subject_textbook_id: mathsBook, page_from: 1, page_to: 1, body: "x" });
    expect(direct.error?.code).toBe("42501");
    const ctx = await buildContext(inst, "teacher");
    expect(ctx.permissions.has("resource.manage")).toBe(true);
  });

  it("retiring the book's PDF removes the text read from it and fails its readings", async () => {
    await sql`update public.documents set status = 'deleted' where id = ${mathsDoc}`;
    const [{ n }] = await sql`select count(*)::int as n from public.content_chunks where subject_textbook_id = ${mathsBook}`;
    expect(n).toBe(0);
    const runs = await sql`select status from public.content_extractions where document_id = ${mathsDoc}`;
    expect(runs.map((r) => r.status)).toEqual(["failed"]);
  });
});

/** A fresh book read by the owner: page 1 has text, page 2 waits for OCR. */
async function partialBook(title: string, rights: string) {
  const { grade_id, subject_id } = await one(sql`select grade_id, subject_id from public.subject_textbooks where id = ${mathsBook}`);
  const id = await book(grade_id as string, subject_id as string, title, rights);
  const doc = await attachPdf(id, tinyPdf([["Chapter 1", "Fractions name equal parts of one whole shape or group."], []]));
  const r = await callAs(inst, "owner", startExtraction, { subjectTextbookId: id });
  expect(r.ok && r.data).toMatchObject({ status: "partial", needsOcrPages: [2], chunkCount: 1 });
  return { id, doc, run: r.ok ? r.data.id : "" };
}
const rawChunks = async (bookId: string) => (await one(sql`select count(*)::int as n from public.content_chunks where subject_textbook_id = ${bookId}`)).n as number;
const runStatus = async (runId: string) => (await one(sql`select status from public.content_extractions where id = ${runId}`)).status as string;
const ocrSave = (run: string, pages: number[], chunks: unknown[] = []) =>
  inst.clientAs("owner").rpc("save_content_ocr_pages", { p_extraction_id: run, p_pages: pages, p_chunks: chunks as never });

describe("rights changes and OCR save guards", () => {
  it("turning a book's rights off deletes its text and fails its unfinished reading", async () => {
    const b = await partialBook("Rights off", "school_owned");
    expect(await rawChunks(b.id)).toBe(1);
    await sql`update public.subject_textbooks set rights_status = 'unknown' where id = ${b.id}`;
    expect(await rawChunks(b.id)).toBe(0);
    expect(await runStatus(b.run)).toBe("failed");
  });

  it("the job's save re-checks rights: a run whose book lost its rights stores nothing", async () => {
    const b = await partialBook("Rights off mid-job", "licensed");
    await sql`update public.subject_textbooks set rights_status = 'unknown' where id = ${b.id}`;
    await sql`update public.content_extractions set status = 'running' where id = ${b.run}`;
    await sql`select public.save_content_extraction(${b.run}, 1, '{}'::int[], ${sql.json([{ page_from: 1, page_to: 1, body: "Leaked text." }])})`;
    expect(await rawChunks(b.id)).toBe(0);
    expect(await runStatus(b.run)).toBe("failed");
  });

  it("OCR pages save only to the book's newest reading, without duplicate pages or too many chunks", async () => {
    const b = await partialBook("OCR guards", "open_licence");
    const [newer] = await sql`insert into public.content_extractions (institution_id, subject_textbook_id, document_id, status, created_by, created_at)
      values (${inst.institutionId}, ${b.id}, ${b.doc}, 'failed', ${inst.users.owner.id}, now() + interval '1 minute') returning id`;
    const stale = await ocrSave(b.run, [2]);
    expect(stale.error?.message).toMatch(/^code:invalid_state/);
    await sql`delete from public.content_extractions where id = ${newer.id}`;

    const dup = await ocrSave(b.run, [2, 2]);
    expect(dup.error?.message).toMatch(/^code:validation_failed/);
    const many = await ocrSave(b.run, [2], Array.from({ length: 101 }, () => ({ page_from: 2, page_to: 2, body: "x" })));
    expect(many.error?.message).toMatch(/^code:validation_failed/);
    expect(await rawChunks(b.id)).toBe(1);

    await sql`update public.documents set status = 'deleted' where id = ${b.doc}`;
    expect(await runStatus(b.run)).toBe("failed");
    await sql`update public.content_extractions set status = 'partial' where id = ${b.run}`; // a race the trigger lost
    const retired = await ocrSave(b.run, [2], [{ page_from: 2, page_to: 2, body: "Scanned text." }]);
    expect(retired.error?.message).toMatch(/^code:invalid_state/);
    expect(await rawChunks(b.id)).toBe(0);
  });
});
