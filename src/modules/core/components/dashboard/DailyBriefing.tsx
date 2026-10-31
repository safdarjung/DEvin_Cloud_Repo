"use client";

// T-0NN — "Summarize today" trigger above the KPI tiles (CLAUDE.md rule 7).
// Button-triggered, not on-mount, so viewing the dashboard never spends an
// AI call by itself. Receives the SAME numbers `DashboardPage` already
// fetched via `getDashboardData` as props — never fetches or re-derives
// them itself. POSTs to `/api/ai/dashboard-briefing`, which persists
// nothing; the KPI tiles below remain the source of truth regardless of
// whether a briefing could be generated (quiet failure, mirrors
// `QuizGenerateButton`).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LimitedBadge } from "@/components/honesty";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

interface DailyBriefingCollections {
  collectedPaise: number;
  duePaise: number;
}

interface DailyBriefingProps {
  institutionSlug: string;
  attendancePercent?: number;
  sectionsAtRiskCount?: number;
  openEnquiries: number;
  enrolledCount: number;
  collections: DailyBriefingCollections | null;
}

interface BriefingData {
  summary: string;
  provider: "local" | "cloud";
  model: string;
  fallback: boolean;
}

type BriefingResponseBody = { ok: true; data: BriefingData } | { ok: false; error: { code: string; message: string } };

export function DailyBriefing({
  institutionSlug,
  attendancePercent,
  sectionsAtRiskCount,
  openEnquiries,
  enrolledCount,
  collections,
}: DailyBriefingProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BriefingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSummarize() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/dashboard-briefing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          institutionSlug,
          attendancePercent,
          sectionsAtRiskCount,
          openEnquiries,
          enrolledCount,
          collections,
        }),
      });
      const body = (await res.json()) as BriefingResponseBody;
      if (!body.ok) {
        setError(body.error.message);
        return;
      }
      setResult(body.data);
    } catch {
      setError("Could not reach the server; the numbers below are unaffected.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-sm">{result.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          <LimitedBadge />
          <ProviderBadge provider={result.provider} />
          <span className="text-muted-foreground text-xs">AI-written summary — the numbers below are the source of truth.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium text-sm">AI daily briefing</h2>
        <LimitedBadge />
      </div>
      <p className="text-muted-foreground text-sm">A short plain-language summary of today&apos;s attendance, admissions and fees. A suggestion only; the numbers below are the source of truth.</p>
      <Button type="button" variant="outline" size="sm" onClick={handleSummarize} disabled={pending}>
        {pending ? "Summarizing…" : "Summarize today"}
      </Button>
      {error && <p className="text-muted-foreground text-xs">{error}</p>}
    </div>
  );
}
