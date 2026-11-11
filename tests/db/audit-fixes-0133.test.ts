import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let inst: TestInstitution;

const salary = (amount: number) => [{ name: "Basic", kind: "earning", amount_paise: amount }];

async function student(): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Fix', '2014-01-01', 'other')
    returning id`;
  return row.id as string;
}

async function staffIdOf(role: "accountant" | "teacher"): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = ${role}`;
  return row.staff_id as string;
}

beforeAll(async () => {
  inst = await createTestInstitution("audit-fixes-0133");
});

afterAll(async () => {
  await inst.cleanup();
  await sql.end();
  await closeRolesHelper();
});

describe("audit fixes (0133)", () => {
  it("accountant cannot create or change their own salary structure; a change to someone else's is audited", async () => {
    const own = await staffIdOf("accountant");
    const accountant = inst.clientAs("accountant");

    const ins = await accountant
      .from("salary_structures")
      .insert({ institution_id: inst.institutionId, staff_id: own, components: salary(5_000_000), created_by: inst.users.accountant.id });
    expect(ins.error?.message).toMatch(/code:forbidden/);

    const [row] = await sql`
      insert into public.salary_structures (institution_id, staff_id, components, created_by)
      values (${inst.institutionId}, ${own}, ${sql.json(salary(4_000_000))}, ${inst.users.owner.id}) returning id`;
    const upd = await accountant.from("salary_structures").update({ components: salary(9_000_000) }).eq("id", row.id);
    expect(upd.error?.message).toMatch(/code:forbidden/);
    const [after] = await sql`select gross_paise from public.salary_structures where id = ${row.id}`;
    expect(Number(after.gross_paise)).toBe(4_000_000);

    // Owner (not the payee) may change it; the trigger audits ids and gross only.
    const byOwner = await inst.clientAs("owner").from("salary_structures").update({ components: salary(4_500_000) }).eq("id", row.id);
    expect(byOwner.error).toBeNull();
    const [ev] = await sql`
      select actor_user_id, before, after, metadata from public.audit_events
      where action = 'payroll.salary_structure.changed' and entity_id = ${row.id} and actor_user_id is not null`;
    expect(ev.actor_user_id).toBe(inst.users.owner.id);
    expect(ev.before).toEqual({ gross_paise: 4_000_000 });
    expect(ev.after).toEqual({ gross_paise: 4_500_000 });
    expect(ev.metadata).toEqual({ staff_id: own });

    // Accountant may still manage another staff member's structure.
    const teacherStaff = await staffIdOf("teacher");
    const other = await accountant
      .from("salary_structures")
      .insert({ institution_id: inst.institutionId, staff_id: teacherStaff, components: salary(3_000_000), created_by: inst.users.accountant.id });
    expect(other.error).toBeNull();
  });

  it("accountant cannot pay themselves through a second staff row that carries their login", async () => {
    // Arrange: a staff row linked to the accountant by staff.user_id only, not by their membership.
    const [alias] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation, user_id)
      values (${inst.institutionId}, ${`E-${crypto.randomUUID().slice(0, 8)}`}, 'Alias', 'Clerk', ${inst.users.accountant.id})
      returning id`;

    // Act
    const res = await inst
      .clientAs("accountant")
      .from("salary_structures")
      .insert({ institution_id: inst.institutionId, staff_id: alias.id, components: salary(5_000_000), created_by: inst.users.accountant.id });

    // Assert
    expect(res.error?.message).toContain("code:forbidden");
  });

  it("guardian cannot read another child's house_points row; standings still show the full house total", async () => {
    const [g] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
    const child = await student();
    const stranger = await student();
    await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
      values (${inst.institutionId}, ${g.guardian_id}, ${child}, 'mother', true, true)`;
    const [house] = await sql`insert into public.houses (institution_id, name) values (${inst.institutionId}, 'Green') returning id`;
    const award = (studentId: string | null, points: number) => sql`
      insert into public.house_points (institution_id, house_id, student_id, points, reason, awarded_by)
      values (${inst.institutionId}, ${house.id}, ${studentId}, ${points}, 'Test', ${inst.users.admin.id})`;
    await award(child, 5);
    await award(stranger, 7);
    await award(null, 3);

    const seen = await inst.clientAs("guardian").from("house_points").select("student_id, points").eq("house_id", house.id);
    expect(seen.error).toBeNull();
    expect((seen.data ?? []).map((r) => r.student_id).sort()).toEqual([child, null].sort());

    const teacher = await inst.clientAs("teacher").from("house_points").select("id").eq("house_id", house.id);
    expect(teacher.data).toHaveLength(3);

    const standings = await inst.clientAs("guardian").rpc("house_standings", { p_institution_id: inst.institutionId });
    expect(standings.error).toBeNull();
    const rows = (standings.data ?? []) as { house_id: string; points: number }[];
    expect(rows.find((s) => s.house_id === house.id)?.points).toBe(15);
  });

  it("a second live award for the same student, year and rule is rejected; a rejected one does not block", async () => {
    const studentId = await student();
    const [year] = await sql`
      insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
      values (${inst.institutionId}, '2026-27', '2026-04-01', '2027-03-31', true) returning id`;
    const [rule] = await sql`insert into public.concession_rules (institution_id, name, percent) values (${inst.institutionId}, 'Sibling', 10) returning id`;
    await sql`
      insert into public.concession_awards (institution_id, student_id, academic_year_id, rule_id, percent, reason, status, requested_by, decided_by, decided_at)
      values (${inst.institutionId}, ${studentId}, ${year.id}, ${rule.id}, 10, 'Earlier request', 'rejected', ${inst.users.accountant.id}, ${inst.users.owner.id}, now())`;

    const accountant = inst.clientAs("accountant");
    const row = {
      institution_id: inst.institutionId,
      student_id: studentId,
      academic_year_id: year.id,
      rule_id: rule.id,
      percent: 10,
      reason: "Sibling studies here",
      requested_by: inst.users.accountant.id,
    };
    expect((await accountant.from("concession_awards").insert(row)).error).toBeNull();
    const dup = await accountant.from("concession_awards").insert(row);
    expect(dup.error?.code).toBe("23505");
  });

  it("roll call RPC rejects a non-allocated student and is idempotent on re-save", async () => {
    const [room] = await sql`
      insert into public.hostel_rooms (institution_id, block, room_no, capacity)
      values (${inst.institutionId}, 'A', ${crypto.randomUUID().slice(0, 8)}, 4) returning id`;
    const resident = await student();
    const outsider = await student();
    const admin = inst.clientAs("admin");
    expect((await admin.rpc("allocate_hostel_room", { p_room_id: room.id, p_student_id: resident })).error).toBeNull();

    const save = (entries: { student_id: string; status: string; note?: string | null }[]) =>
      admin.rpc("save_hostel_roll_call", { p_institution_id: inst.institutionId, p_taken_on: "2026-11-10", p_session: "night", p_entries: entries });

    const bad = await save([
      { student_id: resident, status: "present" },
      { student_id: outsider, status: "absent" },
    ]);
    expect(bad.error?.message).toMatch(/code:validation_failed/);
    const [none] = await sql`select count(*)::int as n from public.hostel_roll_calls where institution_id = ${inst.institutionId}`;
    expect(none.n).toBe(0);

    const first = await save([{ student_id: resident, status: "absent" }]);
    expect(first.error).toBeNull();
    const second = await save([{ student_id: resident, status: "present", note: "Back by 9pm" }]);
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const entries = await sql`select status, note from public.hostel_roll_call_entries where roll_call_id = ${first.data as string}`;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "present", note: "Back by 9pm" });

    const teacher = await inst.clientAs("teacher").rpc("save_hostel_roll_call", {
      p_institution_id: inst.institutionId,
      p_taken_on: "2026-11-10",
      p_session: "night",
      p_entries: [{ student_id: resident, status: "present" }],
    });
    expect(teacher.error?.message).toMatch(/code:forbidden/);
  });

  it("health update stamps updated_by and audits changed column names only", async () => {
    const studentId = await student();
    const [visit] = await sql`
      insert into public.health_visits (institution_id, student_id, complaint, recorded_by)
      values (${inst.institutionId}, ${studentId}, 'Headache', ${inst.users.admin.id}) returning id`;
    const upd = await inst.clientAs("principal").from("health_visits").update({ treatment: "Rest and water" }).eq("id", visit.id);
    expect(upd.error).toBeNull();

    const [row] = await sql`select updated_by from public.health_visits where id = ${visit.id}`;
    expect(row.updated_by).toBe(inst.users.principal.id);
    const [ev] = await sql`select before, after, metadata from public.audit_events where action = 'health.record.updated' and entity_id = ${visit.id}`;
    expect(ev.metadata).toEqual({ student_id: studentId, changed: ["treatment"] });
    expect(ev.before).toBeNull();
    expect(ev.after).toBeNull();
  });
});
