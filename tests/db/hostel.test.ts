import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function student(institutionId: string, status = "active"): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender, status)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Res', '2012-01-01', 'other', ${status})
    returning id`;
  return row.id as string;
}

async function room(institutionId: string, capacity: number): Promise<string> {
  const [row] = await sql`
    insert into public.hostel_rooms (institution_id, block, room_no, capacity)
    values (${institutionId}, 'A', ${crypto.randomUUID().slice(0, 8)}, ${capacity}) returning id`;
  return row.id as string;
}

describe("hostel (0116)", () => {
  it("allocates, refuses over-capacity, refuses a second active allocation, allows re-allocation after vacate", async () => {
    const inst = await createTestInstitution("hostel-alloc");
    try {
      const roomId = await room(inst.institutionId, 1);
      const other = await room(inst.institutionId, 2);
      const s1 = await student(inst.institutionId);
      const s2 = await student(inst.institutionId);
      const admin = inst.clientAs("admin");

      const ok = await admin.rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: s1 });
      expect(ok.error).toBeNull();

      const full = await admin.rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: s2 });
      expect(full.error?.message).toMatch(/code:conflict/);

      const twice = await admin.rpc("allocate_hostel_room", { p_room_id: other, p_student_id: s1 });
      expect(twice.error?.message).toMatch(/code:conflict/);

      const allocationId = (ok.data as { allocation_id: string }).allocation_id;
      const vac = await admin.rpc("vacate_hostel_allocation", { p_allocation_id: allocationId });
      expect(vac.error).toBeNull();
      const again = await admin.rpc("vacate_hostel_allocation", { p_allocation_id: allocationId });
      expect(again.error?.message).toMatch(/code:invalid_state/);

      const moved = await admin.rpc("allocate_hostel_room", { p_room_id: other, p_student_id: s1 });
      expect(moved.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("denies teacher, student and guardian: rpc refused, no rows, no room insert", async () => {
    const inst = await createTestInstitution("hostel-deny");
    try {
      const roomId = await room(inst.institutionId, 2);
      const s1 = await student(inst.institutionId);
      for (const role of ["teacher", "student", "guardian"] as const) {
        const c = inst.clientAs(role);
        const rpc = await c.rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: s1 });
        expect(rpc.error?.message, role).toMatch(/code:forbidden/);
        const read = await c.from("hostel_rooms").select("id");
        expect(read.data ?? [], role).toHaveLength(0);
        const ins = await c.from("hostel_rooms").insert({ institution_id: inst.institutionId, block: "Z", room_no: "9", capacity: 2 });
        expect(ins.error, role).not.toBeNull();
      }
      for (const role of ["owner", "principal", "admin"] as const) {
        const read = await inst.clientAs(role).from("hostel_rooms").select("id");
        expect(read.data, role).toHaveLength(1);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("guards room edits and enforces one roll call per date+session", async () => {
    const inst = await createTestInstitution("hostel-guard");
    try {
      const roomId = await room(inst.institutionId, 2);
      const s1 = await student(inst.institutionId);
      const admin = inst.clientAs("admin");
      expect((await admin.rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: s1 })).error).toBeNull();

      const deactivate = await admin.from("hostel_rooms").update({ is_active: false }).eq("id", roomId);
      expect(deactivate.error?.message).toMatch(/code:conflict/);

      const first = await admin.from("hostel_roll_calls").insert({ institution_id: inst.institutionId, taken_on: "2026-11-10", session: "night", taken_by: inst.users.admin.id }).select("id").single();
      expect(first.error).toBeNull();
      const dup = await admin.from("hostel_roll_calls").insert({ institution_id: inst.institutionId, taken_on: "2026-11-10", session: "night", taken_by: inst.users.admin.id });
      expect(dup.error?.code).toBe("23505");
      const entry = await admin.from("hostel_roll_call_entries").insert({ institution_id: inst.institutionId, roll_call_id: first.data!.id, student_id: s1, status: "absent" });
      expect(entry.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-tenant: other institution's admin cannot allocate or read", async () => {
    await withTwoInstitutions(async (a, b) => {
      const roomId = await room(a.institutionId, 2);
      const s1 = await student(a.institutionId);
      const rpc = await b.clientAs("admin").rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: s1 });
      expect(rpc.error?.message).toMatch(/code:not_found/);
      const read = await b.clientAs("admin").from("hostel_rooms").select("id");
      expect(read.data ?? []).toHaveLength(0);
    });
  });
});
