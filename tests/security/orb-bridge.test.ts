import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Orb task bridge threats (design §7): another user's or another school's
// proposal, expiry, replay, a toggle switched off between propose and approve,
// the target action's own permission and module per role, ids the caller
// cannot see, and the guardian child pin.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { approveProposal, discardProposal, openedProposal, startProposal } from "@/modules/ai/tasks/proposals.actions";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
let studentA: string;
let studentB: string;

async function addStudent(inst: TestInstitution, first: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, ${`SEC-${crypto.randomUUID().slice(0, 8)}`}, ${first}, 'Secure', '2014-01-01', 'other')
    returning id
  `;
  return row!.id as string;
}

async function addCopy(inst: TestInstitution, accessionNo: string): Promise<void> {
  const [book] = await sql`insert into public.library_books (institution_id, title, author) values (${inst.institutionId}, 'Guide', 'Narayan') returning id`;
  await sql`insert into public.library_copies (institution_id, book_id, accession_no) values (${inst.institutionId}, ${book!.id}, ${accessionNo})`;
}

async function setAiRoles(inst: TestInstitution, aiRoles: Record<string, unknown>): Promise<void> {
  await sql`update public.institutions set settings = jsonb_set(settings, '{ai_roles}', ${sql.json(aiRoles as never)}::jsonb) where id = ${inst.institutionId}`;
}

async function setModule(inst: TestInstitution, key: string, on: boolean): Promise<void> {
  await sql`update public.institutions set settings = jsonb_set(settings, ${["modules", key]}::text[], to_jsonb(${on}::boolean)) where id = ${inst.institutionId}`;
}

async function issueCard(inst: TestInstitution, accessionNo: string, student: string): Promise<TaskProposalOutput> {
  const started = await callAs(inst, "owner", startProposal, { action: "library.loan.issue", values: { accessionNo, studentId: student } });
  if (!started.ok) throw new Error(started.error.message);
  return started.data;
}

const loans = async (inst: TestInstitution) => (await sql`select id from public.library_loans where institution_id = ${inst.institutionId}`).length;
const statusOf = async (id: string) => (await sql`select status from public.ai_proposals where id = ${id}`)[0]?.status as string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestInstitution("orb-sec-a"), createTestInstitution("orb-sec-b")]);
  studentA = await addStudent(a, "Alpha");
  studentB = await addStudent(b, "Beta");
}, 60_000);

afterAll(async () => {
  await Promise.all([a?.cleanup(), b?.cleanup()]);
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
}, 60_000);

describe("orb bridge security (design §7)", () => {
  it("another user's proposal in the same school cannot be approved, discarded or opened", async () => {
    await addCopy(a, "SEC-1");
    const card = await issueCard(a, "SEC-1", "Alpha Secure");
    const approve = await callAs(a, "principal", approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(approve).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await callAs(a, "principal", discardProposal, { proposalId: card.proposalId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await callAs(a, "principal", openedProposal, { proposalId: card.proposalId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await statusOf(card.proposalId)).toBe("pending");
  });

  it("another school's owner cannot approve the proposal", async () => {
    await addCopy(a, "SEC-2");
    const card = await issueCard(a, "SEC-2", "Alpha Secure");
    const result = await callAs(b, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await statusOf(card.proposalId)).toBe("pending");
  });

  it("an expired proposal is refused with 'expired' and never runs", async () => {
    await addCopy(a, "SEC-3");
    const card = await issueCard(a, "SEC-3", "Alpha Secure");
    await sql`update public.ai_proposals set status = 'expired' where id = ${card.proposalId}`;
    const before = await loans(a);
    const result = await callAs(a, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/expired/) } });
    expect(await loans(a)).toBe(before);
  });

  it("approving the same card twice at once runs the action once", async () => {
    await addCopy(a, "SEC-4");
    const card = await issueCard(a, "SEC-4", "Alpha Secure");
    const before = await loans(a);
    const results = await Promise.all([1, 2].map(() => callAs(a, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await loans(a)).toBe(before + 1);
    expect(await statusOf(card.proposalId)).toBe("approved");
  });

  it("a task switched off between propose and approve is refused and the card stays pending", async () => {
    await addCopy(a, "SEC-5");
    const card = await issueCard(a, "SEC-5", "Alpha Secure");
    await setAiRoles(a, { owner: { tasks: { "library.loan.issue": false } } });
    try {
      const result = await callAs(a, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await statusOf(card.proposalId)).toBe("pending");
    } finally {
      await setAiRoles(a, {});
    }
  });

  it("the module switched off between propose and approve is refused", async () => {
    await addCopy(a, "SEC-6");
    const card = await issueCard(a, "SEC-6", "Alpha Secure");
    await setModule(a, "library", false);
    try {
      const before = await loans(a);
      const result = await callAs(a, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(await loans(a)).toBe(before);
    } finally {
      await setModule(a, "library", true);
    }
  });

  it("the target action's permission holds per role: a teacher's own card for library.loan.issue never runs", async () => {
    await addCopy(a, "SEC-7");
    const start = await callAs(a, "teacher", startProposal, { action: "library.loan.issue", values: { accessionNo: "SEC-7" } });
    expect(start).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const [row] = await sql`
      insert into public.ai_proposals (institution_id, created_by, action, proposed)
      values (${a.institutionId}, ${a.users.teacher.id}, 'library.loan.issue', '{}'::jsonb) returning id
    `;
    const before = await loans(a);
    const result = await callAs(a, "teacher", approveProposal, { proposalId: row!.id, values: { accessionNo: "SEC-7", studentId: studentA } });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await loans(a)).toBe(before);
  });

  it("a uuid the caller cannot see is dropped at proposal time", async () => {
    await addCopy(a, "SEC-8");
    const card = await issueCard(a, "SEC-8", studentB);
    expect(card.view.values).toEqual({ accessionNo: "SEC-8" });
    expect(card.view.resolved).toEqual({});
    const own = await issueCard(a, "SEC-8", studentA);
    expect(own.view.values).toEqual({ accessionNo: "SEC-8", studentId: studentA });
  });

  it("a guardian's studentId is pinned to their own child at proposal and re-checked at approve", async () => {
    const [g] = await sql`select guardian_id from public.memberships where institution_id = ${a.institutionId} and role = 'guardian'`;
    await sql`
      insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
      values (${a.institutionId}, ${g!.guardian_id}, ${studentA}, 'mother', true)
    `;
    const other = await addStudent(a, "Gamma");
    await setAiRoles(a, { guardian: { enabled: true } }); // guardian chat is off by default
    const started = await callAs(a, "guardian", startProposal, { action: "studentLeave.request", values: { studentId: other, reason: "Fever" } });
    expect(started.ok).toBe(true);
    const card = (started as { data: TaskProposalOutput }).data;
    expect(card.view.values.studentId).toBe(studentA);

    const forged = await callAs(a, "guardian", approveProposal, {
      proposalId: card.proposalId,
      values: { studentId: other, startDate: "2026-12-01", endDate: "2026-12-02", reason: "Fever" },
    });
    expect(forged).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await setAiRoles(a, {});
  });

  it("a field error comes back keyed by a concrete JSON pointer", async () => {
    await addCopy(a, "SEC-9");
    const card = await issueCard(a, "SEC-9", "Alpha Secure");
    const result = await callAs(a, "owner", approveProposal, { proposalId: card.proposalId, values: { accessionNo: "SEC-9" } });
    expect(result).toMatchObject({ ok: false, error: { code: "validation_failed", fieldErrors: { "/studentId": expect.any(Array) } } });
    expect(await statusOf(card.proposalId)).toBe("pending");
  });
});
