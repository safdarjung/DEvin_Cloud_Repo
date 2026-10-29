"use client";

// T-027 — 06 §W4 pipeline board. Columns per configured stage; moving a
// card is a <select> (packet: "move via select — no drag dependency"), not
// drag-and-drop.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateEnquiryStatus } from "@/modules/admissions/actions";
import type { EnquiryRow } from "@/modules/admissions/queries";

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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => (
          <div key={stage} className="min-w-64 flex-1 rounded-lg border border-border">
            <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">
              {stage} <span className="text-muted-foreground">({byStage[stage]?.length ?? 0})</span>
            </div>
            <ul className="divide-y divide-border">
              {(byStage[stage] ?? []).map((enquiry) => (
                <li key={enquiry.id} className="space-y-1.5 p-2.5">
                  <Link
                    href={`/${institutionSlug}/admissions/enquiries/${enquiry.id}`}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {enquiry.childName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{enquiry.guardianName}</p>
                  {stage !== "converted" && (
                    <Select
                      disabled={pending}
                      value={stage}
                      onValueChange={(next) => moveTo(enquiry.id, next)}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages
                          .filter((s) => s !== "converted")
                          .map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
