import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// "ai" (T-035): ai_usage_events has no INSERT policy and its SELECT policy
// is owner/principal/admin only (07 §4, platform migration), but
// `ai.generate` is granted to teachers too — the gateway reads/writes usage
// metadata (never prompt text) on their behalf via the service role.
// "public_enquiry" (T-024): public.submit_public_enquiry is granted to
// service_role only (07 §4, 20261028000007) — neither anon nor authenticated
// may call it directly, so the public enquiry route is its sole caller.
// "payments_webhook" (M12-T12): public.record_online_payment is granted to
// service_role only (07 §4, 20261028000083) — the Razorpay webhook route is
// its sole caller, after its own HMAC signature verification.
// "agents" (M22-T7): agent_definitions/agent_runs have no authenticated
// insert/update path (07 §4, 20261028000095) — src/modules/agents/actions.ts
// writes through src/modules/agents/service-role.ts after its own
// permission + module checks, institution_id always from ctx.
// "briefings" (M25-T4): briefings has no INSERT/UPDATE policy (0092) —
// src/modules/insights/briefings.ts writes through
// src/modules/insights/briefings.service-role.ts after its own permission
// + module checks, institution_id always from ctx.
// "school_start" (F18 §H): /api/public/start peeks the invite code, creates
// the owner's auth user (sign-up is disabled) and deletes that same user if
// the school is not created — src/modules/core/setup/with-service-role.ts.
const ALLOWED_CALLERS = new Set([
  "seed",
  "reset",
  "jobs",
  "test",
  "ai",
  "public_enquiry",
  "payments_webhook",
  "agents",
  "briefings",
  "school_start",
]);

export function createAdminClient() {
  const caller = process.env.SERVICE_ROLE_CALLER;
  if (!caller || !ALLOWED_CALLERS.has(caller)) {
    throw new Error(
      "createAdminClient: SERVICE_ROLE_CALLER must be one of seed/reset/jobs/ai/public_enquiry/payments_webhook/agents/briefings/school_start/test",
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
