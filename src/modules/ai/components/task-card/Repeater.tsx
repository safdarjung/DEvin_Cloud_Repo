"use client";
// Array of rows: add, remove, reorder within maxItems. Rows are keyed by a stable client id so state follows the row.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { TaskFieldView } from "@/modules/ai/tasks/types";
import { rowErrors, type ErrorMap } from "./fields";

export interface RepeaterProps {
  field: TaskFieldView;
  /** Concrete array path. */
  path: string;
  rows: unknown[];
  errors: ErrorMap;
  disabled?: boolean;
  onChange: (rows: unknown[]) => void;
  /** Renders the child controls of row `index`. */
  renderRow: (index: number) => ReactNode;
}

export function Repeater({ field, path, rows, errors, disabled, onChange, renderRow }: RepeaterProps) {
  const max = field.maxItems ?? Infinity;
  // Rows are keyed by index: every value lives in the parent state, so a reorder moves the data, not hidden row state.
  const move = (from: number, to: number) => {
    const next = rows.slice();
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {rows.map((_, i) => {
          const bad = Object.keys(rowErrors(errors, path, i)).length > 0;
          return (
            <li key={i} data-row-error={bad || undefined} className={`rounded-md border p-3 ${bad ? "border-destructive" : ""}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{field.label} {i + 1}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Move ${field.label} ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Move ${field.label} ${i + 1} down`} disabled={disabled || i === rows.length - 1} onClick={() => move(i, i + 1)}>
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Remove ${field.label} ${i + 1}`} disabled={disabled} onClick={() => remove(i)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="space-y-3">{renderRow(i)}</div>
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="outline" className="h-11" disabled={disabled || rows.length >= max} onClick={() => onChange([...rows, {}])}>
        <Plus className="size-4" aria-hidden /> Add {field.label.toLowerCase()}
      </Button>
      {Number.isFinite(max) && <p className="text-xs text-muted-foreground">{rows.length} of {max} rows</p>}
    </div>
  );
}
