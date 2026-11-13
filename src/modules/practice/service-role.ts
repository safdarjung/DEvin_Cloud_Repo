import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db/types";

// 0151: public.create_ai_practice_session is granted to service_role only, so a
// student can never write the answer key of their own AI practice quiz.
// /api/ai/practice-quiz is its sole caller, after its own student, module,
// capability and unit checks; institution and student always come from ctx.
// Scoped to the synchronous call like ai/tasks/service-role.ts.
function withPracticeServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "practice";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function practiceAdmin(): SupabaseClient<Database> {
  return withPracticeServiceRole(() => createAdminClient());
}
