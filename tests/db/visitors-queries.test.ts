// X07-T8 — src/modules/visitors/queries.ts, called directly as plain query
// functions (buildContext + setActingClient pattern), plus the
// query-defs.ts wrapper via callAs for the permission-gate case. Mirrors
// tests/db/transport-queries.test.ts; fixture helpers mirror
// tests/db/visitors-rls.test.ts (0090).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { visitorsListQuery } from "@/modules/visitors/query-defs";
import { visitorsGatePasses, visitorsList, visitorsPickupList } from "@/modules/visitors/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function fixtureStaffId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function fixtureGuardianId(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.guardian_id as string;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardianToStudent(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

async function createPickupPerson(institutionId: string, studentId: string, createdBy: string, overrides: Partial<{ fullName: string; relation: string; phone: string }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.pickup_persons (institution_id, student_id, full_name, relation, phone, created_by)
    values (${institutionId}, ${studentId}, ${overrides.fullName ?? "Driver Raju"}, ${overrides.relation ?? "driver"}, ${overrides.phone ?? "9800000001"}, ${createdBy})
    returning id
  `;
  return row.id as string;
}

async function createGatePass(institutionId: string, studentId: string, pickupPersonId: string, requestedBy: string, reason: string): Promise<string> {
  const [row] = await sql`
    insert into public.gate_passes (institution_id, student_id, reason, pickup_person_id, requested_by)
    values (${institutionId}, ${studentId}, ${reason}, ${pickupPersonId}, ${requestedBy})
    returning id
  `;
  return row.id as string;
}

describe("visitors queries (X07-T8)", () => {
  it("list: date filter uses the institution's local day (IST), not the UTC calendar date", async () => {
    const inst = await createTestInstitution("vis-q-list-date");
    try {
      // 23:30 IST on the 26th -> 18:00 UTC same date; stays on the 26th.
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Visitor Late26', '9800000021', 'Enquiry', 'Office', ${inst.users.admin.id}, '2026-10-26T23:30:00+05:30')
      `;
      // 00:15 IST on the 27th -> 18:45 UTC on the 26th; belongs to the 27th, not the 26th.
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Visitor Early27', '9800000022', 'Enquiry', 'Office', ${inst.users.admin.id}, '2026-10-27T00:15:00+05:30')
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const day26 = await visitorsList(ctx, { date: "2026-10-26" });
        expect(day26.map((v) => v.fullName)).toEqual(["Visitor Late26"]);

        const day27 = await visitorsList(ctx, { date: "2026-10-27" });
        expect(day27.map((v) => v.fullName)).toEqual(["Visitor Early27"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("list: onSite excludes checked-out visitors", async () => {
    const inst = await createTestInstitution("vis-q-list-onsite");
    try {
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Still Here', '9800000023', 'Enquiry', 'Office', ${inst.users.admin.id}, now())
      `;
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at, checked_out_at, checked_out_by)
        values (${inst.institutionId}, 'Already Left', '9800000024', 'Enquiry', 'Office', ${inst.users.admin.id}, now(), now(), ${inst.users.admin.id})
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const onSite = await visitorsList(ctx, { onSite: true });
        expect(onSite.map((v) => v.fullName)).toEqual(["Still Here"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("list: meetingWith is the host staff's full name when present, else the raw meeting_with text", async () => {
    const inst = await createTestInstitution("vis-q-list-meetingwith");
    try {
      const adminStaffId = await fixtureStaffId(inst.institutionId, "admin");
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, host_staff_id, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Hosted Visitor', '9800000025', 'Meeting', ${adminStaffId}, ${inst.users.admin.id}, now())
      `;
      await sql`
        insert into public.visitor_entries (institution_id, full_name, phone, purpose, meeting_with, checked_in_by, checked_in_at)
        values (${inst.institutionId}, 'Dept Visitor', '9800000026', 'Payment', 'Accounts', ${inst.users.admin.id}, now())
      `;

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const rows = await visitorsList(ctx, {});
        expect(rows.find((r) => r.fullName === "Hosted Visitor")?.meetingWith).toBe("Test admin");
        expect(rows.find((r) => r.fullName === "Dept Visitor")?.meetingWith).toBe("Accounts");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("list: a teacher is forbidden (visitor.manage required at the query gate)", async () => {
    const inst = await createTestInstitution("vis-q-list-forbidden");
    try {
      const result = await callAs(inst, "teacher", visitorsListQuery, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("gatePasses: a class teacher sees only their own section's students, with class computed from the active enrolment", async () => {
    const inst = await createTestInstitution("vis-q-gatepass-teacher");
    try {
      const teacherStaffId = await fixtureStaffId(inst.institutionId, "teacher");
      const [otherStaff] = await sql`
        insert into public.staff (institution_id, employee_no, full_name, designation)
        values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
        returning id
      `;

      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId); // code "VI" by default
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaffId }); // name "A" by default
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherStaff.id as string });

      const studentA = await createStudent(inst.institutionId, "ADM-GP-A");
      const studentB = await createStudent(inst.institutionId, "ADM-GP-B");
      await createEnrolment(inst.institutionId, studentA, sectionA, yearId);
      await createEnrolment(inst.institutionId, studentB, sectionB, yearId);

      const pickupA = await createPickupPerson(inst.institutionId, studentA, inst.users.admin.id);
      const pickupB = await createPickupPerson(inst.institutionId, studentB, inst.users.admin.id);
      await createGatePass(inst.institutionId, studentA, pickupA, inst.users.admin.id, "Dentist A");
      await createGatePass(inst.institutionId, studentB, pickupB, inst.users.admin.id, "Dentist B");

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const rows = await visitorsGatePasses(ctx, {});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ studentId: studentA, studentName: "Test", class: "VI-A", reason: "Dentist A" });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("pickupList: a guardian sees her own child's linked guardians (primary first) and pickup persons, phones masked", async () => {
    const inst = await createTestInstitution("vis-q-pickup-own");
    try {
      const gId = await fixtureGuardianId(inst.institutionId, "guardian");
      const child = await createStudent(inst.institutionId, "ADM-PICK-OWN");
      await linkGuardianToStudent(inst.institutionId, gId, child);
      await createPickupPerson(inst.institutionId, child, inst.users.admin.id, { phone: "9800000027" });
      // createTestInstitution never runs the invitation-accept flow (0079) that
      // backfills guardians.user_id -> set it here so guardians_select's own-row
      // branch (0020) applies, same as a real guardian who has claimed their account.
      await sql`update public.guardians set user_id = ${inst.users.guardian.id} where id = ${gId}`;

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await visitorsPickupList(ctx, child);
        expect(rows).toEqual([
          { kind: "guardian", id: gId, fullName: "Test Guardian guardian", relation: "father", phoneMasked: expect.stringMatching(/^\*{6}\d{4}$/) },
          { kind: "pickup", id: expect.any(String), fullName: "Driver Raju", relation: "driver", phoneMasked: "******0027" },
        ]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("pickupList: another family's child -> empty (RLS hides both the guardian link and the pickup persons)", async () => {
    const inst = await createTestInstitution("vis-q-pickup-other");
    try {
      const otherChild = await createStudent(inst.institutionId, "ADM-PICK-OTHER");
      await createPickupPerson(inst.institutionId, otherChild, inst.users.admin.id, { fullName: "Someone", relation: "other", phone: "9800000028" });
      // No guardian_students link for this guardian -> both RLS branches empty.

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await visitorsPickupList(ctx, otherChild);
        expect(rows).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
