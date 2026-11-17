import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Migration 0102: message_threads + messages + start_message_thread /
// send_message / mark_thread_read. Seeds go through the direct postgres
// connection (guard-trigger bypass), behaviour goes through real role clients.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function membershipId(institutionId: string, role: string, column: "staff_id" | "guardian_id" | "student_id") {
  const [row] = await sql`select ${sql(column)} as id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.id as string;
}

async function createBareStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  return row.id as string;
}

async function createBareGuardian(institutionId: string): Promise<string> {
  const phone = `9${Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("")}`;
  const [row] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, 'Other Parent', ${phone})
    returning id
  `;
  return row.id as string;
}

async function createBareStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** section (class teacher = fixture teacher) + fixture student enrolled + fixture guardian linked. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await membershipId(inst.institutionId, "teacher", "staff_id");
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff });
  const studentId = await membershipId(inst.institutionId, "student", "student_id");
  const guardianId = await membershipId(inst.institutionId, "guardian", "guardian_id");
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { teacherStaff, studentId, guardianId, sectionId };
}

async function seedThread(
  inst: TestInstitution,
  args: { studentId: string; guardianId: string; teacherStaff: string; senderUserId: string; body?: string },
) {
  const [thread] = await sql`
    insert into public.message_threads (institution_id, student_id, guardian_id, teacher_staff_id, subject, created_by)
    values (${inst.institutionId}, ${args.studentId}, ${args.guardianId}, ${args.teacherStaff}, ${`Subject ${crypto.randomUUID().slice(0, 6)}`}, ${args.senderUserId})
    returning id
  `;
  const [message] = await sql`
    insert into public.messages (institution_id, thread_id, sender_profile_id, body)
    values (${inst.institutionId}, ${thread.id}, ${args.senderUserId}, ${args.body ?? "Hello"})
    returning id
  `;
  return { threadId: thread.id as string, messageId: message.id as string };
}

