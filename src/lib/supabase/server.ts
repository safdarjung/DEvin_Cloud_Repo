import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient, type JwtPayload } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// M01-T2: opt-in bearer-token scope for the HTTP dispatcher. Only
// withBearerToken sets this — createClient/getClaims never read the
// Authorization header on their own, so every other caller is unaffected.
const bearerTokenStore = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with `token` as the bearer token for any `createClient()` /
 * `getClaims()` call inside it (including nested async calls). Scope does
 * not leak past `fn`'s resolution — AsyncLocalStorage is request-local.
 */
export async function withBearerToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return bearerTokenStore.run(token, fn);
}

export async function createClient() {
  const bearerToken = bearerTokenStore.getStore();
  if (bearerToken !== undefined) {
    return createSupabaseClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      },
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // proxy.ts refreshes the session on the next request instead.
          }
        },
      },
    },
  );
}

/**
 * Verifies the session JWT (re-validates, refreshes if expired) instead of
 * trusting the session cookie — never use `getSession()` for a trust
 * decision (07 §1 T13).
 */
export async function getClaims(): Promise<JwtPayload | null> {
  const bearerToken = bearerTokenStore.getStore();
  const supabase = await createClient();
  const { data, error } = bearerToken !== undefined
    ? await supabase.auth.getClaims(bearerToken)
    : await supabase.auth.getClaims();
  if (error || !data) return null;
  return data.claims;
}

/**
 * T-024 — the public site renderer's only data client. Plain supabase-js,
 * not `createServerClient` from `@supabase/ssr`: it never reads or sends
 * cookies, so a staff member browsing `/s/[slug]` while signed in still
 * gets the plain `anon` role, never their session. RLS class P (05 §5) is
 * the sole access boundary for every query made with this client.
 */
export function createAnonClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
