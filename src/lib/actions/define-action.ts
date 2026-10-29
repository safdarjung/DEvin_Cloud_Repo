import type { z } from "zod";
import { AppError, fail, ok, type ActionResult } from "@/lib/actions/result";
import { registerAction } from "@/lib/actions/registry";
import { hasPermission } from "@/lib/auth/require";
import type { Permission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";

type Action<O> = (
  institutionSlug: string,
  raw: unknown,
  /** Test-only: bypasses context resolution entirely (tests/helpers/actions.ts callAs). */
  overrideCtx?: TenantContext,
) => Promise<ActionResult<O>>;

interface DefineActionOptions<I, O> {
  /** Audit action string; also the registry key (06 §1.2). */
  name: string;
  schema: z.ZodType<I>;
  permission: Permission | ((input: I) => Permission);
  handler: (input: I, ctx: TenantContext) => Promise<O>;
  /**
   * Context resolver, injected for tests. Defaults to a dynamic import of
   * `getTenantContext` from `@/lib/auth/context` (T-007) — dynamic so this
   * file doesn't hard-depend on that module existing at build time.
   */
  resolveContext?: (institutionSlug: string) => Promise<TenantContext>;
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

export function defineAction<I, O>(opts: DefineActionOptions<I, O>): Action<O> {
  const action: Action<O> = async (institutionSlug, raw, overrideCtx) => {
    let ctx: TenantContext;
    if (overrideCtx) {
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

  registerAction(opts.name, action as Action<unknown>);
  return action;
}
