import { Skeleton } from "@/components/ui/skeleton";

// Matches the login form column.
export default function AuthLoading() {
  return (
    <main role="status" aria-busy="true" className="grid min-h-screen place-items-center px-4">
      <span className="sr-only">Loading…</span>
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </main>
  );
}
