import { EmptyState } from "@/components/states";
import type { SeatingChart } from "@/modules/exam-seating/schemas";

/** One seat grid per room, seats in seat_no order. */
export function SeatGrid({ chart }: { chart: SeatingChart }) {
  if (chart.rooms.every((r) => r.seats.length === 0)) {
    return <EmptyState title="No seats to show" description="This plan has no seats visible to you." />;
  }
  return (
    <div className="space-y-6">
      {chart.rooms.map(({ room, seats }) => (
        <section key={room.id} aria-labelledby={`room-${room.id}`} className="space-y-2">
          <h3 id={`room-${room.id}`} className="text-sm font-semibold">
            {room.name || "Room"} <span className="font-normal text-muted-foreground">({seats.length} seated)</span>
          </h3>
          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students seated here.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {seats.map((s) => (
                <li key={s.seatNo} className="rounded-md border border-border p-2 text-xs">
                  <span className="block font-semibold tabular-nums">Seat {s.seatNo}</span>
                  <span className="block truncate font-medium" title={s.studentName}>
                    {s.studentName}
                  </span>
                  <span className="block text-muted-foreground">
                    {s.sectionLabel} · {s.admissionNo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
