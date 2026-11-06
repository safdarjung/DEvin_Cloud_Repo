import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading agents…</span>
      <Skeleton className="h-8 w-32" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
