import "server-only";
// Side-effect: registers every defineQuery() before the lookup below.
import "../all-queries";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import type { ActionResult } from "@/lib/actions/result";
import { fail } from "@/lib/actions/result";
import { apiResponse } from "@/lib/http/api-envelope";
import { toCsvResponse } from "@/lib/http/csv";
import { dispatchCall, readPostBody } from "@/lib/http/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const bodyResult = await readPostBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const { name } = await params;
  return dispatchCall(request, name, getRegisteredQueries(), bodyResult.body);
}

// GET mirrors POST for reads: a query call carries no side effects, so the
// body comes from search params instead of a JSON POST body. No Origin
// check here (unlike readPostBody) — a GET can't carry a cross-site body.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  const url = new URL(request.url);
  const institution = url.searchParams.get("institution") ?? undefined;
  const rawInput = url.searchParams.get("input");

  let input: unknown;
  if (rawInput !== null) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      return apiResponse(fail("validation_failed", "Query param `input` must be JSON."), 400);
    }
  }

  const response = await dispatchCall(request, name, getRegisteredQueries(), { institution, input });

  // M04-T7: ?format=csv exports the same result dispatchCall already
  // computed — read its JSON body back out and re-wrap, nothing else here
  // changes.
  if (url.searchParams.get("format") !== "csv") return response;
  const result = (await response.json()) as ActionResult<unknown>;
  return toCsvResponse(result, name);
}
