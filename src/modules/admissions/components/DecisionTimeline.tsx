// T-027 — decision timeline for ApplicationDetail. Pure presentational.
// Also hosts the admissions status→Badge helpers: applications/page.tsx is a
// server component, so the helper must live in a non-"use client" module.
import type { ComponentProps } from "react";
import { EmptyState } from "@/components/states";
import type { Badge } from "@/components/ui/badge";
import type { ApplicationDecisionRow } from "@/modules/admissions/queries";

type Variant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

// applications.status check: 20261028000007_admissions.sql
export function applicationStatusVariant(status: string): Variant {
  switch (status) {
    case "accepted":
    case "enrolled":
      return "success";
    case "submitted":
    case "under_review":
    case "interaction_scheduled":
    case "offered":
      return "info";
    case "withdrawn":
      return "warning";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function DecisionTimeline({ decisions }: { decisions: ApplicationDecisionRow[] }) {
  if (decisions.length === 0) {
    return <EmptyState title="No decisions recorded yet" />;
  }

  return (
    <ul className="space-y-2">
      {decisions.map((d) => (
        <li key={d.id} className="rounded-md border border-border p-2.5 text-sm">
          <p className="font-medium capitalize">{d.decision}</p>
          {d.note && <p className="text-muted-foreground">{d.note}</p>}
          <p className="text-muted-foreground text-xs">{d.createdAt}</p>
        </li>
      ))}
    </ul>
  );
}
