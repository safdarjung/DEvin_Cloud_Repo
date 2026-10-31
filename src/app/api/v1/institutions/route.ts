import "server-only";
// M03-T4 — onboarding: a signed-in user with no membership yet creates a
// school. Non-tenant route (no slug to resolve a membership from), so it
// calls create_institution directly with the caller's bearer-scoped client
// instead of going through the action dispatcher.
import { z } from "zod";
import { fail, ok, mapSqlError } from "@/lib/actions/result";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { readPostBody } from "@/lib/http/dispatch";
import { createClient, getClaims, withBearerToken } from "@/lib/supabase/server";
import { CreateInstitutionSchema } from "@/modules/core/schemas";

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

  const parsedInput = CreateInstitutionSchema.safeParse(parsedBody.data.input);
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

    const { name, slug, timezone, yearStart } = parsedInput.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_institution", {
      p_name: name,
      p_slug: slug,
      ...(timezone !== undefined ? { p_timezone: timezone } : {}),
      ...(yearStart !== undefined ? { p_year_start: yearStart } : {}),
    });
    if (error) return apiResponse(mapSqlError(error));

    return apiResponse(ok({ institutionId: data, slug }));
  };

  // Cookie session (onboarding page) or bearer token (API client).
  return token ? withBearerToken(token, run) : run();
}
