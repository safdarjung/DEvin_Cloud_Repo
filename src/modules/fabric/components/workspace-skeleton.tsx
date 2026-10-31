import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder first screen (3 KPIs, chart, list) shown until a workspace's packet lands. */
export function WorkspaceSkeleton({ packet }: { packet: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">This workspace arrives in packet {packet}.</p>
    </div>
  );
}
