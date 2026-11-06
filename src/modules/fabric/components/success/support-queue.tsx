"use client";

// F-UI-04 — support-tier students, worst attendance first. "Assign owner" is
// a LimitedBadge: owner_staff_id is set by the gap detector at plan creation
// (mastery/detector.ts, = the student's class teacher) and isn't in
// updateIntervention's column grant (migration 0093), so there's no real
// write path for reassigning it from the UI yet.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LimitedBadge } from "@/components/honesty";
import { EmptyState } from "@/components/states";
import { Stagger, StaggerItem } from "@/components/motion";
import type { StudentSuccessRow } from "@/modules/fabric/types";

export function SupportQueue({ rows, onSelect }: { rows: StudentSuccessRow[]; onSelect: (row: StudentSuccessRow) => void }) {
  const queue = rows.filter((r) => r.risk === "support").sort((a, b) => a.attendance_pct - b.attendance_pct);

  if (queue.length === 0) {
    return <EmptyState title="No students in the support queue" description="No one currently meets the support-risk threshold." />;
  }

  return (
    <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {queue.map((row) => (
        <StaggerItem key={row.student_id}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(row)}>
                  {row.name}
                </button>
                <span className="text-xs font-normal text-muted-foreground">{row.section_label}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Attendance <span className="tabular-nums font-medium text-foreground">{row.attendance_pct}%</span> · Mastery{" "}
                <span className="tabular-nums font-medium text-foreground">{row.mastery_pct}%</span>
              </p>
              {row.flags.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {row.flags.map((f) => (
                    <li key={f}>
                      <Badge variant="secondary">{f}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Owner: {row.support_owner ?? "Unassigned"}</span>
                <span title="Reassigning the owner isn't available yet — it's set automatically when the plan is proposed.">
                  <LimitedBadge />
                </span>
              </div>
            </CardContent>
          </Card>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
