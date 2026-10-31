import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

function StateBox({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <StateBox icon={<Inbox className="size-6" aria-hidden />} title={title} description={description}>
      {action}
    </StateBox>
  );
}

/** `onRetry` is only passed from client components (e.g. error.tsx). */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert">
      <StateBox icon={<AlertTriangle className="size-6 text-destructive" aria-hidden />} title={title} description={description}>
        {onRetry && (
          <Button type="button" variant="outline" className="mt-2 h-10" onClick={onRetry}>
            Try again
          </Button>
        )}
      </StateBox>
    </div>
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-1/3 animate-pulse rounded-md bg-muted" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
