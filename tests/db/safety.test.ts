// Features-18 #21 — safety alerts: definers (send/close/acknowledge/headcount),
// RLS audience, actions, queries, and the notify.safety_alert job handler.
import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { Database } from "@/lib/db/types";
import {
  acknowledgeSafetyAlert,
  closeSafetyAlert,
  markSafetyHeadcount,
  previewSafetyAudience,
  sendSafetyAlert,
} from "@/modules/safety/actions";
import { listSafetyAlerts, myHeadcountSections, safetyAlertSummary, safetyPendingAcknowledgements } from "@/modules/safety/queries";
import { notifySafetyAlert } from "@/modules/jobs/handlers/index";
import { JOB_MODULES, resolveHandler } from "@/modules/jobs/registry";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;
let other: TestInstitution;
let sectionA: string;
let sectionB: string;
let otherSection: string;

const STAFF: FixtureRole[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"];

async function one(q: Promise<postgres.RowList<postgres.Row[]>>) {
  const [r] = await q;
  return r!;
}

beforeAll(async () => {
  inst = await createTestInstitution("safety");
  other = await createTestInstitution("safety-x");
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaff = (await one(sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`)).staff_id as string;
  sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
  sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const studentId = (await one(sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`)).student_id as string;
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId);
  const guardianId = (await one(sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`)).guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'mother', true, true)`;
  // A section-B student with no portal account: never a recipient.
  const stray = (await one(sql`insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst.institutionId}, 'SF-X1', 'Stray', 'Student', '2014-01-01', 'female') returning id`)).id as string;
  await createEnrolment(inst.institutionId, stray, sectionB, yearId);

  const otherYear = await createAcademicYear(other.institutionId);
  const otherGrade = await createGrade(other.institutionId, { code: "VI" });
  otherSection = await createClassSection(other.institutionId, otherGrade, otherYear, { name: "A" });
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

/**
 * Inserts an alert as the trusted role, dated two hours back so it never
 * counts toward the 10-per-hour cap (only the send tests exercise the definer).
 */
async function insertAlert(
  fixture: TestInstitution,
  opts: { audience: "all" | "staff" | "sections"; sections?: string[]; kind?: string; title?: string; message?: string },
): Promise<string> {
  const alert = await one(sql`
    insert into public.safety_alerts (institution_id, kind, title, message, audience, created_by, created_at)
    values (${fixture.institutionId}, ${opts.kind ?? "emergency"}, ${opts.title ?? "Lockdown"}, ${opts.message ?? "Stay in class."},
            ${opts.audience}, ${fixture.users.principal.id}, now() - interval '2 hours')
    returning id`);
  for (const s of opts.sections ?? []) {
    await sql`insert into public.safety_alert_sections (institution_id, alert_id, class_section_id) values (${fixture.institutionId}, ${alert.id}, ${s})`;
  }
  return alert.id as string;
}

async function closeAlert(alertId: string) {
  await sql`update public.safety_alerts set status = 'closed', closed_at = now(), closed_by = ${inst.users.principal.id} where id = ${alertId}`;
}

function makeJob(institutionId: string, alertId: string | undefined) {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    institution_id: institutionId,
    type: "notify.safety_alert",
    payload: alertId === undefined ? {} : { alert_id: alertId },
    idempotency_key: `safety_alert:${alertId}`,
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

async function recipientsOf(alertId: string): Promise<string[]> {
  const rows = await sql`select recipient_user_id from public.notifications
    where type = 'safety_alert' and data->>'key' like ${`safety_alert:${alertId}:%`} order by recipient_user_id`;
  return rows.map((r) => r.recipient_user_id as string);
}

const ids = (fixture: TestInstitution, roles: FixtureRole[]) => roles.map((r) => fixture.users[r].id).sort();

async function asRole<T>(fixture: TestInstitution, role: FixtureRole, fn: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>): Promise<T> {
  const ctx = await buildContext(fixture, role);
  setActingClient(fixture.clientAs(role) as unknown as SupabaseClient<Database>);
  try {
    return await fn(ctx);
  } finally {
    setActingClient(null);
  }
}

describe("send and close (definers)", () => {
  it("a manager sends an alert; the definer enqueues notify.safety_alert with only the alert id", async () => {
    const res = await callAs(inst, "admin", sendSafetyAlert, { kind: "drill", title: "Fire drill", message: "Walk to the ground.", audience: "all" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const job = await one(sql`select type, payload from public.jobs where idempotency_key = ${`safety_alert:${res.data.id}`}`);
    expect(job.type).toBe("notify.safety_alert");
    expect(job.payload).toEqual({ alert_id: res.data.id });
    await closeAlert(res.data.id);
  });

  it("non-managers cannot send or close, through the action or the definer directly", async () => {
    for (const role of ["teacher", "accountant", "student", "guardian"] as const) {
      const sent = await callAs(inst, role, sendSafetyAlert, { kind: "drill", title: "x", message: "y", audience: "all" });
      expect(sent).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    const alertId = await insertAlert(inst, { audience: "all" });
    expect(await callAs(inst, "teacher", closeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const direct = await inst.clientAs("teacher").rpc("create_safety_alert", {
      p_institution_id: inst.institutionId, p_kind: "drill", p_title: "x", p_message: "y", p_audience: "all", p_section_ids: [],
    });
    expect(direct.error?.message).toBe("code:forbidden");
    const directClose = await inst.clientAs("teacher").rpc("close_safety_alert", { p_institution_id: inst.institutionId, p_alert_id: alertId });
    expect(directClose.error?.message).toBe("code:forbidden");

    expect((await callAs(inst, "principal", closeSafetyAlert, { alertId })).ok).toBe(true);
    expect(await callAs(inst, "principal", closeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });
});

describe("acknowledge", () => {
  it("an audience member acknowledges once; the second call is a conflict", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    expect((await callAs(inst, "teacher", acknowledgeSafetyAlert, { alertId })).ok).toBe(true);
    expect(await callAs(inst, "teacher", acknowledgeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "conflict" } });
    await closeAlert(alertId);
    expect(await callAs(inst, "guardian", acknowledgeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("a guardian of another section cannot read or acknowledge a sections alert; their own section's they can", async () => {
    const onlyB = await insertAlert(inst, { audience: "sections", sections: [sectionB] });
    const onlyA = await insertAlert(inst, { audience: "sections", sections: [sectionA] });
    for (const role of ["guardian", "student"] as const) {
      const { data } = await inst.clientAs(role).from("safety_alerts").select("id").in("id", [onlyA, onlyB]);
      expect((data ?? []).map((r) => r.id)).toEqual([onlyA]);
    }
    expect(await callAs(inst, "guardian", acknowledgeSafetyAlert, { alertId: onlyB })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await callAs(inst, "student", acknowledgeSafetyAlert, { alertId: onlyA })).ok).toBe(true);
    // Staff see every alert, whatever the audience.
    const { data: staffView } = await inst.clientAs("accountant").from("safety_alerts").select("id").in("id", [onlyA, onlyB]);
    expect(staffView).toHaveLength(2);
    // A staff-only alert is invisible to students and guardians.
    const staffOnly = await insertAlert(inst, { audience: "staff" });
    const { data: hidden } = await inst.clientAs("guardian").from("safety_alerts").select("id").eq("id", staffOnly);
    expect(hidden).toHaveLength(0);
    expect(await callAs(inst, "student", acknowledgeSafetyAlert, { alertId: staffOnly })).toMatchObject({ ok: false, error: { code: "not_found" } });
    await Promise.all([onlyA, onlyB, staffOnly].map(closeAlert));
  });
});

describe("headcount", () => {
  it("the section's teacher marks (upsert); another section is refused; managers mark any section", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    const hc = { alertId, classSectionId: sectionA, presentCount: 30, missingCount: 2, note: "Two at the nurse" };
    expect((await callAs(inst, "teacher", markSafetyHeadcount, hc)).ok).toBe(true);
    expect((await callAs(inst, "teacher", markSafetyHeadcount, { ...hc, presentCount: 32, missingCount: 0, note: undefined })).ok).toBe(true);
    const rows = await sql`select present_count, missing_count, note from public.safety_headcounts where alert_id = ${alertId}`;
    expect(rows).toEqual([{ present_count: 32, missing_count: 0, note: null }]);

    expect(await callAs(inst, "teacher", markSafetyHeadcount, { ...hc, classSectionId: sectionB })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await callAs(inst, "accountant", markSafetyHeadcount, hc)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect((await callAs(inst, "admin", markSafetyHeadcount, { ...hc, classSectionId: sectionB, presentCount: 1, missingCount: 0 })).ok).toBe(true);

    // RLS: the teacher reads only their section's headcount; a non-M staff reads none.
    const { data: teacherRows } = await inst.clientAs("teacher").from("safety_headcounts").select("class_section_id").eq("alert_id", alertId);
    expect((teacherRows ?? []).map((r) => r.class_section_id)).toEqual([sectionA]);
    const { data: accountantRows } = await inst.clientAs("accountant").from("safety_headcounts").select("id").eq("alert_id", alertId);
    expect(accountantRows).toHaveLength(0);

    await closeAlert(alertId);
    expect(await callAs(inst, "teacher", markSafetyHeadcount, hc)).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  it("a sections alert only takes headcounts for its targeted sections", async () => {
    const alertId = await insertAlert(inst, { audience: "sections", sections: [sectionA] });
    const res = await callAs(inst, "admin", markSafetyHeadcount, { alertId, classSectionId: sectionB, presentCount: 1, missingCount: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await closeAlert(alertId);
  });
});

describe("cross-tenant", () => {
  it("another school's manager or member cannot read, close, acknowledge or mark this school's alert", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    const { data } = await other.clientAs("owner").from("safety_alerts").select("id").eq("id", alertId);
    expect(data).toHaveLength(0);
    expect(await callAs(other, "admin", closeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await callAs(other, "student", acknowledgeSafetyAlert, { alertId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      await callAs(other, "admin", markSafetyHeadcount, { alertId, classSectionId: otherSection, presentCount: 1, missingCount: 0 }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    const direct = await other.clientAs("admin").rpc("close_safety_alert", { p_institution_id: inst.institutionId, p_alert_id: alertId });
    expect(direct.error?.message).toBe("code:forbidden");
    // A section of another school cannot be targeted.
    const bad = await callAs(inst, "admin", sendSafetyAlert, { kind: "drill", title: "x", message: "y", audience: "sections", sectionIds: [otherSection] });
    expect(bad).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await closeAlert(alertId);
  });
});

describe("rate limit", () => {
  it("the 11th alert in an hour is refused", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await callAs(other, "principal", sendSafetyAlert, { kind: "drill", title: `Drill ${i}`, message: "Practice.", audience: "staff" });
      expect(res.ok).toBe(true);
    }
    const eleventh = await callAs(other, "principal", sendSafetyAlert, { kind: "emergency", title: "Eleventh", message: "x", audience: "staff" });
    expect(eleventh).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });
});

describe("notify.safety_alert handler", () => {
  it("is registered and gated by the safety module", () => {
    expect(resolveHandler("notify.safety_alert")).toBe(notifySafetyAlert);
    expect(JOB_MODULES["notify.safety_alert"]).toBe("safety");
  });

  it("a sections alert notifies only those sections' students/guardians plus staff, content from the row", async () => {
    const alertId = await insertAlert(inst, { audience: "sections", sections: [sectionA], kind: "emergency", title: "Gas leak", message: "Move to the east gate." });
    await notifySafetyAlert(makeJob(inst.institutionId, alertId), { admin });
    expect(await recipientsOf(alertId)).toEqual(ids(inst, [...STAFF, "student", "guardian"]));

    const bodies = await sql`select n.body, d.channel, d.status from public.notifications n
      join public.delivery_attempts d on d.notification_id = n.id
      where n.data->>'key' = ${`safety_alert:${alertId}:${inst.users.guardian.id}`}`;
    expect(bodies.map((b) => b.channel).sort()).toEqual(["in_app", "sms"]);
    expect(bodies.find((b) => b.channel === "sms")?.status).toBe("simulated");
    expect(bodies[0]!.body).toContain("EMERGENCY: Gas leak");
    expect(bodies[0]!.body).toContain("Move to the east gate.");

    // The confirm-step preview counts exactly the same people.
    const preview = await callAs(inst, "admin", previewSafetyAudience, { audience: "sections", sectionIds: [sectionA] });
    expect(preview).toEqual({ ok: true, data: { total: 9, staff: 7, students: 1, guardians: 1 } });

    const onlyB = await insertAlert(inst, { audience: "sections", sections: [sectionB] });
    await notifySafetyAlert(makeJob(inst.institutionId, onlyB), { admin });
    expect(await recipientsOf(onlyB)).toEqual(ids(inst, STAFF));
    await Promise.all([alertId, onlyB].map(closeAlert));
  });

  it("a staff alert notifies no student or guardian; an all alert reaches every active member", async () => {
    const staffOnly = await insertAlert(inst, { audience: "staff" });
    await notifySafetyAlert(makeJob(inst.institutionId, staffOnly), { admin });
    expect(await recipientsOf(staffOnly)).toEqual(ids(inst, STAFF));

    const all = await insertAlert(inst, { audience: "all" });
    await sql`update public.memberships set status = 'disabled' where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}`;
    try {
      await notifySafetyAlert(makeJob(inst.institutionId, all), { admin });
    } finally {
      await sql`update public.memberships set status = 'active' where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}`;
    }
    expect(await recipientsOf(all)).toEqual(ids(inst, [...STAFF, "student"]));
    await Promise.all([staffOnly, all].map(closeAlert));
  });

  it("a retried job sends nothing new", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    await notifySafetyAlert(makeJob(inst.institutionId, alertId), { admin });
    const count = async () =>
      one(sql`select count(distinct n.id)::int as n, count(d.id)::int as d from public.notifications n
        left join public.delivery_attempts d on d.notification_id = n.id
        where n.data->>'key' like ${`safety_alert:${alertId}:%`}`);
    const first = await count();
    expect(first.n).toBe(9);
    await notifySafetyAlert(makeJob(inst.institutionId, alertId), { admin });
    expect(await count()).toEqual(first);
    await closeAlert(alertId);
  });

  it("a closed or missing alert sends nothing; a payload without alert_id throws", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    await closeAlert(alertId);
    await notifySafetyAlert(makeJob(inst.institutionId, alertId), { admin });
    expect(await recipientsOf(alertId)).toEqual([]);
    await expect(notifySafetyAlert(makeJob(inst.institutionId, crypto.randomUUID()), { admin })).resolves.toBeUndefined();
    await expect(notifySafetyAlert(makeJob(inst.institutionId, undefined), { admin })).rejects.toThrow();
  });
});

describe("queries", () => {
  it("managers get name-free counts, the headcount board (unreported first) and the pending names", async () => {
    const alertId = await insertAlert(inst, { audience: "all" });
    await callAs(inst, "teacher", acknowledgeSafetyAlert, { alertId });
    await callAs(inst, "teacher", markSafetyHeadcount, { alertId, classSectionId: sectionA, presentCount: 1, missingCount: 0 });

    const summary = await asRole(inst, "principal", (ctx) => safetyAlertSummary(ctx, alertId));
    expect(summary?.audience).toEqual({ total: 9, staff: 7, students: 1, guardians: 1 });
    expect(summary?.acknowledged).toEqual({ total: 1, staff: 1, students: 0, guardians: 0 });
    expect(summary?.headcount).toEqual({ reportedSections: 1, totalSections: 2, present: 1, missing: 0 });
    expect(summary?.board.map((r) => [r.label, r.headcount?.presentCount ?? null])).toEqual([
      ["VI-B", null],
      ["VI-A", 1],
    ]);

    const pending = await asRole(inst, "principal", (ctx) => safetyPendingAcknowledgements(ctx, alertId));
    expect(pending?.total).toBe(8);
    expect(pending?.shown.map((p) => p.group)).toEqual(["staff", "staff", "staff", "staff", "staff", "staff", "guardian", "student"]);
    expect(pending?.shown.some((p) => p.name === "Unnamed member")).toBe(false);

    const mine = await asRole(inst, "teacher", (ctx) => myHeadcountSections(ctx, alertId));
    expect(mine.map((r) => r.label)).toEqual(["VI-A"]);
    await closeAlert(alertId);
  });

  it("a guardian lists only alerts in their audience, with their section's label and own acknowledgement", async () => {
    const forA = await insertAlert(inst, { audience: "sections", sections: [sectionA] });
    const forB = await insertAlert(inst, { audience: "sections", sections: [sectionB] });
    await callAs(inst, "guardian", acknowledgeSafetyAlert, { alertId: forA });
    const list = await asRole(inst, "guardian", (ctx) => listSafetyAlerts(ctx));
    const active = list.active.filter((a) => a.id === forA || a.id === forB);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: forA, sectionLabels: ["VI-A"], acknowledgedByMe: true });
    expect(list.history.some((a) => a.id === forB)).toBe(false);
    await Promise.all([forA, forB].map(closeAlert));
  });
});
