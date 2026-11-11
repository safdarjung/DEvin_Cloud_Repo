"use client";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";

export default function AnalysisLabError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div data-fabric-ws="lab" className="space-y-4">
      <PageHeader title="Analysis lab" />
      <ErrorState title="Could not load the analysis lab" onRetry={reset} />
    </div>
  );
}
