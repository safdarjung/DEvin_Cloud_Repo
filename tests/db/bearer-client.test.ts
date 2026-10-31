import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// M01-T2: withBearerToken must never fall back to cookies(), so mirror the
// csrf.test.ts pattern with an empty cookie jar — outside the bearer scope,
// createClient()/getClaims() must behave exactly as the cookie-based path,
// which here means no session cookie -> getClaims() returns null.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import { createClient, getClaims, withBearerToken } from "@/lib/supabase/server";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

let inst: TestInstitution;

beforeAll(async () => {
  inst = await createTestInstitution("bearer-client");
}, 60_000);

afterAll(async () => {
  await inst.cleanup();
  await closeRolesHelper();
}, 60_000);

async function tokenFor(role: "teacher" | "student"): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

describe("M01-T2: withBearerToken", () => {
  it("getClaims inside withBearerToken returns the token's user", async () => {
    const token = await tokenFor("teacher");

    const claims = await withBearerToken(token, () => getClaims());

    expect(claims?.sub).toBe(inst.users.teacher.id);
  });

  it("garbage token -> getClaims null", async () => {
    const claims = await withBearerToken("not-a-jwt", () => getClaims());

    expect(claims).toBeNull();
  });

  it("createClient under a teacher token reads memberships as that teacher only (RLS)", async () => {
    const token = await tokenFor("teacher");

    const rows = await withBearerToken(token, async () => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("institution_id", inst.institutionId);
      if (error) throw error;
      return data;
    });

    expect(rows).not.toBeNull();
    expect(rows!.every((row) => row.user_id === inst.users.teacher.id)).toBe(true);
    expect(rows!.length).toBeGreaterThan(0);
  });

  it("scope does not leak after fn resolves", async () => {
    const token = await tokenFor("student");

    await withBearerToken(token, () => getClaims());

    // Outside the scope, no bearer token and (via the mock above) no cookie
    // session either -> getClaims() must be null, not the student's claims.
    const claims = await getClaims();

    expect(claims).toBeNull();
  });
});
