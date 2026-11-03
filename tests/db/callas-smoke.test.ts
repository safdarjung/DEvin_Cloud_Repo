import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { defineAction } from "@/lib/actions/define-action";

afterAll(async () => {
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("callAs (T-009 test harness smoke test)", () => {
  it("resolves a real per-role context, enforces the permission gate, and runs the handler", async () => {
    const fixture = await createTestInstitution("callas-smoke");
    try {
      const probe = defineAction({
        name: "test.callas-smoke",
        module: "core",
        schema: z.object({ value: z.string() }).strict(),
        permission: "attendance.mark",
        handler: async (input, ctx) => ({ echoed: input.value, role: ctx.membership.role }),
      });

      const asTeacher = await callAs(fixture, "teacher", probe, { value: "x" });
      expect(asTeacher).toEqual({ ok: true, data: { echoed: "x", role: "teacher" } });

      const asGuardian = await callAs(fixture, "guardian", probe, { value: "x" });
      expect(asGuardian).toEqual({
        ok: false,
        error: { code: "forbidden", message: "You do not have permission to perform this action." },
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
