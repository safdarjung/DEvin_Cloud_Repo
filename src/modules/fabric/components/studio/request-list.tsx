// F-UI-12 (live-fabric studio lane) — status board. Server component: card
// links carry ?request=<id>, the page re-fetches and selects server-side.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudioRequestRecord, StudioRequestStatus } from "@/modules/fabric/studio.queries";

const BOARD_COLUMNS: { status: StudioRequestStatus; label: string }[] = [
  { status: "submitted", label: "Submitted" },
  { status: "proposed", label: "Proposed" },
  { status: "approved", label: "Approved" },
  { status: "in_progress", label: "In progress" },
  { status: "delivered", label: "Delivered" },
];

const STATUS_VARIANT: Record<StudioRequestStatus, "secondary" | "info" | "success" | "warning" | "destructive"> = {
  submitted: "secondary",
  proposed: "info",
  approved: "success",
  in_progress: "warning",
  delivered: "success",
  rejected: "destructive",
};

function RequestCard({ base, request, selected }: { base: string; request: StudioRequestRecord; selected: boolean }) {
  return (
    <Link
      href={`${base}?request=${request.id}`}
      aria-current={selected ? "page" : undefined}
      className={`block min-h-11 rounded-lg border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-primary bg-primary/5" : "hover:bg-muted"
      }`}
    >
      <p className="truncate text-sm font-medium">{request.title}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{request.problem}</p>
    </Link>
  );
}

export function RequestList({
  base,
  items,
  selectedId,
}: {
  base: string;
  items: StudioRequestRecord[];
  selectedId?: string;
}) {
  const rejected = items.filter((r) => r.status === "rejected");

  return (
    <div className="space-y-4">
      {/* Mobile: a filterable list, grouped the same way, read top to bottom. */}
      <div className="space-y-4 lg:hidden">
        {BOARD_COLUMNS.map(({ status, label }) => {
          const rows = items.filter((r) => r.status === status);
          if (rows.length === 0) return null;
          return (
            <div key={status} className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{label}</p>
              {rows.map((r) => (
                <RequestCard key={r.id} base={base} request={r} selected={r.id === selectedId} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="hidden gap-3 lg:grid lg:grid-cols-5">
        {BOARD_COLUMNS.map(({ status, label }) => {
          const rows = items.filter((r) => r.status === status);
          return (
            <Card key={status} className="gap-2">
              <CardHeader className="px-3 pt-3 pb-0">
                <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                  {label}
                  <Badge variant={STATUS_VARIANT[status]}>{rows.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3">
                {rows.map((r) => (
                  <RequestCard key={r.id} base={base} request={r} selected={r.id === selectedId} />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {rejected.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium text-muted-foreground">Rejected ({rejected.length})</p>
          <div className="space-y-2">
            {rejected.map((r) => (
              <RequestCard key={r.id} base={base} request={r} selected={r.id === selectedId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
