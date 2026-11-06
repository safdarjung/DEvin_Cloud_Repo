"use client";

import { ErrorState } from "@/components/states";

// Never render error.message: server errors can carry internal detail.
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <ErrorState
        description={error.digest ? `We couldn't load this. Please try again. Reference: ${error.digest}` : undefined}
        onRetry={reset}
      />
    </div>
  );
}
