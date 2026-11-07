import { Widget, type WidgetProps } from "@/components/widgets/widget";

export interface StaffAvailability {
  present: number;
  onLeave: number;
  absent: number;
  onLeaveStaff: { name: string; role: string; /** Pre-formatted, e.g. "Back Mon". */ until: string }[];
}

export function StaffAvailabilityWidget({
  present,
  onLeave,
  absent,
  onLeaveStaff,
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & StaffAvailability) {
  const counts = [
    { label: "Present", n: present, tone: "text-success" },
    { label: "On leave", n: onLeave, tone: "text-warning" },
    { label: "Absent", n: absent, tone: "text-destructive" },
  ];
  return (
    <Widget {...frame}>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {counts.map((c) => (
          <div key={c.label} className="rounded-lg bg-secondary px-2 py-2">
            <dd className={`text-xl font-semibold tabular-nums ${c.tone}`}>{c.n}</dd>
            <dt className="text-xs text-muted-foreground">{c.label}</dt>
          </div>
        ))}
      </dl>
      {onLeaveStaff.length > 0 && (
        <ul className="mt-3 divide-y">
          {onLeaveStaff.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">{s.role}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{s.until}</span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
