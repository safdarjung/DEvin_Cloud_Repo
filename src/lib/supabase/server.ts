import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { JwtPayload } from "@supabase/supabase-js";
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
