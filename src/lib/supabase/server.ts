import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient, type JwtPayload } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export async function createClient() {
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
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
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
