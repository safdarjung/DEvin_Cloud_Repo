"use client";
// One control per FieldKind, generated from TaskFieldView. Never imports a Zod schema.
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TaskFieldView, TaskView } from "@/modules/ai/tasks/types";
import { EntityPicker } from "./EntityPicker";
import { Repeater } from "./Repeater";
import { getAt, isHiddenKind, knownOptions, isoToIstLocal, istLocalToIso, optionLabel, scopeFor, setAt, type ErrorMap, type Values } from "./fields";

export interface FieldsCtx {
  view: TaskView;
  values: Values;
  errors: ErrorMap;
  institutionSlug: string;
  idPrefix: string;
  disabled?: boolean;
  setValues: (next: Values) => void;
}

const RADIO_MAX = 5;

function bind(child: TaskFieldView, parentPattern: string, parentConcrete: string): string {
  return `${parentConcrete}${child.path.slice(parentPattern.length)}`;
}

/** Fields of a form level; `parentPattern`/`parentConcrete` map pattern paths to row instances. */
export function TaskFields({ fields, ctx, parentPattern = "", parentConcrete = "" }: { fields: readonly TaskFieldView[]; ctx: FieldsCtx; parentPattern?: string; parentConcrete?: string }) {
  return (
    <>
      {fields
        .filter((f) => !isHiddenKind(f.kind))
        .map((f) => (
          <FieldRow key={f.path} field={f} ctx={ctx} concrete={parentPattern ? bind(f, parentPattern, parentConcrete) : f.path} />
        ))}
    </>
  );
}

export const fieldDomId = (ctx: FieldsCtx, path: string) => `${ctx.idPrefix}${path.replace(/\//g, "-")}`;

