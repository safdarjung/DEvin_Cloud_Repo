import { describe, expect, it } from "vitest";
import { marketplaceCatalog } from "@/modules/fabric/marketplace.queries";
import type { TenantContext } from "@/lib/auth/types";

function fakeCtx(settings: Record<string, unknown>): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "test-school",
      name: "Test School",
      settings,
      ai_policy: "local_only",
      is_demo: false,
    },
    user: { id: "u-1", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "owner", staffId: null, guardianId: null, studentId: null },
    permissions: new Set(),
  };
}

describe("marketplaceCatalog", () => {
  it("delegates to core's listModules — no duplicated module data", () => {
    const ctx = fakeCtx({});
    const categories = marketplaceCatalog(ctx);

    expect(categories.length).toBeGreaterThan(0);
    const core = categories.flatMap((c) => c.modules).find((m) => m.key === "core");
    expect(core?.core).toBe(true);
    expect(core?.enabled).toBe(true);
  });

  it("reflects the institution's real module settings, not a fixture", () => {
    const onCtx = marketplaceCatalog(fakeCtx({ modules: { library: true } }));
    const offCtx = marketplaceCatalog(fakeCtx({ modules: { library: false } }));

    const libraryOn = onCtx.flatMap((c) => c.modules).find((m) => m.key === "library");
    const libraryOff = offCtx.flatMap((c) => c.modules).find((m) => m.key === "library");

    expect(libraryOn?.enabled).toBe(true);
    expect(libraryOff?.enabled).toBe(false);
  });
});
