// Security review LOW: checkInVisitor / addPickupPerson must map Postgres
// 23503 (foreign-key violation) to `not_found`, same as
// gate-pass.actions.ts, per the X07 ruling's ErrorCode mapping table
// (23503 -> not_found). Mocks the supabase client so the insert's error
// path is reachable without a real DB (the RLS with-check fires first in
// practice, so this branch can't be exercised over a real connection).
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

function fakeSupabaseInsertError(code: string) {
  return {
    from() {
      const builder = {
        insert() {
          return builder;
        },
        select() {
          return builder;
        },
        async single() {
          return { data: null, error: { code, message: "fk violation" } };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const { checkInVisitor } = await import("@/modules/visitors/actions");
const { addPickupPerson } = await import("@/modules/visitors/pickup.actions");

function ctx(): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: { modules: { visitors: true } }, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "admin", staffId: null, guardianId: null, studentId: null },
    permissions: new Set(),
  } as unknown as TenantContext;
}

describe("visitors FK-violation mapping", () => {
  it("checkInVisitor maps 23503 to not_found", async () => {
    createClientMock.mockResolvedValueOnce(fakeSupabaseInsertError("23503"));
    const result = await checkInVisitor(
      "demo",
      { fullName: "Visitor", phone: "9876543210", purpose: "Meeting", meetingWith: "Reception" },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("addPickupPerson maps 23503 to not_found", async () => {
    createClientMock.mockResolvedValueOnce(fakeSupabaseInsertError("23503"));
    const result = await addPickupPerson(
      "demo",
      { studentId: "00000000-0000-0000-0000-000000000000", fullName: "Driver", relation: "driver", phone: "9876543210" },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
