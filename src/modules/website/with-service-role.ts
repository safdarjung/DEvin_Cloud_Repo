import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// T-024's enquiry route (`src/app/api/public/enquiry/route.ts`) is the only
// caller of `public.submit_public_enquiry`, which is granted to
// `service_role` only (07 §4). Scoped to this synchronous factory call and
// restored in `finally`, exactly like `withJobsServiceRole`
// (src/modules/jobs/with-service-role.ts) and `withAiServiceRole` — never
// left set for the rest of the process, since `SERVICE_ROLE_CALLER` is a
// process-wide env var.
export function withPublicEnquiryServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "public_enquiry";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function createPublicEnquiryAdminClient() {
  return withPublicEnquiryServiceRole(() => createAdminClient());
}
