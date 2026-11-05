import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { defineQuery, getQueryMeta } from "@/lib/actions/define-query";
import { getActionMeta } from "@/lib/actions/registry";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

function fakeCtx(role: Role, settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "demo",
      name: "Demo",
      settings,
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
      module: "core",
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
      module: "core",
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
      module: "core",
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
      module: "core",
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
      module: "core",
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
      module: "core",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
    });

    const result = await action("demo", { value: "x" }, fakeCtx("teacher"));
    expect(result).toEqual({ ok: true, data: { value: "x" } });
  });

  it("defineAction records its schema and static permission", () => {
    defineAction({
      name: "test.meta-static",
      module: "core",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const meta = getActionMeta().get("test.meta-static");
    expect(meta?.schema).toBe(Input);
    expect(meta?.permission).toBe("attendance.mark");
  });

  it("function permission is recorded as null", () => {
    defineAction({
      name: "test.meta-fn-permission",
      module: "core",
      schema: Input,
      permission: () => "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    const meta = getActionMeta().get("test.meta-fn-permission");
    expect(meta?.permission).toBeNull();
  });

  it("maps a known AppError thrown by the handler straight through", async () => {
    const action = defineAction({
      name: "test.app-error",
      module: "core",
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

describe("defineAction module gate (MOD-T2)", () => {
  it("returns forbidden with the exact disabled message when the module is off, handler not called", async () => {
    const handler = vi.fn(async (input: { value: string }) => input);
    const action = defineAction({
      name: "test.module-off",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler,
      resolveContext: async () => fakeCtx("teacher", { modules: { exams: false } }),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the module-disabled forbidden even for input that would fail Zod", async () => {
    const handler = vi.fn(async (input: { value: string }) => input);
    const action = defineAction({
      name: "test.module-off-bad-input",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler,
      resolveContext: async () => fakeCtx("teacher", { modules: { exams: false } }),
    });

    const result = await action("demo", { value: 123 });

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler when the module is on", async () => {
    const action = defineAction({
      name: "test.module-on",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => ({ echoed: input.value }),
      resolveContext: async () => fakeCtx("teacher", { modules: { exams: true } }),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: true, data: { echoed: "x" } });
  });

  it("a core module key never blocks even with garbage stored settings", async () => {
    const action = defineAction({
      name: "test.module-core",
      module: "core",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () =>
        fakeCtx("teacher", { modules: { core: false, nonsense: "yes" }, garbage: 42 }),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: true, data: { value: "x" } });
  });

  it("forbids a module whose `requires` dependency is off, even though it itself is stored true", async () => {
    const action = defineAction({
      name: "test.module-requires",
      module: "substitution",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () =>
        fakeCtx("teacher", { modules: { substitution: true, timetable: false } }),
    });

    const result = await action("demo", { value: "x" });

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
  });

  it("records `module` in getActionMeta()", () => {
    defineAction({
      name: "test.module-meta",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    expect(getActionMeta().get("test.module-meta")?.module).toBe("exams");
  });
});

describe("defineQuery module gate (MOD-T2)", () => {
  it("behaves the same as defineAction: forbidden when the module is off, handler not called", async () => {
    const handler = vi.fn(async (input: { value: string }) => input);
    const query = defineQuery({
      name: "test.query-module-off",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler,
      resolveContext: async () => fakeCtx("teacher", { modules: { exams: false } }),
    });

    const result = await query("demo", { value: "x" });

    expect(result).toEqual({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler when the module is on", async () => {
    const query = defineQuery({
      name: "test.query-module-on",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => ({ echoed: input.value }),
      resolveContext: async () => fakeCtx("teacher", { modules: { exams: true } }),
    });

    const result = await query("demo", { value: "x" });

    expect(result).toEqual({ ok: true, data: { echoed: "x" } });
  });

  it("records `module` in getQueryMeta()", () => {
    defineQuery({
      name: "test.query-module-meta",
      module: "exams",
      schema: Input,
      permission: "attendance.mark",
      handler: async (input) => input,
      resolveContext: async () => fakeCtx("teacher"),
    });

    expect(getQueryMeta().get("test.query-module-meta")?.module).toBe("exams");
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

  it("maps SQLSTATE 42501 (RLS / grant violation) to forbidden", () => {
    const result = mapSqlError({ code: "42501", message: "new row violates row-level security policy" });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    if (!result.ok) expect(result.error.message).not.toMatch(/row-level/);
  });

  it("maps SQLSTATE 23505 (unique violation) to conflict", () => {
    const result = mapSqlError({ code: "23505", message: "duplicate key value violates unique constraint \"x_key\"" });
    expect(result).toMatchObject({ ok: false, error: { code: "conflict" } });
    if (!result.ok) expect(result.error.message).not.toMatch(/x_key/);
  });

  it("maps SQLSTATE 23503 (FK violation) to not_found", () => {
    const result = mapSqlError({ code: "23503", message: "insert or update on table \"x\" violates foreign key constraint \"x_fkey\"" });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    if (!result.ok) expect(result.error.message).not.toMatch(/x_fkey/);
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
