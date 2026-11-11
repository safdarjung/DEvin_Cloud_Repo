import "server-only";
import { NextResponse } from "next/server";
import { DEMO_ACCOUNT_EMAILS } from "@/lib/auth/demo-accounts";
import { signInAsDemo } from "@/lib/auth/demo-session";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { isCrossSiteRequest } from "@/lib/http/request";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click demo login as a plain form POST answered with a 303 redirect.
 * The `demoLogin` server action signed in fine, but a click in the first
 * seconds after page load lost the action's client-side redirect, so the
 * visitor stayed on the page. A full-page POST needs no client router (and
 * works before hydration). Same gates as `demoLogin`: demo hints flag on,
 * allow-listed demo email only, passwordless `signInAsDemo`.
 */
export async function POST(request: Request): Promise<Response> {
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  if (process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS !== "true" || isCrossSiteRequest(request)) {
    return redirectTo("/login");
  }

  const form = await request.formData().catch(() => null);
  const email = form?.get("email");
  if (typeof email !== "string" || !DEMO_ACCOUNT_EMAILS.includes(email)) return redirectTo("/login");

  const supabase = await createClient();
  // ?switch=1 keeps the role picker open: plain /login would auto-sign the visitor in as the default demo
  // account, so a failed click on "Parent" would silently land them in the principal's session.
  if (!(await signInAsDemo(supabase, email))) return redirectTo("/login?switch=1");

  const next = form?.get("next");
  const path = sanitizeNextPath(typeof next === "string" ? next : null);
  return redirectTo(path === "/" ? "/select" : path);
}
