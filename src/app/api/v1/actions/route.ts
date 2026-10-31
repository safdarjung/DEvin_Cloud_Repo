import "server-only";
// Side-effect: registers every defineAction() before the listing below.
import "./all-actions";
import { getActionMeta } from "@/lib/actions/registry";
import { listResponse } from "@/lib/http/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return listResponse(request, getActionMeta());
}
