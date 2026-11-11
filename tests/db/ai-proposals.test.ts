import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Orb task bridge (migration 0143): ai_proposals RLS, the guard trigger, expiry,
// and two real flows through the registry without a model: library.loan.issue,
// and attendance.mark followed by attendance.submit waiting on it (design §3);
// then one round trip per module for tasks classified after the first slice.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { approveProposal, startProposal } from "@/modules/ai/tasks/proposals.actions";
import { buildTaskTools } from "@/modules/ai/tasks/task-tools";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

let inst: TestInstitution;

beforeAll(async () => {
  inst = await createTestInstitution("ai-proposals");
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object('mode', 'daily', 'correction_window_days', 3, 'statuses', ${sql.json(STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)),
      'features', jsonb_build_object('teacher_ai_agent', true)
    )
    where id = ${inst.institutionId}
  `;
}, 60_000);

afterAll(async () => {
  await inst?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(firstName: string, lastName: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, ${`ORB-${crypto.randomUUID().slice(0, 8)}`}, ${firstName}, ${lastName}, '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

const userId = (role: "owner" | "teacher" | "admin" | "guardian") => inst.users[role].id;

async function rawProposal(createdBy: string, overrides: { status?: string; expiresAt?: string; action?: string } = {}): Promise<string> {
  const [row] = await sql`
    insert into public.ai_proposals (institution_id, created_by, action, proposed, status, expires_at)
    values (${inst.institutionId}, ${createdBy}, ${overrides.action ?? "library.loan.renew"}, '{}'::jsonb, ${overrides.status ?? "pending"},
      ${overrides.expiresAt ?? new Date(Date.now() + 600_000).toISOString()})
    returning id
  `;
  return row.id as string;
}

describe("ai_proposals RLS (0143)", () => {
  it("the creator and audit.read roles read a row; other members do not", async () => {
    const id = await rawProposal(userId("teacher"));
    const seen = async (role: "teacher" | "admin" | "owner" | "guardian" | "accountant") =>
      ((await inst.clientAs(role).from("ai_proposals").select("id").eq("id", id)).data ?? []).length;
    expect(await seen("teacher")).toBe(1);
    expect(await seen("admin")).toBe(1);
    expect(await seen("owner")).toBe(1);
    expect(await seen("guardian")).toBe(0);
    expect(await seen("accountant")).toBe(0);
    expect((await inst.clientAsAnon().from("ai_proposals").select("id").eq("id", id)).data ?? []).toHaveLength(0);
  });

  it("a member can insert only their own pending row; never for someone else or pre-approved", async () => {
    const teacher = inst.clientAs("teacher");
    const base = { institution_id: inst.institutionId, action: "library.loan.renew", proposed: {} };
    expect((await teacher.from("ai_proposals").insert({ ...base, created_by: userId("teacher") })).error).toBeNull();
    expect((await teacher.from("ai_proposals").insert({ ...base, created_by: userId("owner") })).error).not.toBeNull();
    expect((await teacher.from("ai_proposals").insert({ ...base, created_by: userId("teacher"), status: "approved" })).error).not.toBeNull();
  });

  it("no member, the creator included, can update or delete a card over PostgREST (status writes are server-only)", async () => {
    const id = await rawProposal(userId("teacher"));
    const teacher = inst.clientAs("teacher");
    const forged = await teacher.from("ai_proposals").update({ status: "approved", result_ref: { sessionId: crypto.randomUUID() } }).eq("id", id).select("id");
    expect(forged.error?.code).toBe("42501");
    expect((await teacher.from("ai_proposals").update({ status: "approving" }).eq("id", id)).error?.code).toBe("42501");
    expect((await inst.clientAs("owner").from("ai_proposals").update({ status: "discarded" }).eq("id", id)).error?.code).toBe("42501");
    await teacher.from("ai_proposals").delete().eq("id", id);
    const [row] = await sql`select status, result_ref from public.ai_proposals where id = ${id}`;
    expect(row).toMatchObject({ status: "pending", result_ref: null });

    // An in-flight claim cannot be flipped back to pending to run the target twice.
    const claimed = await rawProposal(userId("teacher"));
    await sql`update public.ai_proposals set status = 'approving' where id = ${claimed}`;
    expect((await teacher.from("ai_proposals").update({ status: "pending" }).eq("id", claimed)).error?.code).toBe("42501");
    const [still] = await sql`select status from public.ai_proposals where id = ${claimed}`;
    expect(still?.status).toBe("approving");
  });

  it("caps new cards at 30 per user per minute with rate_limited", async () => {
    const admin = userId("admin");
    await sql`
      insert into public.ai_proposals (institution_id, created_by, action, proposed)
      select ${inst.institutionId}, ${admin}, 'library.loan.renew', '{}'::jsonb from generate_series(1, 30)
    `;
    const result = await callAs(inst, "admin", startProposal, { action: "library.loan.renew", values: { accessionNo: "X-1" } });
    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    await sql`delete from public.ai_proposals where created_by = ${admin}`;
    expect((await callAs(inst, "admin", startProposal, { action: "library.loan.renew", values: { accessionNo: "X-1" } })).ok).toBe(true);
  });

  it("purge_ai_proposals deletes rows older than 30 days, keeps one a newer card waits on, and is service_role only", async () => {
    const owner = userId("owner");
    const [old] = await sql`
      insert into public.ai_proposals (institution_id, created_by, action, created_at) values (${inst.institutionId}, ${owner}, 'library.loan.renew', now() - interval '31 days') returning id`;
    const [parent] = await sql`
      insert into public.ai_proposals (institution_id, created_by, action, created_at) values (${inst.institutionId}, ${owner}, 'attendance.mark', now() - interval '31 days') returning id`;
    const [child] = await sql`
      insert into public.ai_proposals (institution_id, created_by, action, depends_on) values (${inst.institutionId}, ${owner}, 'attendance.submit', ${parent!.id}) returning id`;
    const { error } = await inst.clientAs("owner").rpc("purge_ai_proposals", {});
    expect(error).not.toBeNull();
    await sql`select public.purge_ai_proposals()`;
    const left = await sql`select id from public.ai_proposals where id in (${old!.id}, ${parent!.id}, ${child!.id})`;
    expect(left.map((r) => r.id).sort()).toEqual([parent!.id, child!.id].sort());
  });
});

describe("app.guard_ai_proposal_update (0143)", () => {
  it("allows pending → approving → approved and refuses any change after", async () => {
    const id = await rawProposal(userId("teacher"));
    await sql`update public.ai_proposals set status = 'approving' where id = ${id}`;
    await sql`update public.ai_proposals set status = 'approved' where id = ${id}`;
    await expect(sql`update public.ai_proposals set status = 'pending' where id = ${id}`).rejects.toThrow(/invalid_state/);
  });

  it("refuses skipping the claim, changing identity columns, and claiming an expired card", async () => {
    const id = await rawProposal(userId("teacher"));
    await expect(sql`update public.ai_proposals set status = 'approved' where id = ${id}`).rejects.toThrow(/invalid_state/);
    await expect(sql`update public.ai_proposals set action = 'finance.payment.record' where id = ${id}`).rejects.toThrow(/invalid_state/);
    const stale = await rawProposal(userId("teacher"), { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(sql`update public.ai_proposals set status = 'approving' where id = ${stale}`).rejects.toThrow(/invalid_state/);
    await sql`update public.ai_proposals set status = 'expired' where id = ${stale}`;
  });

  it("approve on an expired card says so and marks it expired", async () => {
    const id = await rawProposal(userId("owner"), { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const result = await callAs(inst, "owner", approveProposal, { proposalId: id, values: { accessionNo: "X-1" } });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/expired/) } });
    const [row] = await sql`select status from public.ai_proposals where id = ${id}`;
    expect(row?.status).toBe("expired");
  });
});

describe("real flows through the registry, no model", () => {
  it("library.loan.issue: the student is resolved by name, approve issues the loan once, audit has no payload", async () => {
    const studentId = await insertStudent("Orbita", "Testwala");
    const [book] = await sql`insert into public.library_books (institution_id, title, author) values (${inst.institutionId}, 'Swami and Friends', 'R. K. Narayan') returning id`;
    await sql`insert into public.library_copies (institution_id, book_id, accession_no) values (${inst.institutionId}, ${book!.id}, 'ORB-ACC-1')`;

    const started = await callAs(inst, "owner", startProposal, { action: "library.loan.issue", values: { accessionNo: "ORB-ACC-1", studentId: "Orbita Testwala" } });
    expect(started.ok).toBe(true);
    const card = (started as { data: TaskProposalOutput }).data;
    expect(card.view.values).toEqual({ accessionNo: "ORB-ACC-1", studentId });
    expect(card.view.resolved["/studentId"]?.label).toBe("Orbita Testwala");
    expect(card.view.title).toBe("Issue a library book: Orbita Testwala");

    expect(card.view.requireOneOf).toEqual([["/studentId", "/staffId"]]);
    const neither = await callAs(inst, "owner", approveProposal, { proposalId: card.proposalId, values: { accessionNo: "ORB-ACC-1" } });
    expect(neither).toMatchObject({ ok: false, error: { code: "validation_failed", fieldErrors: { "/studentId": expect.any(Array), "/staffId": expect.any(Array) } } });
    const both = await callAs(inst, "owner", approveProposal, { proposalId: card.proposalId, values: { ...card.view.values, staffId: card.view.values.studentId } });
    expect(both).toMatchObject({ ok: false, error: { fieldErrors: { "/studentId": expect.any(Array), "/staffId": expect.any(Array) } } });

    const approved = await callAs(inst, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(approved).toMatchObject({
      ok: true,
      data: { status: "approved", resultLabel: expect.stringMatching(/^Issued ORB-ACC-1 to Orbita Testwala, due \d{1,2} [A-Z][a-z]{2}$/), resultHref: `/${inst.slug}/library` },
    });
    expect((approved as { data: { undo?: unknown } }).data.undo).toBeUndefined(); // no catalog undo pair for library
    const loans = await sql`select id from public.library_loans where institution_id = ${inst.institutionId} and student_id = ${studentId}`;
    expect(loans).toHaveLength(1);
    const [row] = await sql`select status, result_ref, changed_keys from public.ai_proposals where id = ${card.proposalId}`;
    expect(row).toMatchObject({ status: "approved", changed_keys: ["accessionNo", "studentId"] });
    const events = await sql`select action, after from public.audit_events where entity_id = ${card.proposalId} order by created_at`;
    expect(events.map((e) => e.action)).toEqual(["ai.proposal.created", "ai.proposal.approved"]);
    expect(JSON.stringify(events.map((e) => e.after))).not.toContain("ORB-ACC-1");

    const again = await callAs(inst, "owner", approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(again).toMatchObject({ ok: false, error: { message: expect.stringMatching(/already approved/) } });
  });

  it("attendance.mark from a roster intent, then attendance.submit waiting on it", async () => {
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId, { code: "8" });
    const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: teacher!.staff_id });
    const ravi = await insertStudent("Ravi", "Kumar");
    const asha = await insertStudent("Asha", "Rao");
    const meena = await insertStudent("Meena", "Iyer");
    for (const [i, s] of [ravi, asha, meena].entries()) await createEnrolment(inst.institutionId, s, sectionId, yearId, { rollNo: i + 1 });

    const ctx = await buildContext(inst, "teacher");
    setActingClient(inst.clientAs("teacher") as unknown as SupabaseClient<Database>);
    let mark: TaskProposalOutput;
    let submit: TaskProposalOutput;
    try {
      const { tools } = buildTaskTools({ ctx, nonce: "n", texts: ["Mark 8B present today except Ravi, then submit"] });
      const propose = (tools.propose_task as unknown as { execute: (i: unknown) => Promise<TaskProposalOutput | string> }).execute;
      mark = (await propose({ task: "attendance.mark", values: { classSectionId: "8B", date: "today", default: "present", except: [{ student: "Ravi", status: "absent" }] } })) as TaskProposalOutput;
      submit = (await propose({ task: "attendance.submit", values: { sessionId: "00000000-0000-4000-8000-000000000000" }, after: 1 })) as TaskProposalOutput;
    } finally {
      setActingClient(null);
    }
    expect(typeof mark).toBe("object");
    expect(mark.view.values).toMatchObject({ classSectionId: sectionId });
    const records = mark.view.values.records as { studentId: string; status: string }[];
    expect(records).toHaveLength(3);
    expect(records.find((r) => r.studentId === ravi)?.status).toBe("A");
    expect(records.filter((r) => r.status === "P")).toHaveLength(2);
    expect(mark.view.resolved["/classSectionId"]?.label).toBe("8-B");
    expect(submit.view.dependsOn).toBe(mark.proposalId);
    expect(submit.view.values).toEqual({}); // the model's sessionId is never kept

    const status = mark.view.fields.find((f) => f.path === "/records")?.fields?.find((f) => f.path === "/records/*/status");
    expect(status).toMatchObject({ kind: "enum", options: ["P", "A"], optionLabels: ["Present", "Absent"] });

    const early = await callAs(inst, "teacher", approveProposal, { proposalId: submit.proposalId, values: {} });
    expect(early).toMatchObject({ ok: false, error: { code: "invalid_state", message: expect.stringMatching(/earlier card/) } });

    expect(await callAs(inst, "teacher", approveProposal, { proposalId: mark.proposalId, values: mark.view.values })).toMatchObject({ ok: true });
    expect(await callAs(inst, "teacher", approveProposal, { proposalId: submit.proposalId, values: {} })).toMatchObject({ ok: true });

    const [session] = await sql`select id, status from public.attendance_sessions where class_section_id = ${sectionId}`;
    expect(session?.status).toBe("submitted");
    const absent = await sql`select student_id from public.attendance_records where session_id = ${session!.id} and status = 'A'`;
    expect(absent.map((r) => r.student_id)).toEqual([ravi]);
  });

  it("an empty register card is replaced by one with the picked section's roster (start with replaces)", async () => {
    const yearId = await createAcademicYear(inst.institutionId, { name: "2027-28", isCurrent: false });
    const gradeId = await createGrade(inst.institutionId, { code: "9" });
    const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
    const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "C", classTeacherId: teacher!.staff_id });
    const kids = [await insertStudent("Neel", "Varma"), await insertStudent("Ojas", "Rana")];
    for (const [i, s] of kids.entries()) await createEnrolment(inst.institutionId, s, sectionId, yearId, { rollNo: i + 1 });

    const empty = await callAs(inst, "teacher", startProposal, { action: "attendance.mark" });
    expect(empty.ok).toBe(true);
    const first = (empty as { data: TaskProposalOutput }).data;
    expect(first.view.values.records).toBeUndefined();

    const picked = await callAs(inst, "teacher", startProposal, {
      action: "attendance.mark", values: { classSectionId: sectionId, date: first.view.values.date }, replaces: first.proposalId,
    });
    expect(picked.ok).toBe(true);
    const next = (picked as { data: TaskProposalOutput }).data;
    expect(next.proposalId).not.toBe(first.proposalId);
    expect(next.view.resolved["/classSectionId"]?.label).toBe("9-C");
    expect(next.view.values.records).toEqual(kids.map((studentId) => ({ studentId, status: "P" })));
    const [old] = await sql`select status from public.ai_proposals where id = ${first.proposalId}`;
    expect(old?.status).toBe("discarded");

    const again = await callAs(inst, "teacher", startProposal, { action: "attendance.mark", values: { classSectionId: sectionId }, replaces: first.proposalId });
    expect(again).toMatchObject({ ok: false, error: { message: expect.stringMatching(/discarded/) } });
    const otherTask = await callAs(inst, "teacher", startProposal, { action: "attendance.markPeriod", values: {}, replaces: next.proposalId });
    expect(otherTask).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const [still] = await sql`select status from public.ai_proposals where id = ${next.proposalId}`;
    expect(still?.status).toBe("pending");
  });
});

describe("newly classified tasks: start → approve as the owning role, refused for a role without the permission", () => {
  type Role = Parameters<typeof callAs>[1];

  beforeAll(async () => {
    // AI is off by default for these roles (capabilities/resolve.ts DEFAULT_ENABLED_ROLES).
    const on = { enabled: true };
    await sql`
      update public.institutions
      set settings = settings || jsonb_build_object('ai_roles', coalesce(settings->'ai_roles', '{}'::jsonb)
        || ${sql.json({ accountant: on, exam_controller: on, guardian: on })}::jsonb)
      where id = ${inst.institutionId}
    `;
  });

  async function roundTrip(role: Role, action: string, values: Record<string, unknown>) {
    const started = await callAs(inst, role, startProposal, { action, values });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    const card = (started as { data: TaskProposalOutput }).data;
    const approved = await callAs(inst, role, approveProposal, { proposalId: card.proposalId, values: card.view.values });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, data: { status: "approved" } });
    return { card, result: (approved as { data: { undo?: { action: string; values?: Record<string, unknown> } } }).data };
  }

  /** Refused at start (taskState permission lock) and at approve (re-checked on a stored card). */
  async function refused(role: Role, action: string, values: Record<string, unknown>) {
    expect(await callAs(inst, role, startProposal, { action, values })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const id = await rawProposal(inst.users[role].id, { action });
    expect(await callAs(inst, role, approveProposal, { proposalId: id, values })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  }

  it("maintenance.request (teacher): the request is raised; a guardian is refused", async () => {
    const values = { issue: "Ceiling fan in 8B does not turn on", location: "Room 8B", priority: "high" };
    await roundTrip("teacher", "maintenance.request", values);
    const rows = await sql`select location, priority, status from public.maintenance_requests where institution_id = ${inst.institutionId} and issue = ${values.issue}`;
    expect(rows).toEqual([{ location: "Room 8B", priority: "high", status: "open" }]);
    await refused("guardian", "maintenance.request", values);
  });

  it("people.staffAttendance.checkIn (teacher): today's row is written for the teacher's own staff record; a guardian is refused", async () => {
    await roundTrip("teacher", "people.staffAttendance.checkIn", {});
    const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
    const rows = await sql`select status from public.staff_attendance where institution_id = ${inst.institutionId} and staff_id = ${teacher!.staff_id}`;
    expect(rows).toHaveLength(1);
    await refused("guardian", "people.staffAttendance.checkIn", {});
  });

  it("inventory.item.create (accountant): the stock item exists; a teacher is refused", async () => {
    const values = { name: "Whiteboard marker (blue)", unit: "box", reorderLevel: 5 };
    await roundTrip("accountant", "inventory.item.create", values);
    const rows = await sql`select unit, reorder_level from public.inventory_items where institution_id = ${inst.institutionId} and name = ${values.name}`;
    expect(rows).toEqual([{ unit: "box", reorder_level: 5 }]);
    await refused("teacher", "inventory.item.create", values);
  });

  it("transport.assign (admin): stop and student resolved by name, the assignment is written, unassign is offered; a teacher is refused", async () => {
    const studentId = await insertStudent("Tara", "Busrider");
    const [route] = await sql`insert into public.transport_routes (institution_id, name) values (${inst.institutionId}, 'Route Orb') returning id`;
    const [stop] = await sql`
      insert into public.transport_stops (institution_id, route_id, seq, name, pickup_time, map_x, map_y)
      values (${inst.institutionId}, ${route!.id}, 1, 'Gate Four Orb', '07:30', 10, 20) returning id`;

    const { card, result } = await roundTrip("admin", "transport.assign", { studentId: "Tara Busrider", stopId: "Gate Four Orb" });
    expect(card.view.values).toEqual({ studentId, stopId: stop!.id });
    expect(card.view.resolved["/stopId"]).toMatchObject({ label: "Gate Four Orb", hint: expect.stringContaining("Route Orb") });
    const rows = await sql`select route_id, stop_id from public.transport_assignments where institution_id = ${inst.institutionId} and student_id = ${studentId}`;
    expect(rows).toEqual([{ route_id: route!.id, stop_id: stop!.id }]);
    expect(result.undo).toEqual({ action: "transport.unassign", label: "Take a student off school transport", values: { studentId } });
    await refused("teacher", "transport.assign", { studentId, stopId: stop!.id });
  });

  it("exam.create (exam controller): the exam is created in the current year's term; a teacher is refused", async () => {
    let [year] = await sql`select id from public.academic_years where institution_id = ${inst.institutionId} and is_current`;
    year ??= { id: await createAcademicYear(inst.institutionId, { name: "2029-30" }) };
    const termId = await createTerm(inst.institutionId, year.id as string, { name: "Orb Term", sequence: 9 });
    const values = { termId, name: "Orb Unit Test 1", type: "unit_test" };
    const { card } = await roundTrip("exam_controller", "exam.create", values);
    expect(card.view.resolved["/termId"]?.label).toBe("Orb Term");
    const rows = await sql`select term_id, type, academic_year_id from public.exams where institution_id = ${inst.institutionId} and name = ${values.name}`;
    expect(rows).toEqual([{ term_id: termId, type: "unit_test", academic_year_id: year.id }]);
    await refused("teacher", "exam.create", values);
  });

  it("clubs.event.signUp (guardian): the event is resolved by title, the child is pinned, cancel is offered; an admin is refused", async () => {
    const child = await insertStudent("Kiran", "Clubwala");
    const [guardian] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
    await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship) values (${inst.institutionId}, ${guardian!.guardian_id}, ${child}, 'mother')`;
    const [club] = await sql`insert into public.clubs (institution_id, name) values (${inst.institutionId}, 'Orb Astronomy Club') returning id`;
    const [event] = await sql`
      insert into public.club_events (institution_id, club_id, title, starts_at)
      values (${inst.institutionId}, ${club!.id}, 'Orb Star Night', now() + interval '7 days') returning id`;

    // The model's studentId is ignored: a guardian's card is pinned to their own child.
    const { card, result } = await roundTrip("guardian", "clubs.event.signUp", { eventId: "Orb Star Night", studentId: crypto.randomUUID() });
    expect(card.view.values).toEqual({ eventId: event!.id, studentId: child });
    const rows = await sql`select signed_up_by from public.club_event_signups where event_id = ${event!.id} and student_id = ${child}`;
    expect(rows).toEqual([{ signed_up_by: inst.users.guardian.id }]);
    expect(result.undo).toMatchObject({ action: "clubs.event.cancelSignup", values: { eventId: event!.id, studentId: child } });
    await refused("admin", "clubs.event.signUp", { eventId: event!.id, studentId: child });
  });
});
