import "server-only";
// Side-effect: registers every defineAction() before the lookup below.
import "../all-actions";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { getRegisteredActions } from "@/lib/actions/registry";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { withBearerToken } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

const BodySchema = z.object({
  institution: z.string().optional(),
  input: z.unknown().optional(),
});

function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 100 && SLUG_PATTERN.test(slug);
}

/**
 * define-action.ts's own `isNextControlFlowSignal` is private to that
 * module — `redirect()`/`notFound()` inside context resolution rethrow
 * through `action()` as the same digest-tagged errors, which must become
 * an HTTP status here, never a 500.
 */
function controlFlowStatus(err: unknown): 401 | 404 | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return 401;
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return 404;
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return apiResponse(fail("forbidden", "Cross-site request rejected."), 403);
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return apiResponse(fail("validation_failed", "Request body too large."), 413);
    }
    return apiResponse(fail("validation_failed", "Request body must be JSON."), 400);
  }

  const parsedBody = BodySchema.safeParse(bodyResult.data);
  if (!parsedBody.success) {
    return apiResponse(fail("validation_failed", "Request body must be JSON."), 400);
  }

  const slug = request.headers.get("x-institution") ?? parsedBody.data.institution ?? "";
  if (!isValidSlug(slug)) {
    return apiResponse(fail("validation_failed", "Invalid or missing institution slug."));
  }

  const { name } = await params;
  const action = getRegisteredActions().get(name);
  if (!action) {
    return apiResponse(fail("not_found", "Unknown action."));
  }

  const token = bearerToken(request);
  const run = () => action(slug, parsedBody.data.input);

  try {
    const result = (await (token ? withBearerToken(token, run) : run())) as ActionResult<unknown>;
    return apiResponse(result);
  } catch (err) {
    const status = controlFlowStatus(err);
    if (status === 401) return apiResponse(fail("unauthenticated", "Authentication required."), 401);
    if (status === 404) return apiResponse(fail("not_found", "Not found."), 404);

    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/v1/actions dispatcher failed`, err);
    return apiResponse(fail("internal", `Something went wrong. Reference: ${correlationId}`), 500);
  }
}
