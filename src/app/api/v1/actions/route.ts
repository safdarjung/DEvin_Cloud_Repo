import "server-only";
// Side-effect: registers every defineAction() before the listing below.
import "./all-actions";
import { z } from "zod";
import { ok, fail } from "@/lib/actions/result";
import { getActionMeta } from "@/lib/actions/registry";
import { apiResponse, bearerToken } from "@/lib/http/api-envelope";
import { getClaims, withBearerToken } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  const claims = await (token ? withBearerToken(token, getClaims) : getClaims());
  if (!claims) {
    return apiResponse(fail("unauthenticated", "Authentication required."), 401);
  }

  const list = [...getActionMeta().entries()]
    .map(([name, meta]) => ({
      name,
      permission: meta.permission,
      inputSchema: z.toJSONSchema(meta.schema, { io: "input", unrepresentable: "any" }),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return apiResponse(ok(list));
}
