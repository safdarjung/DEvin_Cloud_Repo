import "server-only";
// M03-T4 — onboarding: a signed-in user with no membership yet creates a
// school. Non-tenant route (no slug to resolve a membership from), so it
// calls the RPC directly with the caller's bearer-scoped client instead of
// going through the action dispatcher. F18 §H (0127): a school is created
// only with an invite code, through create_institution_with_invite; every bad
// code (unknown, revoked, expired, used up) gets the same `forbidden`.
import { z } from "zod";
import { fail, ok, mapSqlError } from "@/lib/actions/result";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { readPostBody } from "@/lib/http/dispatch";
import { createClient, getClaims, withBearerToken } from "@/lib/supabase/server";
import { CreateInstitutionWithInviteSchema } from "@/modules/core/setup/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ input: z.unknown().optional() });

export async function POST(request: Request): Promise<Response> {
  const bodyResult = await readPostBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsedBody = BodySchema.safeParse(bodyResult.body);
  if (!parsedBody.success) {
    return apiResponse(fail("validation_failed", "Request body must be JSON."), 400);
  }

  const parsedInput = CreateInstitutionWithInviteSchema.safeParse(parsedBody.data.input);
  if (!parsedInput.success) {
    const { fieldErrors } = parsedInput.error.flatten();
    return apiResponse(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
  }

  const token = bearerToken(request);
  const run = async (): Promise<Response> => {
    const claims = await getClaims();
    if (!claims) {
      return apiResponse(fail("unauthenticated", "Authentication required."), 401);
    }

    const { name, slug, code } = parsedInput.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_institution_with_invite", {
      p_code: code,
      p_name: name,
      p_slug: slug,
    });
    if (error) return apiResponse(mapSqlError(error));
    const created = data?.[0];
    if (!created) return apiResponse(fail("internal", "School was not created."));

    return apiResponse(ok({ institutionId: created.institution_id, slug: created.slug }));
  };

  // Cookie session (onboarding page) or bearer token (API client).
  return token ? withBearerToken(token, run) : run();
}
