import "server-only";
// M03-T6 — onboarding: an invited user (no membership yet) claims their
// membership with the invite token. Non-tenant route (no slug to resolve a
// membership from), so it calls accept_invitation directly with the
// caller's bearer-scoped client — mirrors Task 4's create_institution route
// (src/app/api/v1/institutions/route.ts) exactly.
import { z } from "zod";
import { fail, ok, mapSqlError } from "@/lib/actions/result";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { readPostBody } from "@/lib/http/dispatch";
import { createClient, getClaims, withBearerToken } from "@/lib/supabase/server";
import { AcceptInvitationSchema } from "@/modules/core/schemas";

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

  const parsedInput = AcceptInvitationSchema.safeParse(parsedBody.data.input);
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

    const supabase = await createClient();
    const { data: membershipId, error } = await supabase.rpc("accept_invitation", {
      p_token: parsedInput.data.token,
    });
    if (error) return apiResponse(mapSqlError(error));

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("institution_id")
      .eq("id", membershipId)
      .single();
    if (membershipError || !membership) return apiResponse(mapSqlError(membershipError));

    const { data: institution, error: institutionError } = await supabase
      .from("institutions")
      .select("slug")
      .eq("id", membership.institution_id)
      .single();
    if (institutionError || !institution) return apiResponse(mapSqlError(institutionError));

    return apiResponse(ok({ membershipId, institutionSlug: institution.slug }));
  };

  // Cookie session (web) or bearer token (API client).
  return token ? withBearerToken(token, run) : run();
}
