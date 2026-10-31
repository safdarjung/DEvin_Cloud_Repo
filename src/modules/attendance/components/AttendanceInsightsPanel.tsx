"use client";

// New — client half of the attendance-pattern-insight panel. Sends ONLY
// `patterns` (index + counts/booleans, zero PII) to the AI route; `names`
// is used purely to label the response locally, never sent over the wire.
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnonymizedAttendancePattern } from "@/modules/attendance/queries";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

interface AttendanceInsightItem {
  index: number;
  note: string;
}

interface AttendanceInsightsPanelProps {
  institutionSlug: string;
  sectionId: string;
  patterns: AnonymizedAttendancePattern[];
  /** Real student names, server-resolved — index-aligned with `patterns`. */
  names: string[];
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; items: AttendanceInsightItem[]; provider: "local" | "cloud" };

/**
 * shortcut: button-triggered, not on-mount — an unusual-pattern check
 * spends an AI call (quota + concurrency slot + latency) every time it
 * runs; a teacher who never opens this panel pays nothing, and the common
 * case (quickly checking today's register) isn't blocked on it. Upgrade
 * to on-mount only if product wants the flag surfaced without a click.
 */
export function AttendanceInsightsPanel({ institutionSlug, sectionId, patterns, names }: AttendanceInsightsPanelProps) {
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function check() {
    setState({ kind: "loading" });
    startTransition(async () => {
      try {
        const res = await fetch("/api/ai/attendance-insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ institutionSlug, classSectionId: sectionId, students: patterns }),
        });
        const body = await res.json();
        if (!body.ok) {
          setState({ kind: "error", message: body.error?.message ?? "Could not check attendance patterns." });
          return;
        }
        setState({ kind: "done", items: body.data.items, provider: body.data.provider });
      } catch {
        setState({ kind: "error", message: "Could not check attendance patterns." });
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Attendance patterns</CardTitle>
        {/* Fix round 1 (LOW-2): every other AI surface shows ProviderBadge
            (07 §5 transparency) — this one was missing it. The "not a
            grade" framing stays as a second, feature-specific badge. */}
        {state.kind === "done" && (
          <div className="flex gap-1">
            <ProviderBadge provider={state.provider} />
            <Badge variant="outline">Not a grade</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {state.kind === "idle" && (
          <Button type="button" size="sm" variant="outline" onClick={check} disabled={pending}>
            Check for unusual attendance patterns
          </Button>
        )}
        {state.kind === "loading" && <p className="text-muted-foreground text-sm">Checking…</p>}
        {state.kind === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
        {state.kind === "done" && state.items.length === 0 && (
          <p className="text-muted-foreground text-sm">No unusual attendance patterns flagged.</p>
        )}
        {state.kind === "done" && state.items.length > 0 && (
          <ul className="space-y-1 text-sm">
            {state.items.map((item) => (
              <li key={item.index}>
                <span className="font-medium">{names[item.index] ?? "Unknown"}</span> — {item.note}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
