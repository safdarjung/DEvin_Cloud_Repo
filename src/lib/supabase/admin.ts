import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// "ai" (T-035): ai_usage_events has no INSERT policy and its SELECT policy
// is owner/principal/admin only (07 §4, platform migration), but
// `ai.generate` is granted to teachers too — the gateway reads/writes usage
// metadata (never prompt text) on their behalf via the service role.
const ALLOWED_CALLERS = new Set(["seed", "reset", "jobs", "test", "ai"]);

export function createAdminClient() {
  const caller = process.env.SERVICE_ROLE_CALLER;
  if (!caller || !ALLOWED_CALLERS.has(caller)) {
    throw new Error(
      "createAdminClient: SERVICE_ROLE_CALLER must be one of seed/reset/jobs/ai/test",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("createAdminClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