describe("messaging (0102)", () => {
  it("guardian starts a thread with the child's teacher; teacher sees it, is notified, and the start is audited", async () => {
    const inst = await createTestInstitution("msg-start");
    try {
      const base = await makeBase(inst);
      const started = await inst.clientAs("guardian").rpc("start_message_thread", {
        p_institution_id: inst.institutionId,
        p_student_id: base.studentId,
        p_counterpart_id: base.teacherStaff,
        p_subject: "Homework help",
        p_body: "Could we talk about the maths homework?",
      });
      expect(started.error).toBeNull();
      const threadId = (started.data as { id: string }).id;

      const teacherView = await inst.clientAs("teacher").from("message_threads").select("id, messages(body)").eq("id", threadId);
      expect(teacherView.error).toBeNull();
      expect(teacherView.data).toHaveLength(1);

      const notes = await sql`
        select 1 from public.notifications
        where recipient_user_id = ${inst.users.teacher.id} and type = 'message.received'
      `;
      expect(notes).toHaveLength(1);

      const audits = await sql`
        select 1 from public.audit_events where institution_id = ${inst.institutionId} and action = 'message_thread.started' and entity_id = ${threadId}
      `;
      expect(audits).toHaveLength(1);

      // Same (student, guardian, teacher, subject) appends instead of duplicating.
      const again = await inst.clientAs("guardian").rpc("start_message_thread", {
        p_institution_id: inst.institutionId,
        p_student_id: base.studentId,
        p_counterpart_id: base.teacherStaff,
        p_subject: "Homework help",
        p_body: "Following up.",
      });
      expect((again.data as { id: string }).id).toBe(threadId);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian cannot start a thread with a teacher who does not teach the child", async () => {
    const inst = await createTestInstitution("msg-wrong-teacher");
    try {
      const base = await makeBase(inst);
      const stranger = await createBareStaff(inst.institutionId);
      const res = await inst.clientAs("guardian").rpc("start_message_thread", {
        p_institution_id: inst.institutionId,
        p_student_id: base.studentId,
        p_counterpart_id: stranger,
        p_subject: "Hi",
        p_body: "Hello",
      });
      expect(res.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian cannot read another guardian's thread about the same child", async () => {
    const inst = await createTestInstitution("msg-other-guardian");
    try {
      const base = await makeBase(inst);
      const otherGuardian = await createBareGuardian(inst.institutionId);
      const { threadId } = await seedThread(inst, {
        studentId: base.studentId,
        guardianId: otherGuardian,
        teacherStaff: base.teacherStaff,
        senderUserId: inst.users.teacher.id,
      });

      const threads = await inst.clientAs("guardian").from("message_threads").select("id").eq("id", threadId);
      expect(threads.data).toEqual([]);
      const messages = await inst.clientAs("guardian").from("messages").select("id").eq("thread_id", threadId);
      expect(messages.data).toEqual([]);

      const adminView = await inst.clientAs("admin").from("message_threads").select("id").eq("id", threadId);
      expect(adminView.data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a guardian from another institution reads nothing", async () => {
    const a = await createTestInstitution("msg-tenant-a");
    const b = await createTestInstitution("msg-tenant-b");
    try {
      const base = await makeBase(a);
      const { threadId } = await seedThread(a, { ...base, teacherStaff: base.teacherStaff, senderUserId: a.users.guardian.id });
      const res = await b.clientAs("guardian").from("message_threads").select("id").eq("id", threadId);
      expect(res.data).toEqual([]);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  }, 40_000);

  it("teacher cannot read a thread for a student they do not teach", async () => {
    const inst = await createTestInstitution("msg-untaught");
    try {
      const base = await makeBase(inst);
      const untaught = await createBareStudent(inst.institutionId);
      const { threadId } = await seedThread(inst, {
        studentId: untaught,
        guardianId: base.guardianId,
        teacherStaff: base.teacherStaff,
        senderUserId: inst.users.guardian.id,
      });
      const res = await inst.clientAs("teacher").from("message_threads").select("id").eq("id", threadId);
      expect(res.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("message body is immutable and direct writes are refused", async () => {
    const inst = await createTestInstitution("msg-immutable");
    try {
      const base = await makeBase(inst);
      const { threadId, messageId } = await seedThread(inst, {
        studentId: base.studentId,
        guardianId: base.guardianId,
        teacherStaff: base.teacherStaff,
        senderUserId: inst.users.guardian.id,
        body: "Original",
      });

      const guardian = inst.clientAs("guardian");
      const update = await guardian.from("messages").update({ body: "Edited" }).eq("id", messageId);
      expect(update.error).not.toBeNull();
      const del = await guardian.from("messages").delete().eq("id", messageId);
      expect(del.error).not.toBeNull();
      const insert = await guardian
        .from("messages")
        .insert({ institution_id: inst.institutionId, thread_id: threadId, sender_profile_id: inst.users.guardian.id, body: "Direct" });
      expect(insert.error).not.toBeNull();
      const threadUpdate = await guardian.from("message_threads").update({ subject: "x" }).eq("id", threadId);
      expect(threadUpdate.error).not.toBeNull();

      const [row] = await sql`select body from public.messages where id = ${messageId}`;
      expect(row.body).toBe("Original");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("non-participants (other teacher, owner) cannot send; participants can", async () => {
    const inst = await createTestInstitution("msg-send");
    try {
      const base = await makeBase(inst);
      const otherStaff = await createBareStaff(inst.institutionId);
      const { threadId } = await seedThread(inst, {
        studentId: base.studentId,
        guardianId: base.guardianId,
        teacherStaff: otherStaff,
        senderUserId: inst.users.guardian.id,
      });
      // thread teacher is someone else, so the fixture teacher is a non-participant
      const asTeacher = await inst.clientAs("teacher").rpc("send_message", { p_thread_id: threadId, p_body: "Intruding" });
      expect(asTeacher.error?.message).toBe("code:forbidden");
      const asOwner = await inst.clientAs("owner").rpc("send_message", { p_thread_id: threadId, p_body: "Owner" });
      expect(asOwner.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("participants exchange messages and read receipts only mark the other side's messages", async () => {
    const inst = await createTestInstitution("msg-read");
    try {
      const base = await makeBase(inst);
      const { threadId } = await seedThread(inst, {
        studentId: base.studentId,
        guardianId: base.guardianId,
        teacherStaff: base.teacherStaff,
        senderUserId: inst.users.guardian.id,
        body: "From guardian",
      });

      const sent = await inst.clientAs("teacher").rpc("send_message", { p_thread_id: threadId, p_body: "From teacher" });
      expect(sent.error).toBeNull();

      const teacherRead = await inst.clientAs("teacher").rpc("mark_thread_read", { p_thread_id: threadId });
      expect(teacherRead.data).toBe(1);
      const again = await inst.clientAs("teacher").rpc("mark_thread_read", { p_thread_id: threadId });
      expect(again.data).toBe(0);

      const rows = await sql`select sender_profile_id, read_at from public.messages where thread_id = ${threadId}`;
      const own = rows.find((r) => r.sender_profile_id === inst.users.teacher.id);
      const theirs = rows.find((r) => r.sender_profile_id === inst.users.guardian.id);
      expect(own?.read_at).toBeNull();
      expect(theirs?.read_at).not.toBeNull();

      const outsider = await inst.clientAs("accountant").rpc("mark_thread_read", { p_thread_id: threadId });
      expect(outsider.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("school office messaging (0156)", () => {
  it("admin messages a student's guardian without teaching the child; the guardian sees it and both can reply", async () => {
    const inst = await createTestInstitution("msg-office");
    try {
      const base = await makeBase(inst);
      const adminStaff = await membershipId(inst.institutionId, "admin", "staff_id");
      const started = await inst.clientAs("admin").rpc("start_message_thread", {
        p_institution_id: inst.institutionId,
        p_student_id: base.studentId,
        p_counterpart_id: base.guardianId,
        p_subject: "Bus pass renewal",
        p_body: "Please send a photo for the new bus pass.",
      });
      expect(started.error).toBeNull();
      expect(started.data!.teacher_staff_id).toBe(adminStaff);
      const threadId = started.data!.id as string;

      const guardianView = await inst.clientAs("guardian").from("message_threads").select("id").eq("id", threadId);
      expect(guardianView.data).toHaveLength(1);
      const reply = await inst.clientAs("guardian").rpc("send_message", { p_thread_id: threadId, p_body: "Sent it today." });
      expect(reply.error).toBeNull();
      const back = await inst.clientAs("admin").rpc("send_message", { p_thread_id: threadId, p_body: "Received, thank you." });
      expect(back.error).toBeNull();
      const [{ n }] = await sql`select count(*)::int as n from public.notifications where institution_id = ${inst.institutionId} and recipient_user_id = ${inst.users.admin.id} and type = 'message.received'`;
      expect(n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("other staff roles still cannot start a thread, and the office cannot write to an unlinked guardian", async () => {
    const inst = await createTestInstitution("msg-office-deny");
    try {
      const base = await makeBase(inst);
      const asAccountant = await inst.clientAs("accountant").rpc("start_message_thread", {
        p_institution_id: inst.institutionId, p_student_id: base.studentId, p_counterpart_id: base.guardianId, p_subject: "Fees", p_body: "Hello",
      });
      expect(asAccountant.error?.message).toBe("code:forbidden");
      const stranger = await createBareGuardian(inst.institutionId);
      const unlinked = await inst.clientAs("admin").rpc("start_message_thread", {
        p_institution_id: inst.institutionId, p_student_id: base.studentId, p_counterpart_id: stranger, p_subject: "Hi", p_body: "Hello",
      });
      expect(unlinked.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a guardian still cannot open a thread with the office (only with the child's teachers)", async () => {
    const inst = await createTestInstitution("msg-office-guardian");
    try {
      const base = await makeBase(inst);
      const adminStaff = await membershipId(inst.institutionId, "admin", "staff_id");
      const res = await inst.clientAs("guardian").rpc("start_message_thread", {
        p_institution_id: inst.institutionId, p_student_id: base.studentId, p_counterpart_id: adminStaff, p_subject: "Hi", p_body: "Hello",
      });
      expect(res.error?.message).toBe("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
