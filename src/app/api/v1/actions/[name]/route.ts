import "server-only";
// Side-effect: registers every defineAction() before the lookup below.
import "../all-actions";
import { getRegisteredActions } from "@/lib/actions/registry";
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
  return dispatchCall(request, name, getRegisteredActions(), bodyResult.body);
}
