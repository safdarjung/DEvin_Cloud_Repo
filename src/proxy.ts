import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { defaultDemoEmail, demoAutoLoginEnabled, signInAsDemo } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/types";
import { hasSessionCookie, proxyDecision } from "@/proxy-decision";

// Session refresh only — never authorization. Server Actions can bypass
// proxy matchers, so every action re-verifies (04 §3, 07 §1 T13).
// Which requests get demo auto-login or a login redirect: src/proxy-decision.ts.

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Read before getClaims: a failed refresh clears the cookie on `request`.
  const hadSessionCookie = hasSessionCookie(request.cookies.getAll());

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          for (const [key, headerValue] of Object.entries(headers)) {
            response.headers.set(key, headerValue);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();

  const { pathname, searchParams } = request.nextUrl;
  const input = {
    method: request.method,
    pathname,
    searchParams,
    headers: request.headers,
    hasSessionCookie: hadSessionCookie,
    claimsValid: Boolean(data?.claims),
    autoLoginEnabled: demoAutoLoginEnabled(),
  };
  let decision = proxyDecision(input);

  // Demo-only convenience (see demoAutoLoginEnabled): a visitor with no session who
  // opens a page is signed in as the default demo account, so the demo never stops
  // at a login screen. Never for prefetches or background requests: their late
  // Set-Cookie would overwrite an account the visitor just picked.
  if (decision === "auto-login") {
    if (await signInAsDemo(supabase, defaultDemoEmail())) {
      if (pathname.split("/")[1] === "login") {
        const redirect = NextResponse.redirect(new URL(sanitizeNextPath(searchParams.get("next") ?? undefined), request.url));
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
        return redirect;
      }
      return response;
    }
    decision = proxyDecision({ ...input, autoLoginEnabled: false });
  }

  if (decision === "redirect-to-login") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // `api/jobs/` (T-037): CRON_SECRET-authenticated, no user session — the
  // route itself rejects bad/missing secrets. Without this exclusion the
  // matcher's `isTenantPath` check treats `/api/jobs/run` as a tenant path
  // and redirects every call (even an authorized cron) to `/login` before
  // the route handler ever runs. Trailing slash matters: `api/jobs` (no
  // slash) would also exclude an unrelated `/api/jobsx` route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|s/|api/public|api/jobs/).*)"],
};
