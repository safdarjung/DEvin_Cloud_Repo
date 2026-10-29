import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// Opt-in mock for `@/lib/supabase/server` (T-022 lead review). The real
// module calls `next/headers` `cookies()`, which only works inside a real
// Next.js request — so action/query handlers can't be exercised directly
// from Vitest against the real module. A test file opts in per-file with:
//
//   vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
//
// `callAs` (tests/helpers/actions.ts) then points this at the fixture's
// real signed-in client for the role being tested (real JWT, real RLS)
// before invoking the action, and clears it after. Never mock this
// globally — every other db test file must keep using the real module.
let actingClient: SupabaseClient<Database> | null = null;

export function setActingClient(client: SupabaseClient<Database> | null): void {
  actingClient = client;
}

export async function createClient(): Promise<SupabaseClient<Database>> {
  if (!actingClient) {
    throw new Error(
      "server-client-mock: no acting client set — call setActingClient() (callAs does this) before invoking an action/query under this mock.",
    );
  }
  return actingClient;
}

export async function getClaims(): Promise<JwtPayload | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return data.claims;
}
