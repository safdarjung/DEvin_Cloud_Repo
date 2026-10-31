// M02-T2: shared dispatch helper behind /api/v1/actions/* (M01) and
// /api/v1/query/* (M02). Behaviour moved verbatim out of the two routes —
// status codes, messages, headers unchanged.
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import type { AnyAction, ActionMeta } from "@/lib/actions/registry";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { getClaims, withBearerToken } from "@/lib/supabase/server";

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

/**
 * Origin check, 1 MB cap, JSON parse. Callers get back either the parsed
 * body or a ready-made 400/413 Response for the route to return as-is.
 */
export async function readPostBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (isCrossSiteRequest(request)) {
    return { ok: false, response: apiResponse(fail("forbidden", "Cross-site request rejected."), 403) };
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return { ok: false, response: apiResponse(fail("validation_failed", "Request body too large."), 413) };
    }
    return { ok: false, response: apiResponse(fail("validation_failed", "Request body must be JSON."), 400) };
  }

  return { ok: true, body: bodyResult.data };
}

export async function dispatchCall(
  request: Request,
  name: string,
  registry: ReadonlyMap<string, AnyAction>,
  body: unknown,
): Promise<Response> {
  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return apiResponse(fail("validation_failed", "Request body must be JSON."), 400);
  }

  const slug = request.headers.get("x-institution") ?? parsedBody.data.institution ?? "";
  if (!isValidSlug(slug)) {
    return apiResponse(fail("validation_failed", "Invalid or missing institution slug."));
  }

  const action = registry.get(name);
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
    console.error(`[${correlationId}] /api/v1 dispatcher failed`, err);
    return apiResponse(fail("internal", `Something went wrong. Reference: ${correlationId}`), 500);
  }
}

export async function listResponse(
  request: Request,
  meta: ReadonlyMap<string, ActionMeta>,
): Promise<Response> {
  const token = bearerToken(request);
  const claims = await (token ? withBearerToken(token, getClaims) : getClaims());
  if (!claims) {
    return apiResponse(fail("unauthenticated", "Authentication required."), 401);
  }

  const list = [...meta.entries()]
    .map(([name, m]) => ({
      name,
      permission: m.permission,
      inputSchema: z.toJSONSchema(m.schema, { io: "input", unrepresentable: "any" }),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return apiResponse(ok(list));
}