function FieldRow({ field, ctx, concrete }: { field: TaskFieldView; ctx: FieldsCtx; concrete: string }) {
  const id = fieldDomId(ctx, concrete);
  const errs = ctx.errors[concrete] ?? [];
  const value = getAt(ctx.values, concrete);
  const set = (v: unknown) => ctx.setValues(setAt(ctx.values, concrete, v));
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [field.humanOnly || field.maxLength ? hintId : null, errs.length ? errId : null].filter(Boolean).join(" ") || undefined;
  const common = { id, disabled: ctx.disabled, "aria-invalid": errs.length > 0 || undefined, "aria-describedby": describedBy } as const;

  // Containers: fieldset + legend.
  if (field.kind === "array" && !field.multiple && field.fields) {
    const rows = Array.isArray(value) ? value : [];
    const rowPattern = `${field.path}/*`;
    return (
      <fieldset className="space-y-2" aria-describedby={errs.length ? errId : undefined}>
        <legend className="text-sm font-medium">{field.label}</legend>
        <Repeater
          field={field}
          path={concrete}
          rows={rows}
          errors={ctx.errors}
          disabled={ctx.disabled}
          onChange={(next) => ctx.setValues(setAt(ctx.values, concrete, next))}
          renderRow={(i) => (
            <TaskFields fields={field.fields!.filter((c) => c.path.startsWith(rowPattern))} ctx={ctx} parentPattern={rowPattern} parentConcrete={`${concrete}/${i}`} />
          )}
        />
        <Errors id={errId} errs={errs} />
      </fieldset>
    );
  }
  if (field.kind === "object" && field.fields) {
    return (
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{field.label}</legend>
        <TaskFields fields={field.fields} ctx={ctx} parentPattern={field.path} parentConcrete={concrete} />
      </fieldset>
    );
  }

  const labelEl = (
    <Label htmlFor={id} className="flex flex-wrap items-center gap-2">
      {field.label}
      {field.required && !field.humanOnly && <span aria-hidden className="text-muted-foreground">*</span>}
      {field.humanOnly && <span className="rounded-sm bg-warning/12 px-1.5 text-xs font-medium text-warning">You enter this</span>}
    </Label>
  );

  // Radio / checkbox groups use fieldset + legend instead of a label.
  const optionsKind = field.kind === "enum" && field.options;
  if (optionsKind && (field.multiple || field.options!.length <= RADIO_MAX)) {
    const chosen: string[] = field.multiple ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
    return (
      <fieldset className="space-y-1" aria-describedby={describedBy}>
        <legend className="text-sm font-medium">{field.label}{field.required ? <span aria-hidden className="text-muted-foreground"> *</span> : null}</legend>
        <div className="flex flex-wrap gap-2">
          {field.options!.map((o) => {
            const oid = `${id}-${o}`;
            return (
              <label key={o} htmlFor={oid} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <input
                  id={oid}
                  type={field.multiple ? "checkbox" : "radio"}
                  name={id}
                  className="size-4"
                  checked={chosen.includes(o)}
                  disabled={ctx.disabled}
                  onChange={() => set(field.multiple ? (chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o]) : o)}
                />
                {optionLabel(field, o)}
              </label>
            );
          })}
        </div>
        <Errors id={errId} errs={errs} />
      </fieldset>
    );
  }

  let control: React.ReactNode;
  switch (field.kind) {
    case "enum":
      control = (
        <Select value={typeof value === "string" ? value : ""} onValueChange={set} disabled={ctx.disabled}>
          <SelectTrigger {...common} className="h-11 w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o} className="min-h-11">{optionLabel(field, o)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "entity":
      control = (
        <EntityPicker
          id={id}
          field={field}
          path={concrete}
          institutionSlug={ctx.institutionSlug}
          action={ctx.view.action}
          value={value as string | string[] | undefined}
          known={knownOptions(ctx.view)}
          candidates={ctx.view.candidates[concrete]}
          scope={scopeFor(ctx.view, ctx.values, concrete)}
          onChange={set}
          describedBy={describedBy}
          invalid={errs.length > 0}
          disabled={ctx.disabled}
        />
      );
      break;
    case "date":
      control = <Input {...common} type="date" className="h-11" value={str(value)} onChange={(e) => set(e.target.value)} />;
      break;
    case "time":
      control = <Input {...common} type="time" className="h-11" value={str(value)} onChange={(e) => set(e.target.value)} />;
      break;
    case "datetime":
      control = (
        <div className="flex items-center gap-2">
          <Input {...common} type="datetime-local" className="h-11" value={typeof value === "string" ? isoToIstLocal(value) : ""} onChange={(e) => set(e.target.value ? istLocalToIso(e.target.value) : "")} />
          <span className="shrink-0 text-xs text-muted-foreground">India time</span>
        </div>
      );
      break;
    case "rupees":
    case "rupee_text":
    case "paise":
      control = (
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-sm text-muted-foreground">₹</span>
          <Input {...common} inputMode="decimal" autoComplete="off" className="h-11" value={str(value)} onChange={(e) => set(e.target.value)} placeholder="0.00" />
        </div>
      );
      break;
    case "marks":
    case "number":
      control = <Input {...common} inputMode="decimal" autoComplete="off" className="h-11" value={str(value)} onChange={(e) => set(e.target.value)} />;
      break;
    case "boolean":
      control = (
        <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm">
          <input {...common} type="checkbox" className="size-5" checked={value === true} onChange={(e) => set(e.target.checked)} />
          Yes
        </label>
      );
      break;
    case "long_text":
      control = <Textarea {...common} rows={4} maxLength={field.maxLength} value={str(value)} onChange={(e) => set(e.target.value)} />;
      break;
    case "unknown":
      control = <p id={id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{value === undefined ? "Not shown here." : JSON.stringify(value)}</p>;
      break;
    default:
      // text, natural_key, and an array of plain scalars typed as text
      control = <Input {...common} className="h-11" maxLength={field.maxLength} value={str(value)} onChange={(e) => set(e.target.value)} autoComplete="off" />;
  }

  return (
    <div className="space-y-1">
      {labelEl}
      {control}
      {field.humanOnly && <p id={hintId} className="text-xs text-muted-foreground">This value is never filled by the assistant. Type it yourself.</p>}
      {!field.humanOnly && field.maxLength && (field.kind === "long_text" || field.kind === "text") && (
        <p id={hintId} className="text-xs text-muted-foreground" aria-live="off">{str(value).length} of {field.maxLength} characters</p>
      )}
      <Errors id={errId} errs={errs} />
    </div>
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function Errors({ id, errs }: { id: string; errs: readonly string[] }) {
  if (errs.length === 0) return null;
  return <p id={id} className="text-xs font-medium text-destructive">{errs.join(" ")}</p>;
}

/** Stable id prefix hook for a card. */
export function useFieldsPrefix(): string {
  return `tc${useId().replace(/:/g, "")}`;
}
