import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// F18 §H — the only caller is src/app/api/public/start/route.ts: it records the
// attempt (public.record_school_start_attempt, the rate limit) and peeks the
// invite code (both service_role only), creates
// the owner's auth user (local auth has sign-up disabled) and deletes that
// same user when the school is not created. Same scoped-env shape as
// src/modules/website/with-service-role.ts: SERVICE_ROLE_CALLER is
// process-wide, so it is set only for the synchronous factory call.
export function createSchoolStartAdminClient() {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "school_start";
  try {
    return createAdminClient();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}
