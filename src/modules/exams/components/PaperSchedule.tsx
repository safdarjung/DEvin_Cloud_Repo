"use client";

// Date / time / room per paper via exam.paper.schedule. Rows with a date and time are saved;
// rows left blank are skipped (nothing is cleared from here).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeActionError } from "@/lib/action-error";
import { schedulePapers } from "@/modules/exams/actions";

export interface SchedulePaperRow {
  id: string;
  label: string;
  date: string;
  time: string;
  durationMinutes: number;
  roomId: string;
}

const DEFAULT_DURATION = 180;

/** Institution-local date + time -> ISO instant, by measuring the zone's offset at that moment. */
function zonedToIso(date: string, time: string, timeZone: string): string {
  const asUtc = new Date(`${date}T${time}:00Z`).getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(asUtc));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(asUtc - (shown - asUtc)).toISOString();
}

export function PaperSchedule({
  institutionSlug,
  examId,
  papers,
  rooms,
  timeZone,
}: {
  institutionSlug: string;
  examId: string;
  papers: SchedulePaperRow[];
  rooms: { id: string; name: string }[];
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(papers);
  const [error, setError] = useState<string | null>(null);

  const patch = (id: string, change: Partial<SchedulePaperRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const ready = rows.filter((r) => r.date && r.time);

  function save() {
    setError(null);
    start(async () => {
      const res = await schedulePapers(institutionSlug, {
        examId,
        papers: ready.map((r) => ({
          paperId: r.id,
          scheduledAt: zonedToIso(r.date, r.time, timeZone),
          durationMinutes: r.durationMinutes,
          roomId: r.roomId || null,
        })),
      });
      if (!res.ok) {
        const msg = describeActionError(res.error);
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Scheduled ${res.data.updated} paper${res.data.updated === 1 ? "" : "s"}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="p-2 font-medium">Paper</th>
              <th className="p-2 font-medium">Date</th>
              <th className="p-2 font-medium">Time</th>
              <th className="p-2 font-medium">Minutes</th>
              <th className="p-2 font-medium">Room</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{r.label}</td>
                <td className="p-2">
                  <Input type="date" aria-label={`${r.label} date`} value={r.date} onChange={(e) => patch(r.id, { date: e.target.value })} className="w-40" />
                </td>
                <td className="p-2">
                  <Input type="time" aria-label={`${r.label} time`} value={r.time} onChange={(e) => patch(r.id, { time: e.target.value })} className="w-32" />
                </td>
                <td className="p-2">
                  <Input
                    type="number"
                    min={15}
                    max={300}
                    aria-label={`${r.label} duration in minutes`}
                    value={r.durationMinutes}
                    onChange={(e) => patch(r.id, { durationMinutes: Number(e.target.value) || DEFAULT_DURATION })}
                    className="w-24"
                  />
                </td>
                <td className="p-2">
                  <select
                    aria-label={`${r.label} room`}
                    value={r.roomId}
                    onChange={(e) => patch(r.id, { roomId: e.target.value })}
                    className="h-10 w-40 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">No room</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={save} disabled={pending || ready.length === 0}>
        {pending ? "Saving…" : `Save schedule (${ready.length} of ${rows.length})`}
      </Button>
      {ready.length === 0 && <p className="text-xs text-muted-foreground">Enter a date and time for at least one paper.</p>}
    </div>
  );
}
