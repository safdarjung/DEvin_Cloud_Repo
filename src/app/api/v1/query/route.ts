import "server-only";
// Side-effect: registers every defineQuery() before the listing below.
import "./all-queries";
import { getQueryMeta } from "@/lib/actions/define-query";
import { listResponse } from "@/lib/http/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return listResponse(request, getQueryMeta());
}
