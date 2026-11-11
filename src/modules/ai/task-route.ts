import "server-only";
// features-18 §C2 — the shared POST shape of ../../app/api/ai/report-remark/route.ts
// for the draft-only task routes (helpdesk-triage, translate, form-draft,
// substitution-note): cross-site guard -> size-capped JSON body -> strict Zod
// -> tenant context -> requirePermission -> AI module -> per-role capability
// -> handler. Handlers read through owner-module queries and call
// runStructured (which adds ai.generate, quota, per-user rate, concurrency,
// usage logging and cloud redaction); none of them writes anything.
import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, fail, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import type { CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  ai_unavailable: 502,
  ai_policy_blocked: 502,
  ai_invalid_output: 502,
  dependency_failed: 502,
};

function json(result: ActionResult<unknown>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(route: string, what: string, err: unknown): NextResponse {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] /api/ai/${route} ${what}`, err);
  return json(fail("internal", `Something went wrong. Reference: ${correlationId}`));
}

// getTenantContext throws Next.js control-flow signals for page rendering; a JSON API maps them to the envelope.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

/** Same gate the routes apply after the permission check: AI module on and the capability on for this role. UI uses it to show a button. */
export function aiTaskOn(ctx: TenantContext, key: CapabilityKey): boolean {
  return isModuleEnabled(ctx, "ai_teacher") && isAiCapabilityEnabled(ctx, key);
}

export interface AiTaskRouteOptions<I extends { institutionSlug: string }, O> {
  route: string;
  schema: z.ZodType<I>;
  maxBodyBytes: number;
  permission: Permission;
  capability: CapabilityKey;
  run: (ctx: TenantContext, input: I) => Promise<ActionResult<O>>;
}

export function aiTaskRoute<I extends { institutionSlug: string }, O>(opts: AiTaskRouteOptions<I, O>) {
  return async function POST(request: Request): Promise<NextResponse> {
    if (isCrossSiteRequest(request)) return json(fail("forbidden", "Cross-site request refused."));

    const body = await readJsonBody(request, opts.maxBodyBytes);
    if (!body.ok) {
      return json(fail("validation_failed", body.tooLarge ? `Request body exceeds ${opts.maxBodyBytes / 1024} KB.` : "Request body must be JSON."));
    }
    const parsed = opts.schema.safeParse(body.data);
    if (!parsed.success) {
      const { fieldErrors } = (parsed.error as z.ZodError<Record<string, unknown>>).flatten();
      return json(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
    }

    let ctx: TenantContext;
    try {
      ctx = await getTenantContext(parsed.data.institutionSlug);
    } catch (err) {
      const mapped = mapTenantContextError(err);
      return mapped ? json(mapped) : internalError(opts.route, "failed to resolve tenant context", err);
    }

    try {
      requirePermission(ctx, opts.permission);
    } catch (err) {
      if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
      throw err;
    }
    if (!isModuleEnabled(ctx, "ai_teacher")) return json(fail("ai_unavailable", "AI features are not available for your institution."));
    if (!isAiCapabilityEnabled(ctx, opts.capability)) return json(fail("ai_unavailable", "This AI feature is turned off for your role."));

    try {
      return json(await opts.run(ctx, parsed.data));
    } catch (err) {
      if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
      return internalError(opts.route, "failed", err);
    }
  };
}
