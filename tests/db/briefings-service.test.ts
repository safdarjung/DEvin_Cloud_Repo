// M25-T4 — src/modules/insights/briefings.ts (role mapping, source fan-out,
// write-once-per-day), called directly (buildContext + setActingClient
// pattern, mirrors tests/db/library-queries.test.ts) against a fixture
// institution with every module on and no insight/dashboard data planted
// (items may be empty/zeroed — only the service's own behavior is under
// test here; item text content is T2's unit coverage).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import {
  briefRoleFor,
  buildBriefing,
  ensureBriefing,
  readBriefing,
  setBriefingHeadline,
} from "@/modules/insights/briefings";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

afterEach(() => {
  setActingClient(null);
  vi.restoreAllMocks();
});

/** A second real teacher (own staff row, own user, own session) in the
 * same institution — proves "role-uniform sources" (rulings): two
 * different teachers of the brief role get identical items/sources. */
async function createSecondTeacher(inst: TestInstitution): Promise<{ client: SupabaseClient; cleanup: () => Promise<void> }> {
  const password = "correct-horse-battery-staple-b";
  const email = `test-teacher-b-${crypto.randomUUID()}@test.coolskool.test`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("failed to create second teacher");
  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Teacher B', 'teacher')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${inst.institutionId}, ${data.user.id}, 'teacher', ${staff.id})
  `;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, cleanup: async () => void (await admin.auth.admin.deleteUser(data.user.id)) };
}

function hasNoFixtureLeakage(texts: string[]): boolean {
  return texts.every((t) => !UUID_RE.test(t) && !t.includes("Test "));
}

describe("M25-T4 briefRoleFor", () => {
  it("maps owner/principal to principal, admin/accountant/admissions/teacher to themselves, exam_controller/guardian/student to none", async () => {
    const inst = await createTestInstitution("brief-role-map");
    try {
      const roleOf = async (r: Parameters<typeof buildContext>[1]) => briefRoleFor(await buildContext(inst, r));
      expect(await roleOf("owner")).toBe("principal");
      expect(await roleOf("principal")).toBe("principal");
      expect(await roleOf("admin")).toBe("admin");
      expect(await roleOf("accountant")).toBe("accountant");
      expect(await roleOf("admissions")).toBe("admissions");
      expect(await roleOf("teacher")).toBe("teacher");
      expect(await roleOf("exam_controller")).toBeNull();
      expect(await roleOf("guardian")).toBeNull();
      expect(await roleOf("student")).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M25-T4 buildBriefing / ensureBriefing", () => {
  it("principal: role 'principal', provider null, >=3 registered sources, no fixture name or UUID in items", async () => {
    const inst = await createTestInstitution("brief-principal");
    try {
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));

      const built = await buildBriefing(ctx);
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("unreachable");
      expect(built.data.role).toBe("principal");
      expect(built.data.sources.length).toBeGreaterThanOrEqual(3);
      const registry = getRegisteredQueries();
      for (const s of built.data.sources) expect(registry.has(s.query)).toBe(true);
      expect(hasNoFixtureLeakage(built.data.items.map((i) => i.text))).toBe(true);

      const ensured = await ensureBriefing(ctx);
      expect(ensured.ok).toBe(true);
      if (!ensured.ok) throw new Error("unreachable");
      expect(ensured.data.created).toBe(true);
      expect(ensured.data.provider).toBeNull();

      const [row] = await sql`select role, provider from public.briefings where id = ${ensured.data.id}::uuid`;
      expect(row.role).toBe("principal");
      expect(row.provider).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("second ensureBriefing call: same id, created false; owner gets the same row; admin gets a separate row", async () => {
    const inst = await createTestInstitution("brief-same-row");
    try {
      const ctxPrincipal = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const first = await ensureBriefing(ctxPrincipal);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");

      const second = await ensureBriefing(ctxPrincipal);
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("unreachable");
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.created).toBe(false);
      setActingClient(null);

      const ctxOwner = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const asOwner = await ensureBriefing(ctxOwner);
      expect(asOwner.ok).toBe(true);
      if (!asOwner.ok) throw new Error("unreachable");
      expect(asOwner.data.id).toBe(first.data.id);
      setActingClient(null);

      const ctxAdmin = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const asAdmin = await ensureBriefing(ctxAdmin);
      expect(asAdmin.ok).toBe(true);
      if (!asAdmin.ok) throw new Error("unreachable");
      expect(asAdmin.data.id).not.toBe(first.data.id);
      expect(asAdmin.data.brief.role).toBe("admin");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher A then teacher B of another section: B's ensureBriefing reads A's row; buildBriefing as B is item/source-identical to A (role-uniform sources)", async () => {
    const inst = await createTestInstitution("brief-teacher-uniform");
    const teacherB = await createSecondTeacher(inst);
    try {
      const ctxTeacher = await buildContext(inst, "teacher");

      setActingClient(inst.clientAs("teacher"));
      const asA = await ensureBriefing(ctxTeacher);
      expect(asA.ok).toBe(true);
      if (!asA.ok) throw new Error("unreachable");
      const builtA = await buildBriefing(ctxTeacher);
      setActingClient(null);
      expect(builtA.ok).toBe(true);
      if (!builtA.ok) throw new Error("unreachable");

      // Same ctx object is deliberate: buildBriefing/ensureBriefing read only
      // institution/role/slug off it, never the user — the acting client set
      // below is what makes every internal source call run as teacher B.
      setActingClient(teacherB.client);
      const asB = await ensureBriefing(ctxTeacher);
      expect(asB.ok).toBe(true);
      if (!asB.ok) throw new Error("unreachable");
      expect(asB.data.id).toBe(asA.data.id);
      expect(asB.data.created).toBe(false);

      const builtB = await buildBriefing(ctxTeacher);
      setActingClient(null);
      expect(builtB.ok).toBe(true);
      if (!builtB.ok) throw new Error("unreachable");
      expect(builtB.data.items).toEqual(builtA.data.items);
      expect(builtB.data.sources).toEqual(builtA.data.sources);
    } finally {
      await teacherB.cleanup();
      await inst.cleanup();
    }
  });

  it("exam_controller: forbidden, no row", async () => {
    const inst = await createTestInstitution("brief-exam-controller");
    try {
      const ctx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller"));

      const built = await buildBriefing(ctx);
      expect(built.ok).toBe(false);
      if (built.ok) throw new Error("unreachable");
      expect(built.error.code).toBe("forbidden");

      const ensured = await ensureBriefing(ctx);
      expect(ensured.ok).toBe(false);
      if (ensured.ok) throw new Error("unreachable");
      expect(ensured.error.code).toBe("forbidden");

      const rows = await sql`select 1 from public.briefings where institution_id = ${inst.institutionId}::uuid`;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("insights module off: no insights.* source cited, row still persists", async () => {
    const inst = await createTestInstitution("brief-insights-off");
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,insights}', 'false'::jsonb)
        where id = ${inst.institutionId}::uuid
      `;
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));

      const built = await buildBriefing(ctx);
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("unreachable");
      expect(built.data.sources.some((s) => s.query.startsWith("insights."))).toBe(false);

      const ensured = await ensureBriefing(ctx);
      expect(ensured.ok).toBe(true);
      if (!ensured.ok) throw new Error("unreachable");
      const [row] = await sql`select id from public.briefings where id = ${ensured.data.id}::uuid`;
      expect(row.id).toBe(ensured.data.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("every source missing from the registry: dependency_failed, no row", async () => {
    const inst = await createTestInstitution("brief-no-sources");
    try {
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));

      const registry = getRegisteredQueries();
      vi.spyOn(registry as Map<string, unknown>, "get").mockReturnValue(undefined);

      const built = await buildBriefing(ctx);
      expect(built.ok).toBe(false);
      if (built.ok) throw new Error("unreachable");
      expect(built.error.code).toBe("dependency_failed");

      vi.restoreAllMocks();
      const rows = await sql`select 1 from public.briefings where institution_id = ${inst.institutionId}::uuid`;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("owner and principal ensureBriefing concurrently: exactly one row", async () => {
    const inst = await createTestInstitution("brief-concurrent");
    try {
      const ctxOwner = await buildContext(inst, "owner");
      const ctxPrincipal = await buildContext(inst, "principal");
      // Both roles map to the same brief role ("principal") and the same RLS
      // branch (owner/principal/admin), so sharing one acting client across
      // the concurrent pair is safe — it never crosses a role/visibility
      // boundary, unlike the teacher-uniformity test above.
      setActingClient(inst.clientAs("owner"));

      const [a, b] = await Promise.all([ensureBriefing(ctxOwner), ensureBriefing(ctxPrincipal)]);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) throw new Error("unreachable");
      expect(a.data.id).toBe(b.data.id);

      const rows = await sql`select count(*)::int as n from public.briefings where institution_id = ${inst.institutionId}::uuid and role = 'principal'`;
      expect(rows[0].n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("faked Monday: weekly sources present, headline ends ' · week in review'", async () => {
    vi.setSystemTime(new Date("2026-11-02T03:30:00Z"));
    const inst = await createTestInstitution("brief-monday");
    try {
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));

      const built = await buildBriefing(ctx);
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("unreachable");
      expect(built.data.sources.some((s) => s.query === "insights.riskIndicators")).toBe(true);
      expect(built.data.sources.some((s) => s.query === "dashboard.attendanceTrend" && s.params.days === 7)).toBe(true);
      expect(built.data.headline.endsWith(" · week in review")).toBe(true);
    } finally {
      vi.useRealTimers();
      await inst.cleanup();
    }
  });
});

describe("M25-T4 readBriefing / setBriefingHeadline", () => {
  it("readBriefing (caller's RLS) sees the row after ensureBriefing; null before", async () => {
    const inst = await createTestInstitution("brief-read");
    try {
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));

      expect(await readBriefing(ctx)).toBeNull();
      await ensureBriefing(ctx);
      const brief = await readBriefing(ctx);
      expect(brief).not.toBeNull();
      expect(brief?.role).toBe("principal");
      expect(brief?.generated_by).toBe("rules");
    } finally {
      await inst.cleanup();
    }
  });

  it("setBriefingHeadline: true then false (already narrated); row keeps the first headline", async () => {
    const inst = await createTestInstitution("brief-headline");
    try {
      const ctx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const ensured = await ensureBriefing(ctx);
      expect(ensured.ok).toBe(true);
      if (!ensured.ok) throw new Error("unreachable");

      const first = await setBriefingHeadline(ensured.data.id, "First narrated headline.", "local");
      expect(first).toBe(true);
      const second = await setBriefingHeadline(ensured.data.id, "Second narrated headline.", "cloud");
      expect(second).toBe(false);

      const [row] = await sql`select headline, provider from public.briefings where id = ${ensured.data.id}::uuid`;
      expect(row.headline).toBe("First narrated headline.");
      expect(row.provider).toBe("local");
    } finally {
      await inst.cleanup();
    }
  });
});
