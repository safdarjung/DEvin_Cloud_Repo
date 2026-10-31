"use client";

// T-027 — 06 §W4 pipeline board. Columns per configured stage; moving a
// card is a <select> (packet: "move via select — no drag dependency"), not
// drag-and-drop.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateEnquiryStatus } from "@/modules/admissions/actions";
import type { EnquiryRow } from "@/modules/admissions/queries";
import { humanize } from "@/lib/format";

interface PipelineBoardProps {
  institutionSlug: string;
  stages: string[];
  byStage: Record<string, EnquiryRow[]>;
}

export function PipelineBoard({ institutionSlug, stages, byStage }: PipelineBoardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function moveTo(enquiryId: string, status: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateEnquiryStatus(institutionSlug, { enquiryId, status });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* The board scrolls sideways inside this box, never the page. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const items = byStage[stage] ?? [];
          return (
            <Card key={stage} size="sm" className="min-w-64 flex-1">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>{humanize(stage)}</CardTitle>
                <Badge variant="secondary">{items.length}</Badge>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <EmptyState title="No enquiries" />
                ) : (
                  <ul className="space-y-2">
                    {items.map((enquiry) => (
                      <li key={enquiry.id} className="space-y-1.5 rounded-md border border-border bg-background p-2.5">
                        <Link
                          href={`/${institutionSlug}/admissions/enquiries/${enquiry.id}`}
                          className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {enquiry.childName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{enquiry.guardianName}</p>
                        {stage !== "converted" && (
                          <Select disabled={pending} value={stage} onValueChange={(next) => moveTo(enquiry.id, next)}>
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {stages
                                .filter((s) => s !== "converted")
                                .map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {humanize(s)}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
