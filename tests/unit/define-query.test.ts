import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { getRegisteredActions, getActionMeta } from "@/lib/actions/registry";
import { getRegisteredQueries, getQueryMeta } from "@/lib/actions/define-query";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

function fakeCtx(role: Role): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "demo",
      name: "Demo",
      settings: {},
      ai_policy: "local_only",
      is_demo: true,
    },
    user: {
      id: "user-1",
      profile: { fullName: "Test", phone: null, avatarPath: null, isPlatformAdmin: false },
    },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const Input = z.object({ value: z.string() }).strict();

describe("defineQuery", () => {
  it("returns ok(data) for a permitted ctx", async () => {
    const query = defineQuery({
      name: "test.query.ok",
      schema: Input,
      permission: "attendance.read",
      handler: async (input) => ({ echoed: input.value }),
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await query("demo", { value: "x" });

    expect(result).toEqual({ ok: true, data: { echoed: "x" } });
  });

  it("returns forbidden for a role lacking the permission", async () => {
    const query = defineQuery({
      name: "test.query.forbidden",
      schema: Input,
      permission: "finance.read",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await query("demo", { value: "x" });

    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "You do not have permission to perform this action." },
    });
  });

  it("returns validation_failed for bad input", async () => {
    const query = defineQuery({
      name: "test.query.bad-input",
      schema: Input,
      permission: "attendance.read",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await query("demo", { value: 123 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors).toBeDefined();
    }
  });

  it("registers in getRegisteredQueries, not getRegisteredActions", () => {
    defineQuery({
      name: "test.query.registers",
      schema: Input,
      permission: "attendance.read",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    expect(getRegisteredQueries().has("test.query.registers")).toBe(true);
    expect(getRegisteredActions().has("test.query.registers")).toBe(false);
  });

  it("records schema + static permission in getQueryMeta", () => {
    defineQuery({
      name: "test.query.meta-static",
      schema: Input,
      permission: "attendance.read",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const meta = getQueryMeta().get("test.query.meta-static");
    expect(meta?.schema).toBe(Input);
    expect(meta?.permission).toBe("attendance.read");
    expect(getActionMeta().has("test.query.meta-static")).toBe(false);
  });
});
