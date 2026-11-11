import "server-only";
// POST shape of /api/ai/explain-anatomy and /api/ai/infographic: cross-site
// guard -> size-capped JSON -> strict Zod -> tenant context -> the orb's own
// gates (ai.chat, the role's AI module, the role's AI switch) -> handler.
// Same order as ../task-route.ts; these are open to every role the orb is.
import type { z } from "zod";
import { AppError, fail, type ActionResult } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { apiResponse } from "@/lib/http/api-envelope";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";

// getTenantContext throws Next.js control-flow signals for page rendering; a JSON API maps them to the envelope.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

function internalError(route: string, what: string, err: unknown): Response {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] /api/ai/${route} ${what}`, err);
  return apiResponse(fail("internal", `Something went wrong. Reference: ${correlationId}`));
}

export function explainRoute<I extends { institutionSlug: string }, O>(opts: {
  route: string;
  schema: z.ZodType<I>;
  maxBodyBytes: number;
  run: (ctx: TenantContext, input: I) => Promise<ActionResult<O>>;
}) {
  return async function POST(request: Request): Promise<Response> {
    if (isCrossSiteRequest(request)) return apiResponse(fail("forbidden", "Cross-site request refused."));

    const body = await readJsonBody(request, opts.maxBodyBytes);
    if (!body.ok) return apiResponse(fail("validation_failed", body.tooLarge ? `Request body exceeds ${opts.maxBodyBytes / 1024} KB.` : "Request body must be JSON."));
    const parsed = opts.schema.safeParse(body.data);
    if (!parsed.success) {
      const { fieldErrors } = (parsed.error as z.ZodError<Record<string, unknown>>).flatten();
      return apiResponse(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
    }

    let ctx: TenantContext;
    try {
      ctx = await getTenantContext(parsed.data.institutionSlug);
    } catch (err) {
      const mapped = mapTenantContextError(err);
      return mapped ? apiResponse(mapped) : internalError(opts.route, "failed to resolve tenant context", err);
    }

    try {
      requirePermission(ctx, "ai.chat");
    } catch (err) {
      if (err instanceof AppError) return apiResponse(fail(err.code, err.message, err.fieldErrors));
      throw err;
    }
    const role = ctx.membership.role;
    if (!isModuleEnabled(ctx, role === "student" ? "ai_student" : "ai_teacher")) return apiResponse(fail("ai_unavailable", "AI is switched off for this school."));
    if (!roleAiConfig(ctx, role).enabled) return apiResponse(fail("ai_unavailable", "AI is turned off for your role."));

    try {
      return apiResponse(await opts.run(ctx, parsed.data));
    } catch (err) {
      if (err instanceof AppError) return apiResponse(fail(err.code, err.message, err.fieldErrors));
      return internalError(opts.route, "failed", err);
    }
  };
}
