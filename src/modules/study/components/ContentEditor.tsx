"use client";

// Generic editor for a draft's JSON content (teacher review before sharing):
// every text field is a textarea, list items can be removed, true/false and
// MCQ answer keys stay editable. Ids and question types are fixed. The save
// action re-validates the whole thing against the format's schema.
import { X } from "lucide-react";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const LOCKED = new Set(["id", "type", "difficulty"]);
const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function Field({ name, value, onChange }: { name: string; value: Json; onChange: (v: Json) => void }) {
  if (typeof value === "string") {
    return (
      <label className="block">
        <span className="text-xs text-muted-foreground">{name}</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={value.length > 90 ? 3 : 1}
          className="mt-0.5 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="size-4" />
        {name}: {value ? "True" : "False"}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">{name} (0 = first option)</span>
        <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              Option {String.fromCharCode(65 + n)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (Array.isArray(value)) {
    const fixedLength = name === "Options";
    return (
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{name}</legend>
        {value.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1 rounded-md border-l-2 pl-2">
              <Field name={`${i + 1}`} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
            </div>
            {!fixedLength && value.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove ${name.toLowerCase()} item ${i + 1}`}
                className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </fieldset>
    );
  }
  if (value && typeof value === "object") {
    return (
      <div className="space-y-2">
        {Object.entries(value)
          .filter(([k]) => !LOCKED.has(k))
          .map(([k, v]) => (
            <Field key={k} name={humanize(k)} value={v} onChange={(next) => onChange({ ...value, [k]: next })} />
          ))}
      </div>
    );
  }
  return null;
}

export function ContentEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return <Field name="Content" value={value as Json} onChange={onChange} />;
}
