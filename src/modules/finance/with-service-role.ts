import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// T12's webhook route (`src/app/api/public/payments/razorpay/route.ts`) is
// the only caller of `public.record_online_payment`, which is granted to
// `service_role` only (07 §4, 20261028000083). Scoped to this synchronous
// factory call and restored in `finally`, exactly like
// `withPublicEnquiryServiceRole` (src/modules/website/with-service-role.ts)
// and `withJobsServiceRole` — never left set for the rest of the process,
// since `SERVICE_ROLE_CALLER` is a process-wide env var.
export function withPaymentsWebhookServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "payments_webhook";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

export function createPaymentsWebhookAdminClient() {
  return withPaymentsWebhookServiceRole(() => createAdminClient());
}
