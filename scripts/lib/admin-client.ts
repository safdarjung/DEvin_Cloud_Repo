import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/db/types.ts";

// Mirrors src/lib/supabase/admin.ts's guard, duplicated here on purpose:
// that file does `import "server-only"` and uses `@/` path aliases, both of
// which only resolve inside Next's own bundler (webpack/turbopack sets the
// `react-server` condition that makes `server-only` safe; plain `node` has
// no alias resolution at all). Scripts run as plain Node processes outside
// Next entirely, so they need their own copy of the same allow-list check.
// "invite": scripts/invite-create.ts (F18 §H) inserts platform_invite_codes.
const ALLOWED_CALLERS = new Set(["seed", "reset", "jobs", "invite", "test"]);

export function createScriptAdminClient() {
  const caller = process.env.SERVICE_ROLE_CALLER;
  if (!caller || !ALLOWED_CALLERS.has(caller)) {
    throw new Error(
      "createScriptAdminClient: SERVICE_ROLE_CALLER must be one of seed/reset/jobs/invite/test",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "createScriptAdminClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY",
    );
  }

  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
