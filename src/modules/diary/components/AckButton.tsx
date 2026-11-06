"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acknowledgeDiaryEntry } from "@/modules/diary/actions";

/** Guardian acknowledges a diary entry for one child. Server action re-checks permission and RLS. */
export function AckButton({ institutionSlug, studentId, entryId }: { institutionSlug: string; studentId: string; entryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const result = await acknowledgeDiaryEntry(institutionSlug, { entryId, studentId });
      if (result.ok) {
        toast.success("Acknowledged.");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });

  return (
    <Button type="button" size="sm" variant="outline" className="min-h-10 shrink-0" disabled={pending} onClick={run}>
      {pending ? "Saving…" : "Acknowledge"}
    </Button>
  );
}
