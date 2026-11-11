"use client";
// Searchable combobox over a record type: debounced ai.taskEntityOptions, narrowed by sibling values.
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EntityOption, TaskFieldView } from "@/modules/ai/tasks/types";
import { fetchEntityOptions } from "./api";

const DEBOUNCE_MS = 250;

export interface EntityPickerProps {
  id: string;
  field: TaskFieldView;
  /** Concrete pointer path of this field instance. */
  path: string;
  institutionSlug: string;
  action: string;
  value: string | string[] | undefined;
  /** Display names known up front (view.resolved / candidates), by id. */
  known: Readonly<Record<string, EntityOption>>;
  candidates?: readonly EntityOption[];
  scope: Record<string, string>;
  onChange: (next: string | string[] | undefined) => void;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

export function EntityPicker(p: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState<Record<string, EntityOption>>({});
  const scopeKey = JSON.stringify(p.scope);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !p.field.entity) return;
    const entity = p.field.entity;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetchEntityOptions(
        p.institutionSlug,
        { action: p.action, path: p.field.path, entity, search: search || undefined, scope: JSON.parse(scopeKey) as Record<string, string> },
        ctl.signal,
      );
      if (ctl.signal.aborted) return;
      setLoading(false);
      setFailed(!res.ok);
      if (res.ok) {
        setOptions(res.data.slice(0, 20));
        setSeen((s) => ({ ...s, ...Object.fromEntries(res.data.map((o) => [o.id, o])) }));
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [open, search, scopeKey, p.institutionSlug, p.action, p.field.path, p.field.entity]);

  const multiple = !!p.field.multiple;
  const selected: string[] = multiple ? ((p.value as string[] | undefined) ?? []) : p.value ? [p.value as string] : [];
  const nameOf = (id: string) => seen[id]?.label ?? p.known[id]?.label ?? "Selected record";

  const pick = (id: string) => {
    if (multiple) {
      p.onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    } else {
      p.onChange(id);
      setOpen(false);
    }
  };

  const unresolvedCandidates = !multiple && selected.length === 0 && p.candidates && p.candidates.length > 0;

  return (
    <div className="space-y-2">
      {unresolvedCandidates && (
        <div role="group" aria-label={`${p.field.label}: pick one of these matches`} className="space-y-1">
          <p className="text-xs font-medium text-warning">Several records matched. Pick one.</p>
          <div className="flex flex-wrap gap-2">
            {p.candidates!.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="outline"
                className="h-11 min-w-11"
                onClick={() => {
                  setSeen((s) => ({ ...s, [c.id]: c }));
                  p.onChange(c.id);
                }}
              >
                {c.label}
                {c.hint && <span className="ml-1 text-xs text-muted-foreground">{c.hint}</span>}
              </Button>
            ))}
          </div>
        </div>
      )}
      {multiple && selected.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`Selected ${p.field.label}`}>
          {selected.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-sm">
              {nameOf(id)}
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${nameOf(id)}`} onClick={() => pick(id)} disabled={p.disabled}>
                <X className="size-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={p.id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={p.invalid || undefined}
            aria-describedby={p.describedBy}
            disabled={p.disabled}
            className="h-11 w-full justify-between font-normal"
          >
            <span className={selected.length === 0 || multiple ? "text-muted-foreground" : ""}>
              {multiple ? "Add…" : selected[0] ? nameOf(selected[0]) : "Search and pick…"}
            </span>
            <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Type to search" value={search} onValueChange={setSearch} />
            <CommandList>
              {loading && <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>}
              {failed && <p role="alert" className="px-3 py-2 text-sm text-destructive">Could not load choices. Try again.</p>}
              {!loading && !failed && <CommandEmpty>No match.</CommandEmpty>}
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.id} value={o.id} onSelect={() => pick(o.id)} className="min-h-11">
                    <Check className={selected.includes(o.id) ? "size-4" : "size-4 opacity-0"} aria-hidden />
                    <span>{o.label}</span>
                    {o.hint && <span className="ml-auto text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
