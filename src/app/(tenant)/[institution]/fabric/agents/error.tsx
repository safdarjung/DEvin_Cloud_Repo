"use client";

import { ErrorState } from "@/components/states";

export default function AgentsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Could not load agents" onRetry={reset} />;
}
