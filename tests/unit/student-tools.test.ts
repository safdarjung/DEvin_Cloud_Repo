// GU-08 — student agent tools. Same scope-check discipline as
// teacher-tools.test.ts: a model-supplied id is never trusted (grade is
// derived from the student's own active enrolment, not an argument), and
// a failed lookup returns an error STRING, never a thrown exception.
import { describe, expect, it, vi } from "vitest";
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
        ilike() {
          return builder;
        },
        or() {
          return builder;
        },
        limit() {
          return builder;
        },
        order() {
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

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fakeSupabase({})) }));

const { studentTools } = await import("@/modules/ai/agent/student-tools");
const serverClient = await import("@/lib/supabase/server");

function baseCtx(studentId: string | null = "student-1"): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings: {}, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Student", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "student", staffId: null, guardianId: null, studentId },
    permissions: new Set(["ai.study"]),
  } as unknown as TenantContext;
}

describe("studentTools", () => {
  describe("findMyCurriculumUnit", () => {
    it("errors when the student has no active enrolment", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({ enrolments: [] }));
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      const result = await tools.findMyCurriculumUnit.execute!({ query: "fractions" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("You don't have an active enrolment, so no curriculum units are available.");
    });

    it("returns an error string when the student has no studentId at all", async () => {
      const tools = await studentTools(baseCtx(null), { visualsEnabled: false });
      const result = await tools.findMyCurriculumUnit.execute!({ query: "fractions" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toBe("You don't have an active enrolment, so no curriculum units are available.");
    });

    it("returns up to 5 matches scoped to the student's own grade, never a caller-supplied one", async () => {
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(
        fakeSupabase({
          enrolments: [{ class_sections: { grade_id: "g1" } }],
          curriculum_units: [{ id: "u1", title: "Fractions", subjects: { name: "Maths" } }],
        }),
      );
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      const result = await tools.findMyCurriculumUnit.execute!({ query: "frac" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual([{ id: "u1", title: "Fractions", subjectName: "Maths" }]);
    });

    it("returns a generic error string, never throws, when the query fails", async () => {
      const supabase = fakeSupabase({ enrolments: [{ class_sections: { grade_id: "g1" } }] });
      supabase.from = () => {
        throw new Error("connection reset");
      };
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(supabase);
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      const result = await tools.findMyCurriculumUnit.execute!({ query: "frac" }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toMatch(/^Something went wrong looking that up\. Reference: /);
    });

    it("is returned without showStudyBlocks when visuals are disabled", async () => {
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      expect(tools).not.toHaveProperty("showStudyBlocks");
    });
  });

  describe("listMyStudyItems", () => {
    const opts = { toolCallId: "1", messages: [], context: {} };

    it("returns the caller's saved notebook items", async () => {
      const row = { id: "i1", kind: "notes", title: "Photosynthesis", folder: null, pinned: false, updated_at: "2026-11-01T00:00:00Z" };
      vi.mocked(serverClient.createClient).mockResolvedValueOnce(fakeSupabase({})).mockResolvedValueOnce(fakeSupabase({ study_items: [row] }));
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      const result = (await tools.listMyStudyItems.execute!({}, opts)) as Array<{ title: string }>;
      expect(result.map((r) => r.title)).toEqual(["Photosynthesis"]);
    });

    it("says so when the notebook is empty", async () => {
      const tools = await studentTools(baseCtx(), { visualsEnabled: false });
      expect(await tools.listMyStudyItems.execute!({}, opts)).toBe("Nothing saved in the study notebook yet.");
    });

    it("is wired to the study_notebook capability", async () => {
      const { CAPABILITIES } = await import("@/modules/ai/capabilities/catalog");
      expect(CAPABILITIES.study_notebook.tools).toContain("listMyStudyItems");
    });
  });

  describe("showStudyBlocks", () => {
    it("is included when visuals are enabled, and echoes back a count", async () => {
      const tools = await studentTools(baseCtx(), { visualsEnabled: true });
      expect(tools).toHaveProperty("showStudyBlocks");
      const blocks: Array<{ kind: "callout"; tone: "tip"; text: string }> = [
        { kind: "callout", tone: "tip", text: "Remember this." },
      ];
      const result = await tools.showStudyBlocks!.execute!({ blocks }, { toolCallId: "1", messages: [], context: {} });
      expect(result).toEqual({ shown: 1 });
    });
  });
});
