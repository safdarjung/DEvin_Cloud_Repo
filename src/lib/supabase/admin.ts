import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const ALLOWED_CALLERS = new Set(["seed", "reset", "jobs", "test"]);

export function createAdminClient() {
  const caller = process.env.SERVICE_ROLE_CALLER;
  if (!caller || !ALLOWED_CALLERS.has(caller)) {
    throw new Error(
      "createAdminClient: SERVICE_ROLE_CALLER must be one of seed/reset/jobs/test",
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
