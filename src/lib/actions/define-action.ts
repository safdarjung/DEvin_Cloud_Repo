import type { z } from "zod";
import { AppError, fail, ok, type ActionResult } from "@/lib/actions/result";
import { registerAction } from "@/lib/actions/registry";
import { hasPermission } from "@/lib/auth/require";
import type { Permission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled, MODULE_DISABLED_MESSAGE, type ModuleKey } from "@/lib/modules/catalog";

export type Action<O> = (
  institutionSlug: string,
  raw: unknown,
  /**
   * Test-only: bypasses context resolution entirely (tests/helpers/actions.ts
   * callAs). Security review (GU-09, 2026-10-31) — CRITICAL, codebase-wide:
   * every `"use server"` action file compiles each export into a real HTTP
   * endpoint; Next's action handler decodes whatever argument array the
   * request carries and calls the function with it (`action.apply(null,
   * args)`), with no enforcement that a caller supplies only the two
   * arguments a legitimate client ever sends. A signed-in attacker who
   * discovers an action's id (derivable from the client bundle) could send
   * a crafted third argument as a forged `TenantContext`, skipping
   * `getTenantContext`/`hasPermission` for EVERY action built on this
   * function — not just this packet's. Gated below on `process.env.VITEST`
   * (set by Vitest itself, never by a request), not a value any caller can
   * influence, so this still works for the whole existing test suite with
   * zero changes to any test file.
   */
  overrideCtx?: TenantContext,
) => Promise<ActionResult<O>>;

export interface GuardedCallOptions<I, O> {
  schema: z.ZodType<I>;
  permission: Permission | ((input: I) => Permission);
  handler: (input: I, ctx: TenantContext) => Promise<O>;
  /**
   * Context resolver, injected for tests. Defaults to a dynamic import of
   * `getTenantContext` from `@/lib/auth/context` (T-007) — dynamic so this
   * file doesn't hard-depend on that module existing at build time.
   */
  resolveContext?: (institutionSlug: string) => Promise<TenantContext>;
  /** Gate order (MOD rulings): context → module → Zod → permission → handler. */
  module?: ModuleKey;
}

interface DefineActionOptions<I, O> extends GuardedCallOptions<I, O> {
  /** Audit action string; also the registry key (06 §1.2). */
  name: string;
  /** Required (MOD-T13): every action declares its module, core keys included. */
  module: ModuleKey;
}

async function defaultResolveContext(institutionSlug: string): Promise<TenantContext> {
  const { getTenantContext } = await import("@/lib/auth/context");
  return getTenantContext(institutionSlug);
}

function logUnexpectedError(err: unknown): string {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] action failed unexpectedly`, err);
  return correlationId;
}

// redirect()/notFound() (e.g. inside getTenantContext) throw a digest-tagged
// control-flow signal that Next.js's renderer must see — never swallow it
// into the envelope.
function isNextControlFlowSignal(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
  );
}

export function guardedCall<I, O>(opts: GuardedCallOptions<I, O>): Action<O> {
  const action: Action<O> = async (institutionSlug, raw, overrideCtx) => {
    let ctx: TenantContext;
    if (overrideCtx) {
      // CRITICAL fix (see the parameter's own doc comment above): a third
      // argument is only ever legitimate from in-process test code, which
      // Vitest marks with its own env var. A real HTTP request can never
      // set this — it's read, not supplied, by this process.
      if (process.env.VITEST !== "true") {
        return fail("forbidden", "You do not have permission to perform this action.");
      }
      ctx = overrideCtx;
    } else {
      try {
        ctx = await (opts.resolveContext ?? defaultResolveContext)(institutionSlug);
      } catch (err) {
        if (isNextControlFlowSignal(err)) throw err;
        if (err instanceof AppError) return fail(err.code, err.message, err.fieldErrors);
        return fail("internal", `Something went wrong. Reference: ${logUnexpectedError(err)}`);
      }
    }

    if (opts.module && !isModuleEnabled(ctx, opts.module)) {
      return fail("forbidden", MODULE_DISABLED_MESSAGE);
    }

    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      const { fieldErrors } = parsed.error.flatten();
      return fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>);
    }

    const permission =
      typeof opts.permission === "function" ? opts.permission(parsed.data) : opts.permission;
    if (!hasPermission(ctx, permission)) {
      return fail("forbidden", "You do not have permission to perform this action.");
    }

    try {
      return ok(await opts.handler(parsed.data, ctx));
    } catch (err) {
      if (isNextControlFlowSignal(err)) throw err;
      if (err instanceof AppError) return fail(err.code, err.message, err.fieldErrors);
      return fail("internal", `Something went wrong. Reference: ${logUnexpectedError(err)}`);
    }
  };

  return action;
}

export function defineAction<I, O>(opts: DefineActionOptions<I, O>): Action<O> {
  const action = guardedCall(opts);
  registerAction(opts.name, action as Action<unknown>, {
    schema: opts.schema,
    permission: typeof opts.permission === "function" ? null : opts.permission,
    module: opts.module,
  });
  return action;
}
