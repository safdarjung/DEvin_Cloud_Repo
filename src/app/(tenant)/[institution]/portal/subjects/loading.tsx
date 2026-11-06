import { Skeleton } from "@/components/ui/skeleton";

export default function PortalSubjectsLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
