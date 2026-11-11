"use client";

// 0141 — the school's timetable rules: on/off + value per rule, a reason for
// every save (logged in the change log, undoable from there).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setTimetableRules } from "@/modules/timetable/control.actions";
import { RULE_CATALOG, RULE_CODES, type RuleCode, type TimetableRules } from "@/modules/timetable/rules";
import { FieldError, SELECT_CLASS, useRun } from "./control-forms";

interface Option {
  id: string;
  name: string;
}

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NUMBER_RULES = {
  max_same_subject_per_day: [1, 8],
  max_consecutive_teacher: [1, 10],
  max_teacher_per_day: [1, 12],
  max_teacher_per_week: [1, 72],
  spread_across_week: [1, 4],
} as const;

export function RulesForm({
  slug,
  initial,
  subjects,
  teachers,
  periods,
}: {
  slug: string;
  initial: TimetableRules;
  subjects: Option[];
  teachers: Option[];
  periods: Option[];
}) {
  const { pending, errors, run } = useRun();
  const [rules, setRules] = useState<TimetableRules>(initial);
  const [reason, setReason] = useState("");
  const set = <K extends RuleCode>(code: K, patch: Partial<TimetableRules[K]>) => setRules((r) => ({ ...r, [code]: { ...r[code], ...patch } }));
  const name = (list: Option[], id: string) => list.find((o) => o.id === id)?.name ?? "?";

  function valueEditor(code: RuleCode) {
    if (code in NUMBER_RULES) {
      const [min, max] = NUMBER_RULES[code as keyof typeof NUMBER_RULES];
      const rule = rules[code as keyof typeof NUMBER_RULES];
      return (
        <div className="grid w-40 gap-1">
          <Label htmlFor={`rule-${code}`}>{RULE_CATALOG[code].valueLabel}</Label>
          <Input
            id={`rule-${code}`}
            type="number"
            min={min}
            max={max}
            className="h-11 sm:h-9"
            value={rule.value}
            onChange={(e) => set(code as keyof typeof NUMBER_RULES, { value: Math.round(Number(e.target.value)) })}
          />
        </div>
      );
    }
    if (code === "subject_time_band")
      return (
        <ListEditor
          rows={rules.subject_time_band.value.map((b, i) => (
            <span key={i} className="flex items-center gap-2">
              {name(subjects, b.subjectId)} {b.band === "before_lunch" ? "before lunch" : "after lunch"}
              <RemoveButton onClick={() => set("subject_time_band", { value: rules.subject_time_band.value.filter((_, j) => j !== i) })} />
            </span>
          ))}
          add={(fields) =>
            fields.subject && set("subject_time_band", { value: [...rules.subject_time_band.value.filter((b) => b.subjectId !== fields.subject), { subjectId: fields.subject, band: fields.band === "after_lunch" ? "after_lunch" : "before_lunch" }] })
          }
          fields={[
            { key: "subject", label: "Subject", options: subjects },
            { key: "band", label: "When", options: [{ id: "before_lunch", name: "Before lunch" }, { id: "after_lunch", name: "After lunch" }] },
          ]}
          code={code}
        />
      );
    if (code === "lab_rooms")
      return (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="sr-only">{RULE_CATALOG.lab_rooms.valueLabel}</legend>
          {subjects.map((s) => (
            <label key={s.id} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={rules.lab_rooms.value.includes(s.id)}
                onChange={(e) =>
                  set("lab_rooms", { value: e.target.checked ? [...rules.lab_rooms.value, s.id] : rules.lab_rooms.value.filter((x) => x !== s.id) })
                }
              />
              {s.name}
            </label>
          ))}
        </fieldset>
      );
    if (code === "teacher_unavailable")
      return (
        <ListEditor
          rows={rules.teacher_unavailable.value.map((u, i) => (
            <span key={i} className="flex items-center gap-2">
              {name(teachers, u.teacherId)} · {DAYS[u.weekday]} · {u.periodId ? name(periods, u.periodId) : "all day"}
              <RemoveButton onClick={() => set("teacher_unavailable", { value: rules.teacher_unavailable.value.filter((_, j) => j !== i) })} />
            </span>
          ))}
          add={(fields) =>
            fields.teacher &&
            fields.day &&
            set("teacher_unavailable", {
              value: [...rules.teacher_unavailable.value, { teacherId: fields.teacher, weekday: Number(fields.day), ...(fields.period ? { periodId: fields.period } : {}) }],
            })
          }
          fields={[
            { key: "teacher", label: "Teacher", options: teachers },
            { key: "day", label: "Day", options: DAYS.slice(1).map((d, i) => ({ id: String(i + 1), name: d })) },
            { key: "period", label: "Period", options: periods, emptyLabel: "All day" },
          ]}
          code={code}
        />
      );
    const w = rules.substitute_ranking.value;
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["sameSubject", "Same subject"],
            ["sameGrade", "Same grade"],
            ["fewestToday", "Per period that day (minus)"],
            ["notCovering", "Not already covering"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="grid gap-1">
            <Label htmlFor={`rank-${k}`}>{label}</Label>
            <Input
              id={`rank-${k}`}
              type="number"
              min={0}
              max={10}
              className="h-11 sm:h-9"
              value={w[k]}
              onChange={(e) => set("substitute_ranking", { value: { ...w, [k]: Math.round(Number(e.target.value)) } })}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setTimetableRules(slug, { rules, reason: reason.trim() }), "Rules saved — the change and its reason are in the log", () => setReason(""));
      }}
    >
      <ul className="divide-y divide-border rounded-md border border-border">
        {RULE_CODES.map((code) => (
          <li key={code} className="space-y-3 p-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={rules[code].enabled} onChange={(e) => set(code, { enabled: e.target.checked })} />
              <span>
                <span className="block font-medium">{RULE_CATALOG[code].label}</span>
                <span className="block text-sm text-muted-foreground">{RULE_CATALOG[code].description}</span>
              </span>
            </label>
            <div className={rules[code].enabled ? "pl-8" : "pl-8 opacity-60"}>{valueEditor(code)}</div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Double-booking a teacher, room or class is always blocked by the database; it is not a rule you can switch off.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1">
          <Label htmlFor="rules-reason">Why are the rules changing? (required)</Label>
          <Input id="rules-reason" className="h-11 sm:h-9" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required aria-invalid={Boolean(errors.reason)} />
          <FieldError errors={errors.reason ?? errors.rules} />
        </div>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !reason.trim()}>
          {pending ? "Saving…" : "Save rules"}
        </Button>
      </div>
    </form>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant="ghost" onClick={onClick}>
      Remove
    </Button>
  );
}

function ListEditor({
  rows,
  fields,
  add,
  code,
}: {
  rows: React.ReactNode[];
  fields: { key: string; label: string; options: Option[]; emptyLabel?: string }[];
  add: (values: Record<string, string>) => void;
  code: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="space-y-2">
      {rows.length > 0 ? <div className="space-y-1 text-sm">{rows}</div> : <p className="text-sm text-muted-foreground">None yet.</p>}
      <div className="flex flex-wrap items-end gap-2">
        {fields.map((f) => (
          <div key={f.key} className="grid min-w-36 flex-1 gap-1 sm:flex-none">
            <Label htmlFor={`${code}-${f.key}`}>{f.label}</Label>
            <select id={`${code}-${f.key}`} className={SELECT_CLASS} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
              <option value="">{f.emptyLabel ?? "Choose…"}</option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => add(values)}>
          Add
        </Button>
      </div>
    </div>
  );
}
