import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// DBT-29 (T-042): the auth cookies the login action sets through
// src/lib/supabase/server.ts must stay SameSite=Lax (not None), so a
// cross-site POST never carries the session. The Origin check on cost-bearing
// routes is unit-tested in tests/unit/request-guards.test.ts.
const jar: { name: string; value: string; options?: Record<string, unknown> }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => jar.map(({ name, value }) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.push({ name, value, options });
    },
  }),
}));

import { createClient } from "@/lib/supabase/server";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

let inst: TestInstitution;

beforeAll(async () => {
  inst = await createTestInstitution("csrf");
}, 60_000);

afterAll(async () => {
  await inst.cleanup();
  await closeRolesHelper();
}, 60_000);

describe("DBT-29: session cookies", () => {
  it("signing in via the server client sets only SameSite=Lax cookies", async () => {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: inst.users.teacher.email,
      password: "correct-horse-battery-staple",
    });
    expect(error).toBeNull();

    const authCookies = jar.filter((c) => c.value !== "");
    expect(authCookies.length).toBeGreaterThan(0);
    for (const cookie of authCookies) {
      expect(String(cookie.options?.sameSite).toLowerCase()).toBe("lax");
    }
  });
});
