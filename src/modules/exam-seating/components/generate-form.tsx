"use client";

// Generate (or regenerate) the seating plan for one slot. Hiding this is UX only: the action re-checks `exam.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { generateSeatingPlan } from "@/modules/exam-seating/actions";

export function GenerateSeatingForm({
  institutionSlug,
  examId,
  slotStart,
  studentCount,
  rooms,
  hasPlan,
}: {
  institutionSlug: string;
  examId: string;
  slotStart: string;
  studentCount: number;
  rooms: { id: string; name: string; capacity: number }[];
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const capacity = rooms.filter((r) => picked.includes(r.id)).reduce((n, r) => n + r.capacity, 0);
  const short = picked.length > 0 && capacity < studentCount;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await generateSeatingPlan(institutionSlug, { examId, slotStart, rooms: picked.map((roomId) => ({ roomId })) });
      if (res.ok) {
        setError(null);
        toast.success(`Seating plan v${res.data.versionNo} generated: ${res.data.seatCount} seats`);
        router.refresh();
      } else {
        const msg = describeActionError(res.error);
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Rooms for this slot ({studentCount} students)</legend>
        {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms set up yet. Add rooms in the timetable module first.</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {rooms.map((r) => (
            <label key={r.id} className="flex min-h-8 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(r.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id))}
              />
              {r.name} <span className="text-muted-foreground">({r.capacity} seats)</span>
            </label>
          ))}
        </div>
      </fieldset>
      {short && (
        <p role="status" className="text-xs text-muted-foreground">
          Selected rooms hold {capacity} seats for {studentCount} students. Add a room.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || picked.length === 0}>
        {pending ? "Generating…" : hasPlan ? "Regenerate plan" : "Generate plan"}
      </Button>
      {picked.length === 0 && rooms.length > 0 && <p className="text-xs text-muted-foreground">Tick at least one room to generate the plan.</p>}
    </form>
  );
}
