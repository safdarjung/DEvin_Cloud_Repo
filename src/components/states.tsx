import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

function StateBox({ icon, title, description, bare, children }: { icon: ReactNode; title: string; description?: string; bare?: boolean; children?: ReactNode }) {
  return (
    <div className={bare ? "flex flex-col items-center gap-2 px-4 py-8 text-center" : "flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-10 text-center"}>
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

/** `bare`: no border/background, for use inside a Card. */
export function EmptyState({ title, description, action, bare }: { title: string; description?: string; action?: ReactNode; bare?: boolean }) {
  return (
    <StateBox icon={<Inbox className="size-6" aria-hidden />} title={title} description={description} bare={bare}>
      {action}
    </StateBox>
  );
}

/** `onRetry` is only passed from client components (e.g. error.tsx). */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Please try again.",
  onRetry,
  bare,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** No border/background, for use inside a Card. */
  bare?: boolean;
}) {
  return (
    <div role="alert">
      <StateBox icon={<AlertTriangle className="size-6 text-destructive" aria-hidden />} title={title} description={description} bare={bare}>
        {onRetry && (
          <Button type="button" variant="outline" className="mt-2" onClick={onRetry}>
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
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
