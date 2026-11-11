import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  assignHouse,
  awardHousePoints,
  cancelClubEvent,
  cancelClubEventSignup,
  createClub,
  createClubEvent,
  createHouse,
  joinClub,
  leaveClub,
  signUpClubEvent,
  unassignHouse,
  updateClub,
} from "@/modules/clubs/actions";
import { clubsList, housesLeaderboard, myClubState } from "@/modules/clubs/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
let childId: string; // guardian's child in A (also the student-role user's own student is `selfId`)
let otherId: string; // a student the guardian is NOT linked to
let selfId: string;

async function mk<T>(r: { ok: boolean; data?: T; error?: { code: string; message: string } }): Promise<T> {
  if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
  return r.data as T;
}
/** Runs a plain query function with real RLS as `role`. */
async function as<T>(inst: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0], fn: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>): Promise<T> {
  const ctx = await buildContext(inst, role);
  setActingClient(inst.clientAs(role) as never);
  try {
    return await fn(ctx);
  } finally {
    setActingClient(null);
  }
}
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  a = await createTestInstitution("clubs-a");
  b = await createTestInstitution("clubs-b");
  const [g] = await sql`select guardian_id from public.memberships where institution_id = ${a.institutionId} and role = 'guardian'`;
  const [s] = await sql`select student_id from public.memberships where institution_id = ${a.institutionId} and role = 'student'`;
  selfId = s.student_id;
  const mkStudent = async (label: string) =>
    (await sql`insert into public.students (institution_id, admission_no, first_name, dob, gender)
      values (${a.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other') returning id`)[0].id as string;
  childId = await mkStudent("Child");
  otherId = await mkStudent("Other");
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${a.institutionId}, ${g.guardian_id}, ${childId}, 'mother', true, true)`;
});

afterAll(async () => {
  await a.cleanup();
  await b.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("clubs & houses (0115)", () => {
  it("admin creates, edits (insert then update by id) and the teacher is refused", async () => {
    const { id } = await mk(await callAs(a, "admin", createClub, { name: "Chess", capacity: 5 }));
    const upd = await callAs(a, "admin", updateClub, { id, description: "Boards", capacity: null, isActive: true });
    expect(upd.ok).toBe(true);
    const [row] = await sql`select description, capacity from public.clubs where id = ${id}`;
    expect(row.description).toBe("Boards");
    expect(row.capacity).toBeNull();

    const denied = await callAs(a, "teacher", createClub, { name: "Nope" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    const dup = await callAs(a, "admin", createClub, { name: "Chess" });
    expect(!dup.ok && dup.error.code).toBe("conflict");
  });

  it("cross-tenant: another school's admin cannot edit, nor can its users join, this club", async () => {
    const { id } = await mk(await callAs(a, "admin", createClub, { name: "Cross" }));
    const upd = await callAs(b, "admin", updateClub, { id, name: "Hijack" });
    expect(!upd.ok && upd.error.code).toBe("not_found");
    const join = await callAs(b, "guardian", joinClub, { clubId: id, studentId: childId });
    expect(join.ok).toBe(false);
    const evt = await callAs(b, "admin", createClubEvent, { clubId: id, title: "x", startsAt: future(48) });
    expect(!evt.ok && evt.error.code).toBe("not_found");
  });

  it("join/leave: guardian for own child; not for another student; duplicate and full are refused", async () => {
    const { id } = await mk(await callAs(a, "admin", createClub, { name: "Tiny", capacity: 1 }));
    expect((await callAs(a, "guardian", joinClub, { clubId: id, studentId: childId })).ok).toBe(true);
    const dup = await callAs(a, "guardian", joinClub, { clubId: id, studentId: childId });
    expect(!dup.ok && dup.error.code).toBe("conflict");
    const stranger = await callAs(a, "guardian", joinClub, { clubId: id, studentId: otherId });
    expect(!stranger.ok && stranger.error.code).toBe("forbidden");
    const full = await callAs(a, "student", joinClub, { clubId: id, studentId: selfId });
    expect(!full.ok && full.error.code).toBe("conflict");

    expect((await as(a, "guardian", (c) => myClubState(c, childId))).clubIds).toContain(id);
    expect((await callAs(a, "guardian", leaveClub, { clubId: id, studentId: childId })).ok).toBe(true);
    const again = await callAs(a, "guardian", leaveClub, { clubId: id, studentId: childId });
    expect(!again.ok && again.error.code).toBe("not_found");
  });

  it("event sign-up: window and start rules, cancel only before start", async () => {
    const { id: clubId } = await mk(await callAs(a, "admin", createClub, { name: "Events" }));
    const open = await mk(await callAs(a, "admin", createClubEvent, { clubId, title: "Open", startsAt: future(48) }));
    expect((await callAs(a, "guardian", signUpClubEvent, { eventId: open.id, studentId: childId })).ok).toBe(true);
    const dup = await callAs(a, "guardian", signUpClubEvent, { eventId: open.id, studentId: childId });
    expect(!dup.ok && dup.error.code).toBe("conflict");
    expect((await callAs(a, "guardian", cancelClubEventSignup, { eventId: open.id, studentId: childId })).ok).toBe(true);

    const full = await mk(await callAs(a, "admin", createClubEvent, { clubId, title: "One seat", startsAt: future(48), capacity: 1 }));
    await mk(await callAs(a, "student", signUpClubEvent, { eventId: full.id, studentId: selfId }));
    const over = await callAs(a, "guardian", signUpClubEvent, { eventId: full.id, studentId: childId });
    expect(!over.ok && over.error.code).toBe("conflict");

    const cancelled = await mk(await callAs(a, "admin", createClubEvent, { clubId, title: "Off", startsAt: future(72) }));
    await mk(await callAs(a, "admin", cancelClubEvent, { id: cancelled.id }));
    const onCancelled = await callAs(a, "guardian", signUpClubEvent, { eventId: cancelled.id, studentId: childId });
    expect(!onCancelled.ok && onCancelled.error.code).toBe("invalid_state");

    // Started event (inserted as postgres to bypass nothing: starts_at only needs to be in the past).
    const [past] = await sql`insert into public.club_events (institution_id, club_id, title, starts_at)
      values (${a.institutionId}, ${clubId}, 'Past', now() - interval '1 hour') returning id`;
    const late = await callAs(a, "guardian", signUpClubEvent, { eventId: past.id, studentId: childId });
    expect(!late.ok && late.error.code).toBe("invalid_state");
  });

  it("houses: assign inserts then moves; points need a member; guardian cannot award; totals sum", async () => {
    const red = await mk(await callAs(a, "admin", createHouse, { name: "Red", colour: "#DC2626" }));
    const blue = await mk(await callAs(a, "admin", createHouse, { name: "Blue" }));
    await mk(await callAs(a, "admin", assignHouse, { houseId: red.id, studentId: childId }));
    await mk(await callAs(a, "admin", assignHouse, { houseId: blue.id, studentId: childId })); // move
    const [hm] = await sql`select count(*)::int as n, max(house_id::text) as h from public.house_members where student_id = ${childId}`;
    expect(hm.n).toBe(1);
    expect(hm.h).toBe(blue.id);

    const wrong = await callAs(a, "admin", awardHousePoints, { houseId: red.id, points: 5, reason: "x", studentId: childId });
    expect(!wrong.ok && wrong.error.code).toBe("validation_failed");
    expect((await callAs(a, "principal", awardHousePoints, { houseId: blue.id, points: 7, reason: "Quiz", studentId: childId })).ok).toBe(true);
    expect((await callAs(a, "admin", awardHousePoints, { houseId: blue.id, points: -2, reason: "Late" })).ok).toBe(true);
    const denied = await callAs(a, "guardian", awardHousePoints, { houseId: blue.id, points: 5, reason: "x" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");

    const board = await as(a, "admin", housesLeaderboard);
    expect(board.find((h) => h.id === blue.id)?.points).toBe(5);
    expect(board[0]!.id).toBe(blue.id);

    // Guardian sees own child's house and, since house_points is readable by every member, the real house total.
    expect((await as(a, "guardian", (c) => myClubState(c, childId))).house?.name).toBe("Blue");
    const gboard = await as(a, "guardian", housesLeaderboard);
    expect(gboard.find((h) => h.id === blue.id)?.points).toBe(5);

    expect((await callAs(a, "admin", unassignHouse, { studentId: childId })).ok).toBe(true);
    const gone = await callAs(a, "admin", unassignHouse, { studentId: childId });
    expect(!gone.ok && gone.error.code).toBe("not_found");
  });

  it("RLS: no direct client writes to membership/points; house_points is append-only; guardian reads only own rows", async () => {
    const { id } = await mk(await callAs(a, "admin", createClub, { name: "Rls" }));
    await mk(await callAs(a, "student", joinClub, { clubId: id, studentId: selfId }));
    const direct = await a.clientAs("guardian").from("club_members").insert({ institution_id: a.institutionId, club_id: id, student_id: childId, joined_by: a.users.guardian.id });
    expect(direct.error).not.toBeNull();
    // guardian cannot see the student's membership
    const seen = await a.clientAs("guardian").from("club_members").select("student_id").eq("club_id", id);
    expect(seen.data ?? []).toHaveLength(0);
    // teacher cannot read via clubs list? clubs are readable to all members
    expect((await as(a, "teacher", clubsList)).some((c) => c.id === id)).toBe(true);

    const [pt] = await sql`select id from public.house_points limit 1`;
    if (pt) await expect(sql`update public.house_points set points = 1 where id = ${pt.id}`).rejects.toThrow();
  });
});
