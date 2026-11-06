// F-UI-04 — small presentational pieces shared by roster/drawer/support-queue.
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { StudentSuccessRow } from "@/modules/fabric/types";

const RISK_LABEL: Record<StudentSuccessRow["risk"], string> = { none: "On track", watch: "Watch", support: "Support" };
const RISK_TONE: Record<StudentSuccessRow["risk"], "secondary" | "outline" | "destructive"> = {
  none: "outline",
  watch: "secondary",
  support: "destructive",
};
const TREND_ICON = { up: ArrowUpRight, flat: ArrowRight, down: ArrowDownRight } as const;

export function RiskChip({
  risk,
  pressed,
  onClick,
}: {
  risk: StudentSuccessRow["risk"];
  pressed?: boolean;
  onClick?: () => void;
}) {
  const label = RISK_LABEL[risk];
  if (!onClick) return <Badge variant={RISK_TONE[risk]}>{label}</Badge>;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge variant={pressed ? RISK_TONE[risk] : "outline"}>{label}</Badge>
    </button>
  );
}

export function TrendIcon({ trend }: { trend: StudentSuccessRow["trend"] }) {
  const Icon = TREND_ICON[trend];
  return <Icon className="size-4 text-muted-foreground" aria-label={`Trend: ${trend}`} />;
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
