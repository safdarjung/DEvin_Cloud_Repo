"use client";
// F-UI-08 assumptions panel: one range input per ScenarioAssumptions field
// (no shadcn Slider in src/components/ui — plain `<input type="range">`,
// styled, per the packet's fallback). No debounce: runScenario is a handful
// of arithmetic ops over <=24 months, cheap enough to recompute on every
// `onChange` (shortcut: if a future model makes it expensive, debounce here).
import { Button } from "@/components/ui/button";
import type { BaselineFacts } from "@/modules/fabric/demo/simulator";
import type { ScenarioAssumptions } from "@/modules/fabric/types";

export function baselineAssumptions(facts: BaselineFacts): ScenarioAssumptions {
  return {
    enrolment_delta_pct: 0,
    staff_delta: 0,
    fee_change_pct: 0,
    cost_change_pct: 0,
    periods_per_day: facts.periods_per_day,
    horizon_months: 12,
  };
}

interface SliderDef {
  key: keyof ScenarioAssumptions;
  label: string;
  min: number;
  max: number;
  unit: string;
  caption: (value: number) => string;
}

const SLIDERS: SliderDef[] = [
  {
    key: "enrolment_delta_pct",
    label: "Enrolment change",
    min: -20,
    max: 30,
    unit: "%",
    caption: (v) => (v === 0 ? "No change to enrolled students" : `${v > 0 ? "+" : ""}${v}% ${v > 0 ? "more" : "fewer"} students enrolled`),
  },
  {
    key: "staff_delta",
    label: "Staff change",
    min: -10,
    max: 15,
    unit: " teachers",
    caption: (v) => (v === 0 ? "No change to teacher headcount" : `${v > 0 ? "+" : ""}${v} teacher${Math.abs(v) === 1 ? "" : "s"} vs today`),
  },
  {
    key: "fee_change_pct",
    label: "Fee change",
    min: -10,
    max: 25,
    unit: "%",
    caption: (v) => (v === 0 ? "No fee change" : `${v > 0 ? "+" : ""}${v}% fee change next cycle`),
  },
  {
    key: "cost_change_pct",
    label: "Cost change",
    min: -5,
    max: 20,
    unit: "%",
    caption: (v) => (v === 0 ? "No cost change" : `${v > 0 ? "+" : ""}${v}% change to salaries/fixed costs`),
  },
  {
    key: "periods_per_day",
    label: "Periods per day",
    min: 6,
    max: 9,
    unit: "",
    caption: (v) => `${v} periods scheduled per day`,
  },
  {
    key: "horizon_months",
    label: "Horizon",
    min: 6,
    max: 24,
    unit: " months",
    caption: (v) => `Projecting ${v} months ahead`,
  },
];

export function AssumptionsPanel({
  assumptions,
  baseline,
  onChange,
  enrolmentHint,
}: {
  assumptions: ScenarioAssumptions;
  baseline: ScenarioAssumptions;
  onChange: (next: ScenarioAssumptions) => void;
  /** Real admissions pipeline (offered + accepted, not yet enrolled) as an enrolment delta; null when unavailable. */
  enrolmentHint?: { pending: number; pct: number } | null;
}) {
  return (
    <div className="space-y-5">
      {SLIDERS.map((s) => {
        const value = assumptions[s.key];
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`sim-${s.key}`} className="text-sm font-medium">
                {s.label}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {value}
                  {s.unit}
                </span>
                {value !== baseline[s.key] && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() => onChange({ ...assumptions, [s.key]: baseline[s.key] })}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
            <input
              id={`sim-${s.key}`}
              type="range"
              min={s.min}
              max={s.max}
              step={1}
              value={value}
              aria-valuetext={`${value}${s.unit}`}
              onChange={(e) => onChange({ ...assumptions, [s.key]: Number(e.target.value) })}
              className="w-full accent-[var(--chart-1)]"
            />
            <p className="text-xs text-muted-foreground">{s.caption(value)}</p>
            {s.key === "enrolment_delta_pct" && enrolmentHint && (
              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Admissions pipeline: {enrolmentHint.pending} offered/accepted, not yet enrolled (+{enrolmentHint.pct}% if all join).
                {value !== enrolmentHint.pct && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() => onChange({ ...assumptions, enrolment_delta_pct: enrolmentHint.pct })}
                  >
                    Use +{enrolmentHint.pct}%
                  </Button>
                )}
              </p>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(baseline)}
        disabled={SLIDERS.every((s) => assumptions[s.key] === baseline[s.key])}
      >
        Reset all to baseline
      </Button>
    </div>
  );
}
