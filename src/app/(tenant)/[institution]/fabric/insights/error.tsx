"use client";

import { ErrorState } from "@/components/states";

export default function InsightsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Could not load insights" onRetry={reset} />;
}
