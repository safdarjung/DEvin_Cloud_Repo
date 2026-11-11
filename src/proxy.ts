import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { defaultDemoEmail, demoAutoLoginEnabled, signInAsDemo } from "@/lib/auth/demo-session";
import type { Database } from "@/lib/db/types";
import { isMarketingPath } from "@/lib/marketing/routes";

// Session refresh only — never authorization. Server Actions can bypass
// proxy matchers, so every action re-verifies (04 §3, 07 §1 T13).
// "start": public invite-code sign-up (F18 §H), reached with no session.
const NON_TENANT_FIRST_SEGMENTS = new Set(["login", "logout", "start"]);

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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

  let { data } = await supabase.auth.getClaims();

  const pathname = request.nextUrl.pathname;
  const firstSegment = pathname.split("/")[1] ?? "";

  // Demo-only convenience (see demoAutoLoginEnabled): a visitor with no session
  // is signed in as a demo account, so the demo never stops at a login screen.
  // /login?switch=1 and /logout are left alone so the role picker still works.
  const isLogin = firstSegment === "login";
  const wantsPicker = request.nextUrl.searchParams.has("switch");
  const isMarketing = isMarketingPath(pathname) && firstSegment !== "select";
  if (!data?.claims && demoAutoLoginEnabled() && !isMarketing && firstSegment !== "logout" && firstSegment !== "start" && !(isLogin && wantsPicker)) {
    if (await signInAsDemo(supabase, defaultDemoEmail())) {
      data = (await supabase.auth.getClaims()).data;
      if (isLogin) {
        const redirect = NextResponse.redirect(new URL(sanitizeNextPath(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
        return redirect;
      }
    }
  }

  const isTenantPath = !isMarketingPath(pathname) && !NON_TENANT_FIRST_SEGMENTS.has(firstSegment);

  if (isTenantPath && !data?.claims) {
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
