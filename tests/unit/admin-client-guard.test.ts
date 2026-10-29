import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createAdminClient guard (T7 — service-role allow-list)", () => {
  it("throws when SERVICE_ROLE_CALLER is unset", async () => {
    delete process.env.SERVICE_ROLE_CALLER;
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/SERVICE_ROLE_CALLER/);
  });

  it("throws when SERVICE_ROLE_CALLER is not in the allow-list", async () => {
    process.env.SERVICE_ROLE_CALLER = "hacker";
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/SERVICE_ROLE_CALLER/);
  });

  it("does not throw for an allow-listed caller with Supabase env configured", async () => {
    process.env.SERVICE_ROLE_CALLER = "test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).not.toThrow();
  });

  it("AI gateway's service-role scope does not leave the guard unlocked afterwards", async () => {
    delete process.env.SERVICE_ROLE_CALLER;
    const { withAiServiceRole } = await import("@/lib/ai/usage");
    expect(withAiServiceRole(() => process.env.SERVICE_ROLE_CALLER)).toBe("ai");
    expect(process.env.SERVICE_ROLE_CALLER).toBeUndefined();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/SERVICE_ROLE_CALLER/);
  });
});
