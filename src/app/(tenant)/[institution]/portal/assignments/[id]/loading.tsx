import { Skeleton } from "@/components/ui/skeleton";

export default function PortalAssignmentLoading() {
  return (
    <div role="status" aria-busy="true" className="max-w-2xl space-y-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
