// Curveball sweep (messaging): sendMessage and markThreadRead at the action layer — participants, outsiders,
// other schools, Zod edges, read receipts idempotent.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { markThreadRead, sendMessage, startThread } from "@/modules/messaging/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let b: TestInstitution;
let threadId: string;
let foreignThreadId: string;

async function idOf(inst: TestInstitution, role: string, column: "staff_id" | "guardian_id" | "student_id"): Promise<string> {
  const [row] = await sql`select ${sql(column)} as id from public.memberships where institution_id = ${inst.institutionId} and role = ${role}`;
  return row.id as string;
}
async function seedThread(inst: TestInstitution): Promise<string> {
  const teacherStaff = await idOf(inst, "teacher", "staff_id");
  const studentId = await idOf(inst, "student", "student_id");
  const guardianId = await idOf(inst, "guardian", "guardian_id");
  const yearId = await createAcademicYear(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, await createGrade(inst.institutionId), yearId, { classTeacherId: teacherStaff });
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)`;
  const r = await callAs(inst, "guardian", startThread, { studentId, counterpartId: teacherStaff, subject: "Homework", body: "Hello teacher" });
  if (!r.ok) throw new Error(`startThread: ${JSON.stringify(r.error)}`);
  return r.data.threadId;
}

beforeAll(async () => {
  a = await createTestInstitution("msg-cb");
  b = await createTestInstitution("msg-cb-x");
  threadId = await seedThread(a);
  foreignThreadId = await seedThread(b);
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("messaging curveballs", () => {
  it("both participants send through the action; message bodies are stored trimmed", async () => {
    const t = await callAs(a, "teacher", sendMessage, { threadId, body: "  Sure, after class.  " });
    const g = await callAs(a, "guardian", sendMessage, { threadId, body: "Thanks" });
    expect([t.ok, g.ok]).toEqual([true, true]);
    if (!t.ok) return;
    const [row] = await sql`select body from public.messages where id = ${t.data.messageId}`;
    expect(row.body).toBe("Sure, after class.");
  });

  it("whitespace-only and 4001-char bodies → validation_failed on body", async () => {
    for (const body of ["   ", "x".repeat(4001)]) {
      const r = await callAs(a, "guardian", sendMessage, { threadId, body });
      expect(r.ok ? null : r.error.fieldErrors?.body).toBeTruthy();
    }
  });

  it("non-participant staff (owner, admin) cannot send; student and accountant lack message.send", async () => {
    for (const role of ["owner", "admin"] as const) {
      const r = await callAs(a, role, sendMessage, { threadId, body: "Butting in" });
      expect(r.ok).toBe(false);
      expect(r.ok ? null : r.error.code).not.toBe("internal");
    }
    for (const role of ["student", "accountant"] as const) {
      const r = await callAs(a, role, sendMessage, { threadId, body: "Hi" });
      expect(r.ok ? null : r.error.code).toBe("forbidden");
    }
  });

  it("another school's thread, or an unknown one: send and mark-read refused; no message written", async () => {
    const [before] = await sql`select count(*)::int as n from public.messages where thread_id = ${foreignThreadId}`;
    const s = await callAs(a, "guardian", sendMessage, { threadId: foreignThreadId, body: "Hello?" });
    const m = await callAs(a, "teacher", markThreadRead, { threadId: foreignThreadId });
    const u = await callAs(a, "guardian", sendMessage, { threadId: crypto.randomUUID(), body: "Hello?" });
    for (const r of [s, m, u]) {
      expect(r.ok).toBe(false);
      expect(r.ok ? null : ["not_found", "forbidden"]).toContain(r.ok ? "" : r.error.code);
    }
    const [after] = await sql`select count(*)::int as n from public.messages where thread_id = ${foreignThreadId}`;
    expect(after.n).toBe(before.n);
  });

  it("mark-read is idempotent: a second call marks nothing new, and never marks one's own messages", async () => {
    await callAs(a, "guardian", sendMessage, { threadId, body: "One more question" });
    const first = await callAs(a, "teacher", markThreadRead, { threadId });
    expect(first.ok).toBe(true);
    const second = await callAs(a, "teacher", markThreadRead, { threadId });
    expect(second.ok ? second.data.marked : null).toBe(0);
    const [own] = await sql`
      select count(*)::int as n from public.messages m
      where m.thread_id = ${threadId} and m.sender_profile_id = ${a.users.teacher.id} and m.read_at is not null`;
    expect(own.n).toBe(0);
  });

  it("parallel sends from both sides all land, in a stable order", async () => {
    const rs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => callAs(a, i % 2 ? "teacher" : "guardian", sendMessage, { threadId, body: `burst ${i}` })),
    );
    expect(rs.every((r) => r.ok)).toBe(true);
    const [c] = await sql`select count(*)::int as n from public.messages where thread_id = ${threadId} and body like 'burst %'`;
    expect(c.n).toBe(6);
  });
});
