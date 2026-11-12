import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { resetDashboardLayout, saveDashboardLayout } from "@/modules/core/dashboard-layout.actions";
import { revokeInvite, setMemberRole, setMemberStatus, upsertAcademicYear, upsertTerm } from "@/modules/core/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Curveballs: core.* year/term/member/dashboard-layout actions.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;

describe("academic year / term", () => {
  it("a failed upsert with isCurrent=true (foreign/unknown id) must not clear the school's current year", async () => {
    const inst = await createTestInstitution("cb-core-year");
    try {
      const current = await createAcademicYear(inst.institutionId, { name: "2026-27", isCurrent: true });
      const r = await callAs(inst, "admin", upsertAcademicYear, { id: crypto.randomUUID(), name: "Ghost", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: true });
      expect(!r.ok && r.error.code).toBe("not_found");
      const row = await one(sql`select is_current from public.academic_years where id=${current}`);
      expect(row.is_current).toBe(true);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("a foreign school's year id with isCurrent=true must not unset this school's current year", async () => {
    const inst = await createTestInstitution("cb-core-year2");
    const other = await createTestInstitution("cb-core-year2x");
    try {
      const mine = await createAcademicYear(inst.institutionId, { isCurrent: true });
      const theirs = await createAcademicYear(other.institutionId, { isCurrent: true });
      const r = await callAs(inst, "admin", upsertAcademicYear, { id: theirs, name: "Hijack", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: true });
      expect(r.ok).toBe(false);
      expect((await one(sql`select is_current, name from public.academic_years where id=${theirs}`)).name).not.toBe("Hijack");
      expect((await one(sql`select is_current from public.academic_years where id=${mine}`)).is_current).toBe(true);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("year: end before start is refused and nothing is written; setting a new current year leaves exactly one current", async () => {
    const inst = await createTestInstitution("cb-core-year3");
    try {
      const bad = await callAs(inst, "admin", upsertAcademicYear, { name: "Backwards", startsOn: "2027-03-31", endsOn: "2026-04-01" });
      expect(bad.ok).toBe(false);
      expect((await sql`select 1 from public.academic_years where institution_id=${inst.institutionId}`).length).toBe(0);
      await createAcademicYear(inst.institutionId, { isCurrent: true });
      const next = await callAs(inst, "admin", upsertAcademicYear, { name: "2027-28", startsOn: "2027-04-01", endsOn: "2028-03-31", isCurrent: true });
      expect(next.ok).toBe(true);
      expect((await sql`select 1 from public.academic_years where institution_id=${inst.institutionId} and is_current`).length).toBe(1);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("year/term validation and roles: blank name, bad date, unknown key; teacher/guardian forbidden", async () => {
    const inst = await createTestInstitution("cb-core-year4");
    try {
      const y = await createAcademicYear(inst.institutionId);
      for (const body of [{ name: " " }, { startsOn: "2026-02-30x" }, { extra: 1 }]) {
        const r = await callAs(inst, "admin", upsertAcademicYear, { name: "Y", startsOn: "2026-04-01", endsOn: "2027-03-31", ...body } as never);
        expect(!r.ok && r.error.code).toBe("validation_failed");
        const t = await callAs(inst, "admin", upsertTerm, { academicYearId: y, name: "T", startsOn: "2026-04-01", endsOn: "2026-09-30", ...body } as never);
        expect(!t.ok && t.error.code).toBe("validation_failed");
      }
      for (const role of ["teacher", "guardian", "student", "accountant"] as const) {
        const r = await callAs(inst, role, upsertAcademicYear, { name: "Y", startsOn: "2026-04-01", endsOn: "2027-03-31" });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("term in another school's academic year, or ending before it starts, must be refused", async () => {
    const inst = await createTestInstitution("cb-core-term");
    const other = await createTestInstitution("cb-core-termx");
    try {
      const mine = await createAcademicYear(inst.institutionId);
      const theirs = await createAcademicYear(other.institutionId);
      const cross = await callAs(inst, "admin", upsertTerm, { academicYearId: theirs, name: "Leak", startsOn: "2026-04-01", endsOn: "2026-09-30" });
      expect(cross.ok).toBe(false);
      expect((await sql`select 1 from public.terms where academic_year_id=${theirs}`).length).toBe(0);
      const rev = await callAs(inst, "admin", upsertTerm, { academicYearId: mine, name: "Rev", startsOn: "2026-09-30", endsOn: "2026-04-01" });
      expect(rev.ok).toBe(false);
      const out = await callAs(inst, "admin", upsertTerm, { academicYearId: mine, name: "Outside", startsOn: "2030-01-01", endsOn: "2030-03-01" });
      expect(out.ok).toBe(false);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("term update with an unknown id is not_found; sequence increments per year", async () => {
    const inst = await createTestInstitution("cb-core-term2");
    try {
      const y = await createAcademicYear(inst.institutionId);
      const nf = await callAs(inst, "admin", upsertTerm, { id: crypto.randomUUID(), academicYearId: y, name: "T", startsOn: "2026-04-01", endsOn: "2026-09-30" });
      expect(!nf.ok && nf.error.code).toBe("not_found");
      await callAs(inst, "admin", upsertTerm, { academicYearId: y, name: "T1", startsOn: "2026-04-01", endsOn: "2026-09-30" });
      await callAs(inst, "admin", upsertTerm, { academicYearId: y, name: "T2", startsOn: "2026-10-01", endsOn: "2027-03-31" });
      expect((await sql`select sequence from public.terms where academic_year_id=${y} order by sequence`).map((r) => r.sequence)).toEqual([1, 2]);
    } finally { await inst.cleanup(); }
  }, 60_000);
});

describe("members", () => {
  it("setRole/setStatus: another school's membership and random ids are not_found; invalid role/status are validation_failed; owner cannot be demoted by admin", async () => {
    const inst = await createTestInstitution("cb-core-mem");
    const other = await createTestInstitution("cb-core-memx");
    try {
      const foreign = await one(sql`select id from public.memberships where institution_id=${other.institutionId} and role='teacher'`);
      const mine = await one(sql`select id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`);
      const owner = await one(sql`select id from public.memberships where institution_id=${inst.institutionId} and role='owner'`);
      const x = await callAs(inst, "admin", setMemberRole, { membershipId: foreign.id as string, role: "admin" });
      expect(!x.ok && x.error.code).toBe("not_found");
      const s = await callAs(inst, "admin", setMemberStatus, { membershipId: foreign.id as string, status: "disabled" });
      expect(!s.ok && s.error.code).toBe("not_found");
      expect((await one(sql`select role, status from public.memberships where id=${foreign.id}`))).toMatchObject({ role: "teacher" });
      const badRole = await callAs(inst, "admin", setMemberRole, { membershipId: mine.id as string, role: "superuser" } as never);
      expect(!badRole.ok && badRole.error.code).toBe("validation_failed");
      const badStatus = await callAs(inst, "admin", setMemberStatus, { membershipId: mine.id as string, status: "banned" } as never);
      expect(!badStatus.ok && badStatus.error.code).toBe("validation_failed");
      const demote = await callAs(inst, "admin", setMemberRole, { membershipId: owner.id as string, role: "teacher" });
      expect(demote.ok).toBe(false);
      const disableOwner = await callAs(inst, "admin", setMemberStatus, { membershipId: owner.id as string, status: "disabled" });
      expect(disableOwner.ok).toBe(false);
      expect((await one(sql`select role, status from public.memberships where id=${owner.id}`))).toMatchObject({ role: "owner", status: "active" });
      const rnd = await callAs(inst, "admin", setMemberRole, { membershipId: crypto.randomUUID(), role: "teacher" });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("revokeInvite: random id is not_found; other school's invitation is not revoked", async () => {
    const inst = await createTestInstitution("cb-core-inv");
    const other = await createTestInstitution("cb-core-invx");
    try {
      const rnd = await callAs(inst, "admin", revokeInvite, { invitationId: crypto.randomUUID() });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      const inv = await one(sql`insert into public.invitations (institution_id, email, role, token_hash, expires_at, invited_by)
        values (${other.institutionId}, 'x@test.coolskool.test', 'teacher', ${crypto.randomUUID()}, now() + interval '7 days', ${other.users.admin.id}) returning id`).catch(() => null);
      if (!inv) return;
      const cross = await callAs(inst, "admin", revokeInvite, { invitationId: inv.id as string });
      expect(cross.ok).toBe(false);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("dashboard layout", () => {
  it("save, overwrite, per-user isolation and reset twice", async () => {
    const inst = await createTestInstitution("cb-core-dash");
    try {
      const saved = await callAs(inst, "principal", saveDashboardLayout, { hidden: [], order: [] });
      expect(saved.ok).toBe(true);
      expect((await sql`select 1 from public.dashboard_preferences where institution_id=${inst.institutionId}`).length).toBe(1);
      const other = await callAs(inst, "admin", saveDashboardLayout, { hidden: [], order: [] });
      expect(other.ok).toBe(true);
      expect((await sql`select 1 from public.dashboard_preferences where institution_id=${inst.institutionId}`).length).toBe(2);
      expect((await callAs(inst, "principal", resetDashboardLayout, {})).ok).toBe(true);
      expect((await callAs(inst, "principal", resetDashboardLayout, {})).ok).toBe(true);
      expect((await sql`select user_id from public.dashboard_preferences where institution_id=${inst.institutionId}`).map((r) => r.user_id)).toEqual([inst.users.admin.id]);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("unknown widget ids, non-array, unknown key and reset-with-payload fail validation", async () => {
    const inst = await createTestInstitution("cb-core-dash2");
    try {
      for (const body of [{ hidden: ["nope"], order: [] }, { hidden: "x", order: [] }, { hidden: [], order: [], extra: 1 }, { hidden: [] }]) {
        const r = await callAs(inst, "principal", saveDashboardLayout, body as never);
        expect(!r.ok && r.error.code).toBe("validation_failed");
      }
      const reset = await callAs(inst, "principal", resetDashboardLayout, { x: 1 } as never);
      expect(!reset.ok && reset.error.code).toBe("validation_failed");
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("duplicate widget ids in one list are rejected (schema comment says at most one entry per widget)", async () => {
    const inst = await createTestInstitution("cb-core-dash3");
    try {
      const { DASHBOARD_WIDGET_IDS } = await import("@/modules/core/dashboard-widgets");
      const id = DASHBOARD_WIDGET_IDS[0]!;
      const r = await callAs(inst, "principal", saveDashboardLayout, { hidden: [id, id], order: [] });
      expect(r.ok).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);
});
