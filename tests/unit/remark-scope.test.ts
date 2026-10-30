// T-0NN — canDraftRemarkForResult (src/modules/ai/remark-scope.ts), the
// app-layer mirror of result_remarks' write RLS (0047): owner/principal/
// exam_controller always pass; a teacher passes only if they are the class
// teacher of (or hold any subject_assignments row in) a section the
// student is actively enrolled in. A hand-rolled fake Supabase query
// builder stands in for the real client — DB-level enforcement (RLS
// itself) is covered by tests/db/result-remarks.test.ts.
import { describe, expect, it } from "vitest";
import { canDraftRemarkForResult } from "@/modules/ai/remark-scope";
import type { TenantContext } from "@/lib/auth/types";

type TableData = Record<string, unknown[]>;

function fakeSupabase(tables: TableData) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const builder = {
        rows,
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          return { data: builder.rows[0] ?? null, error: null };
        },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return resolve({ data: builder.rows, error: null });
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseCtx(role: TenantContext["membership"]["role"], staffId: string | null): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId, studentId: null, guardianId: null },
    permissions: new Set(),
  } as unknown as TenantContext;
}

describe("canDraftRemarkForResult", () => {
  it("owner/principal/exam_controller pass without any enrolment/teaching lookup", async () => {
    const supabase = fakeSupabase({});
    for (const role of ["owner", "principal", "exam_controller"] as const) {
      expect(await canDraftRemarkForResult(supabase, baseCtx(role, null), "student-1")).toBe(true);
    }
  });

  it("a teacher with no staffId fails", async () => {
    const supabase = fakeSupabase({});
    expect(await canDraftRemarkForResult(supabase, baseCtx("teacher", null), "student-1")).toBe(false);
  });

  it("a teacher fails when the student has no active enrolment", async () => {
    const supabase = fakeSupabase({ enrolments: [] });
    expect(await canDraftRemarkForResult(supabase, baseCtx("teacher", "staff-1"), "student-1")).toBe(false);
  });

  it("a teacher passes as the class teacher of the student's section", async () => {
    const supabase = fakeSupabase({
      enrolments: [{ class_section_id: "section-1" }],
      class_sections: [{ id: "section-1" }],
    });
    expect(await canDraftRemarkForResult(supabase, baseCtx("teacher", "staff-1"), "student-1")).toBe(true);
  });

  it("a teacher passes via any subject_assignments row in the student's section", async () => {
    const supabase = fakeSupabase({
      enrolments: [{ class_section_id: "section-1" }],
      class_sections: [],
      subject_assignments: [{ id: "sa-1" }],
    });
    expect(await canDraftRemarkForResult(supabase, baseCtx("teacher", "staff-1"), "student-1")).toBe(true);
  });

  it("a teacher fails when they are neither the class teacher nor assigned a subject in the student's section", async () => {
    const supabase = fakeSupabase({
      enrolments: [{ class_section_id: "section-1" }],
      class_sections: [],
      subject_assignments: [],
    });
    expect(await canDraftRemarkForResult(supabase, baseCtx("teacher", "staff-1"), "student-1")).toBe(false);
  });
});
