"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bookPtmSlot, cancelPtmBooking } from "@/modules/ptm/actions";

/** Book an open slot, or cancel your own booking. Server action re-checks guardianship and slot state. */
export function PtmSlotButton({
  institutionSlug,
  studentId,
  slotId,
  bookingId,
}: {
  institutionSlug: string;
  studentId: string;
  slotId: string;
  bookingId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      const result = bookingId
        ? await cancelPtmBooking(institutionSlug, { bookingId })
        : await bookPtmSlot(institutionSlug, { slotId, studentId });
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant={bookingId ? "outline" : "default"} disabled={pending} onClick={run}>
        {pending ? "Saving…" : bookingId ? "Cancel" : "Book"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
