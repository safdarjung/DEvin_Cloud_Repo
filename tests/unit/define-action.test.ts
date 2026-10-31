import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
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

describe("defineAction", () => {
  it("returns validation_failed with fieldErrors for bad input", async () => {
    const action = defineAction({
      name: "test.bad-input",
      schema: Input,
      permission: "dashboard.view",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await action("demo", { value: 123 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.fieldErrors).toBeDefined();
    }
  });

  it("returns forbidden for a role lacking the permission", async () => {
    const action = defineAction({
      name: "test.forbidden",
      schema: Input,
      permission: "finance.read",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "You do not have permission to perform this action." },
    });
  });

  it("returns ok for a valid, permitted call", async () => {
    const action = defineAction({
      name: "test.ok",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => ({ echoed: input.value }),
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: true, data: { echoed: "x" } });
  });

  it("returns internal with a correlation id for an unexpected throw, and logs once", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = defineAction({
      name: "test.throws",
      schema: Input,
      permission: "attendance.mark",
      handler: async () => {
        throw new Error("boom");
      },
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await action("demo", { value: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal");
      expect(result.error.message).toMatch(/Reference: [0-9a-f-]+/);
    }
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("CRITICAL fix (GU-09 security review): a third argument is rejected as forbidden outside a Vitest process, even when it looks like a valid TenantContext", async () => {
    const action = defineAction({
      name: "test.override-ctx-outside-vitest",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      // No resolveContext override here — this exercises the real
      // defaultResolveContext path too, but it never gets there: the
      // overrideCtx gate rejects before resolveContext is ever consulted.
    });

    const originalVitestFlag = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const result = await action("demo", { value: "x" }, fakeCtx("owner"));
      expect(result).toEqual({
        ok: false,
        error: { code: "forbidden", message: "You do not have permission to perform this action." },
      });
    } finally {
      process.env.VITEST = originalVitestFlag;
    }
  });

  it("still honors overrideCtx when process.env.VITEST is set (every existing db test's callAs)", async () => {
    const action = defineAction({
      name: "test.override-ctx-inside-vitest",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
    });

    const result = await action("demo", { value: "x" }, fakeCtx("teacher"));
    expect(result).toEqual({ ok: true, data: { value: "x" } });
  });

  it("maps a known AppError thrown by the handler straight through", async () => {
    const action = defineAction({
      name: "test.app-error",
      schema: Input,
      permission: "attendance.mark",
      handler: async () => {
        throw new AppError("conflict", "Already exists.");
      },
      resolveContext: async () => fakeCtx("teacher"),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: false, error: { code: "conflict", message: "Already exists." } });
  });
});

describe("mapSqlError (C-03 criterion 3)", () => {
  it("maps code:invalid_state to invalid_state", () => {
    const result = mapSqlError({ message: "code:invalid_state", detail: "bad state" });
    expect(result).toEqual({ ok: false, error: { code: "invalid_state", message: "bad state" } });
  });

  it("maps code:conflict to conflict", () => {
    const result = mapSqlError({ message: "code:conflict", details: "duplicate" });
    expect(result).toEqual({ ok: false, error: { code: "conflict", message: "duplicate" } });
  });

  it("maps an unknown error to internal", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = mapSqlError(new Error("relation does not exist"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal");
    }
    consoleSpy.mockRestore();
  });
});
