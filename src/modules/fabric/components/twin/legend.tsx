"use client";
// F-UI-09 — node-type filter chips + the utilisation colour scale. Only the
// 4 node types the real snapshot populates are offered (twin.mapping.ts).
import { BusFront, DoorOpen, GraduationCap, Users, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { TwinNodeType } from "@/modules/fabric/types";

const TYPES: { type: TwinNodeType; label: string; icon: LucideIcon }[] = [
  { type: "student_group", label: "Sections", icon: Users },
  { type: "teacher", label: "Teachers", icon: GraduationCap },
  { type: "room", label: "Rooms", icon: DoorOpen },
  { type: "route", label: "Transport routes", icon: BusFront },
];

export function TwinLegend({
  hiddenTypes,
  onToggle,
}: {
  hiddenTypes: Set<TwinNodeType>;
  onToggle: (type: TwinNodeType) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border px-3 py-2 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map(({ type, label, icon: Icon }) => {
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={!hidden}
              onClick={() => onToggle(type)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                hidden ? "border-border text-muted-foreground" : "border-primary/40 bg-primary/10 text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-success" aria-hidden /> ≤80% OK</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-warning" aria-hidden /> ≤100% Watch</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-destructive" aria-hidden /> &gt;100% Critical</span>
      </div>
    </div>
  );
}
