"use client";
// Compact attendance register: one row per student, a segmented status control, "All present", counts.
import { Button } from "@/components/ui/button";
import { getAt, knownOptions, optionLabel, setAt, type ErrorMap, type Values } from "./fields";
import { presentOption, rosterCounts, rosterRowCount, rowStatusPath, rowStudentPath, setAllStatus, type RosterShape } from "./renderers";
import type { TaskView } from "@/modules/ai/tasks/types";

interface Props {
  view: TaskView;
  shape: RosterShape;
  values: Values;
  errors: ErrorMap;
  idPrefix: string;
  disabled?: boolean;
  setValues: (v: Values) => void;
}


export function Roster({ view, shape, values, errors, idPrefix, disabled, setValues }: Props) {
  const n = rosterRowCount(values, shape);
  const counts = rosterCounts(values, shape);
  const known = knownOptions(view);
  const present = presentOption(shape);
  const options = shape.status.options ?? [];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{shape.array.label}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {options.map((o) => `${counts[o] ?? 0} ${optionLabel(shape.status, o).toLowerCase()}`).join(", ")} · {n} students
        </p>
        {present && (
          <Button type="button" variant="outline" className="h-11" disabled={disabled} onClick={() => setValues(setAllStatus(values, shape, present))}>
            All {optionLabel(shape.status, present).toLowerCase()}
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {Array.from({ length: n }, (_, i) => {
          const sp = rowStudentPath(shape, i);
          const stp = rowStatusPath(shape, i);
          const sid = getAt(values, sp);
          const name = view.resolved[sp]?.label ?? (typeof sid === "string" ? known[sid]?.label : undefined) ?? `Student ${i + 1}`;
          const current = getAt(values, stp);
          const err = errors[stp]?.[0];
          const errId = `${idPrefix}-roster-${i}-err`;
          return (
            <li key={typeof sid === "string" ? sid : i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <fieldset aria-describedby={err ? errId : undefined} className="contents">
                <legend className="sr-only">Status for {name}</legend>
                <span className="min-w-0 flex-1 truncate text-sm" aria-hidden>{name}</span>
                <div className="flex overflow-hidden rounded-md border" role="presentation">
                  {options.map((o) => {
                    const oid = `${idPrefix}-roster-${i}-${o}`;
                    return (
                      <label key={o} htmlFor={oid} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-r px-3 text-sm last:border-r-0 has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset">
                        <input
                          id={oid}
                          type="radio"
                          name={`${idPrefix}-roster-${i}`}
                          className="sr-only"
                          checked={current === o}
                          disabled={disabled}
                          onChange={() => setValues(setStatus(values, stp, o))}
                        />
                        <span className="sr-only">{name}: </span>
                        {optionLabel(shape.status, o)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {err && <p id={errId} className="w-full text-xs font-medium text-destructive">{err}</p>}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

const setStatus = (v: Values, path: string, s: string): Values => setAt(v, path, s);
