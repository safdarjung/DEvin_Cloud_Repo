// Practice scenarios (src/modules/core/practice): demo school only, written through the owning modules' own actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
// The scenario calls other actions with the slug only, so they resolve context themselves: hand them the same one.
let current: TenantContext | null = null;
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: async () => {
    if (!current) throw new Error("no context set");
    return current;
  },
}));

import { runPracticeScenario } from "@/modules/core/practice/actions";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });
let inst: TestInstitution;

async function runAs(role: FixtureRole, scenario: string, isDemo = true) {
  const ctx = await buildContext(inst, role);
  current = { ...ctx, institution: { ...ctx.institution, is_demo: isDemo } };
  setActingClient(inst.clientAs(role) as unknown as SupabaseClient<Database>);
  try {
    return await runPracticeScenario(inst.slug, { scenario });
  } finally {
    setActingClient(null);
    current = null;
  }
}

beforeAll(async () => {
  inst = await createTestInstitution("practice");
});

afterAll(async () => {
  await inst.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("practice scenarios", () => {
  it("are refused in a real (non-demo) school and write nothing", async () => {
    const res = await runAs("admin", "visitors.rush", false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid_state");
    const [{ n }] = await sql`select count(*)::int as n from public.visitor_entries where institution_id = ${inst.institutionId}`;
    expect(n).toBe(0);
  });

  it("admin in the demo school checks in 3 visitors through the visitors action", async () => {
    const res = await runAs("admin", "visitors.rush");
    expect(res.ok).toBe(true);
    const [{ n }] = await sql`select count(*)::int as n from public.visitor_entries where institution_id = ${inst.institutionId}`;
    expect(n).toBe(3);
  });

  it("a role without the scenario's permission is refused", async () => {
    const res = await runAs("guardian", "visitors.rush");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("forbidden");
  });
});
