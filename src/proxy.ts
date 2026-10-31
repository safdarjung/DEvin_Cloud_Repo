import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_ACCOUNT_EMAILS } from "@/lib/auth/demo-accounts";
import type { Database } from "@/lib/db/types";

// Session refresh only — never authorization. Server Actions can bypass
// proxy matchers, so every action re-verifies (04 §3, 07 §1 T13).
const NON_TENANT_FIRST_SEGMENTS = new Set(["login", "logout"]);

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

  // Demo-only convenience, off unless DEMO_AUTO_LOGIN=true: a visitor with no
  // session is signed in server-side as one allow-listed demo account (a real
  // session, so RLS still applies). /login and /logout are skipped so the role
  // picker still works and logging out sticks until the next visit elsewhere.
  if (!data?.claims && process.env.DEMO_AUTO_LOGIN === "true" && !NON_TENANT_FIRST_SEGMENTS.has(firstSegment)) {
    const email = process.env.DEMO_AUTO_LOGIN_AS ?? "principal@demo.coolskool.test";
    if (DEMO_ACCOUNT_EMAILS.includes(email)) {
      await supabase.auth.signInWithPassword({ email, password: process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026" });
      data = (await supabase.auth.getClaims()).data;
    }
  }
  const isTenantPath = pathname !== "/" && !NON_TENANT_FIRST_SEGMENTS.has(firstSegment);

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
