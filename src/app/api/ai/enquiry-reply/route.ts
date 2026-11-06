import "server-only";
// Admissions enquiry-reply AI draft route (04 §3 "Route Handlers
// /api/ai/*": Node, cookie session + `ai.generate`; mirrors
// src/app/api/ai/quiz/route.ts's shape). Persists nothing — the gateway
// writes only `ai_usage_events` metadata; saving a draft as a note goes
// through the client calling the existing `addEnquiryNote` action, which
// has its own full validation and `admissions.enquiry.write` check. This
// route cannot write a note.
import { NextResponse } from "next/server";
import { AppError, fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { EnquiryReplyRequestSchema, EnquiryReplySchema } from "@/modules/ai/enquiry-reply.schemas";
import {
  buildDenyNames,
  buildEnquiryReplyPrompt,
  capNotesMessage,
  ENQUIRY_REPLY_INSTRUCTIONS,
} from "@/modules/ai/prompts/enquiry-reply";
import { getEnquiry } from "@/modules/admissions/queries";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Request body is tiny (institutionSlug + enquiryId) — same cap style as
// the quiz route, scaled down since there's no free-text field here.
const MAX_BODY_BYTES = 2 * 1024;

interface EnquiryReplyResponseData {
  reply: string;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

// The draft is a single <=500 char field (EnquiryReplySchema) — far
// shorter than a multi-question quiz, so a smaller cap than the quiz
// route's 2048 is still generous headroom while still bounding a
// stuck/rambling local generation (same rationale, scaled down).
const MAX_OUTPUT_TOKENS = 512;

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

function json(result: ActionResult<EnquiryReplyResponseData>): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS_BY_CODE[result.error.code] ?? 500 });
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same JSON-API mapping as the quiz route's `mapTenantContextError` —
// `getTenantContext` is written for page rendering (redirect/notFound
// throws); this is a JSON route, so those are caught and mapped instead.
function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // DBT-29: cookie-authenticated and cost-bearing — refuse cross-site callers.
  if (isCrossSiteRequest(request)) {
    return json(fail("forbidden", "Cross-site request refused."));
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return json(fail("validation_failed", "Request body exceeds 2 KB."));
    }
    return json(fail("validation_failed", "Request body must be JSON."));
  }

  const parsedRequest = EnquiryReplyRequestSchema.safeParse(bodyResult.data);
  if (!parsedRequest.success) {
    const { fieldErrors } = parsedRequest.error.flatten();
    return json(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
  }
  const input = parsedRequest.data;

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    const mapped = mapTenantContextError(err);
    if (mapped) return json(mapped);
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/enquiry-reply failed to resolve tenant context`, err);
    return json(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.generate");
    requirePermission(ctx, "admissions.enquiry.read");
  } catch (err) {
    if (err instanceof AppError) return json(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  if (!isModuleEnabled(ctx, "ai_teacher")) {
    return json(fail("ai_unavailable", "AI features are not available for your institution."));
  }

  // `getEnquiry` is already institution-scoped — a cross-tenant id reads
  // back null, so it maps to the same `not_found` a nonexistent id gets
  // (06 §1.1: existence of a row in another tenant is never revealed).
  let enquiry;
  try {
    enquiry = await getEnquiry(ctx, input.enquiryId);
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/ai/enquiry-reply failed to load enquiry`, err);
    return json(internalError(correlationId));
  }
  if (!enquiry) {
    return json(fail("not_found", "Enquiry not found."));
  }

  const supabase = await createClient();
  let gradeLabel = "Not specified";
  if (enquiry.gradeAppliedId) {
    const { data: grade, error: gradeError } = await supabase
      .from("grades")
      .select("display_name, code")
      .eq("id", enquiry.gradeAppliedId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (gradeError) {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] /api/ai/enquiry-reply failed to load grade`, gradeError);
      return json(internalError(correlationId));
    }
    gradeLabel = grade?.display_name ?? grade?.code ?? gradeLabel;
  }

  // The enquiry's own notes — the enquirer's original message (0007's
  // `submit_public_enquiry`) and anything staff logged since — are the
  // only free text in scope here; never the phone number (06 §5 data flow).
  // `capNotesMessage` bounds this (fix round 1, MED-2) — see its doc comment.
  const message = capNotesMessage(enquiry.notes.map((n) => n.text));

  const prompt = buildEnquiryReplyPrompt({
    gradeLabel,
    stage: enquiry.status,
    message,
  });

  const result = await runStructured({
    ctx,
    feature: "enquiry_reply_draft",
    agentCloud: true, // owner cloud exception (D28 ext. 2026-11-06)
    schema: EnquiryReplySchema,
    instructions: ENQUIRY_REPLY_INSTRUCTIONS,
    prompt,
    // A future cloud-enabled institution redacts these from the prompt
    // before it ever leaves this process (local-only today, per the demo
    // config — same deny-list shape as 07 §5 "Redaction before cloud").
    // `buildDenyNames` widens this past exact full-name matches (fix round
    // 1, MED-1) — see its doc comment.
    denyNames: buildDenyNames(enquiry.childName, enquiry.guardianName),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!result.ok) {
    return json(result);
  }

  return json(
    ok({
      reply: result.data.data.reply,
      provider: result.data.provider,
      model: result.data.model,
      fallback: result.data.fallback,
    }),
  );
}
