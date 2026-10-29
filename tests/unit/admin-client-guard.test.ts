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

  // T-024: the public enquiry route's scoped helper, same shape as
  // withJobsServiceRole/withAiServiceRole above — must relock after use,
  // and restore (not clear) a pre-existing value rather than deleting it.
  it("withPublicEnquiryServiceRole sets 'public_enquiry' only for the call, then relocks", async () => {
    delete process.env.SERVICE_ROLE_CALLER;
    const { withPublicEnquiryServiceRole } = await import("@/modules/website/with-service-role");
    expect(withPublicEnquiryServiceRole(() => process.env.SERVICE_ROLE_CALLER)).toBe("public_enquiry");
    expect(process.env.SERVICE_ROLE_CALLER).toBeUndefined();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/SERVICE_ROLE_CALLER/);
  });

  it("withPublicEnquiryServiceRole restores a pre-existing SERVICE_ROLE_CALLER instead of deleting it", async () => {
    process.env.SERVICE_ROLE_CALLER = "jobs";
    const { withPublicEnquiryServiceRole } = await import("@/modules/website/with-service-role");
    expect(withPublicEnquiryServiceRole(() => process.env.SERVICE_ROLE_CALLER)).toBe("public_enquiry");
    expect(process.env.SERVICE_ROLE_CALLER).toBe("jobs");
  });
});
