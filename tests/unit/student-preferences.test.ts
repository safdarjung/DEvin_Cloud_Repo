// GU-08 — getStudentPreferences: plan defaults when no row exists or the
// caller has no studentId, stored values (filtered to known shapes)
// otherwise.
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

function fakeSupabase(row: { skills: unknown; style: unknown } | null) {
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { getStudentPreferences } = await import("@/modules/ai/student-preferences");

function ctx(studentId: string | null = "student-1"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "student", staffId: null, guardianId: null, studentId },
    permissions: new Set(["ai.study"]),
  } as unknown as TenantContext;
}

describe("getStudentPreferences", () => {
  it("returns the plan's defaults when the caller has no studentId", async () => {
    const result = await getStudentPreferences(ctx(null));
    expect(result).toEqual({
      skills: ["terse", "eli5", "anatomy"],
      style: { notesDensity: "standard", notesFormat: "bullets", language: "en" },
    });
  });

  it("returns the defaults when no preferences row exists", async () => {
    createClientMock.mockResolvedValueOnce(fakeSupabase(null));
    const result = await getStudentPreferences(ctx());
    expect(result.skills).toEqual(["terse", "eli5", "anatomy"]);
  });

  it("returns the stored skills/style when a row exists", async () => {
    createClientMock.mockResolvedValueOnce(fakeSupabase({ skills: ["terse"], style: { notesDensity: "brief", notesFormat: "qa", language: "hi", myStyle: "Use sports examples." } }));
    const result = await getStudentPreferences(ctx());
    expect(result).toEqual({
      skills: ["terse"],
      style: { notesDensity: "brief", notesFormat: "qa", language: "hi", myStyle: "Use sports examples." },
    });
  });

  it("falls back to defaults for an unrecognized stored skill or style value", async () => {
    createClientMock.mockResolvedValueOnce(
      fakeSupabase({ skills: ["terse", "not-a-real-skill"], style: { notesDensity: "extreme", notesFormat: "bullets", language: "en" } }),
    );
    const result = await getStudentPreferences(ctx());
    expect(result.skills).toEqual(["terse"]);
    expect(result.style.notesDensity).toBe("standard");
  });
});
