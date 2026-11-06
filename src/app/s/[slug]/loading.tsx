import { Skeleton } from "@/components/ui/skeleton";

// Matches the public page body inside the site shell (max-w-5xl, px-4).
export default function PublicSiteLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-6 py-10">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-10 w-2/3 max-w-md" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-4 w-4/5 max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
