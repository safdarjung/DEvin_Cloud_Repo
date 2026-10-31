"use client";

import { ErrorState } from "@/components/states";

// Never render error.message: server errors can carry internal detail.
export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      description={error.digest ? `We couldn't load this. Please try again. Reference: ${error.digest}` : undefined}
      onRetry={reset}
    />
  );
}
