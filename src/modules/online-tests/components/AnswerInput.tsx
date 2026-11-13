"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Answer } from "@/modules/online-tests/schemas";

export const AR_CHOICES: [string, string][] = [
  ["A", "Both the assertion and the reason are true, and the reason explains the assertion."],
  ["B", "Both are true, but the reason does not explain the assertion."],
  ["C", "The assertion is true, but the reason is false."],
  ["D", "The assertion is false, but the reason is true."],
];
const BLANK = /_{3,}/g;
export const blankCount = (body: string) => Math.max(1, body.match(BLANK)?.length ?? 1);

/** True when the saved answer holds something a student wrote or chose. */
export function isAnswered(a: Answer | null | undefined): boolean {
  if (a === null || a === undefined) return false;
  if (typeof a === "string") return a.trim() !== "";
  if (Array.isArray(a)) return a.some((x) => (typeof x === "string" ? x.trim() !== "" : x !== null));
  return true;
}

const choice = "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5";

interface Props {
  item: { key: string; type: string; body: string; options: unknown };
  value: Answer | null;
  onChange: (a: Answer | null) => void;
}

export function AnswerInput({ item, value, onChange }: Props) {
  const { type, options } = item;
  const [partial, setPartial] = useState<(number | "")[]>(() => (type === "match" && Array.isArray(value) ? value.map((x) => (typeof x === "number" ? x : "")) : []));
  const list = Array.isArray(options) ? (options as string[]) : [];

  if (type === "mcq") {
    return (
      <div role="radiogroup" aria-label="Choose one answer" className="space-y-2">
        {list.map((o, i) => (
          <label key={i} className={choice}>
            <input type="radio" name={item.key} className="mt-0.5" checked={value === o} onChange={() => onChange(o)} aria-label={`Option ${i + 1}: ${o}`} />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (type === "true_false") {
    return (
      <div role="radiogroup" aria-label="True or false" className="flex gap-2">
        {["true", "false"].map((v) => (
          <label key={v} className={`${choice} flex-1`}>
            <input type="radio" name={item.key} checked={value === v} onChange={() => onChange(v)} aria-label={v === "true" ? "True" : "False"} />
            <span>{v === "true" ? "True" : "False"}</span>
          </label>
        ))}
      </div>
    );
  }
  if (type === "assertion_reason") {
    const o = (options ?? {}) as { assertion?: string; reason?: string };
    return (
      <div className="space-y-3">
        <p className="text-sm"><span className="font-medium">Assertion (A):</span> {o.assertion}</p>
        <p className="text-sm"><span className="font-medium">Reason (R):</span> {o.reason}</p>
        <div role="radiogroup" aria-label="Choose one answer" className="space-y-2">
          {AR_CHOICES.map(([k, label]) => (
            <label key={k} className={choice}>
              <input type="radio" name={item.key} className="mt-0.5" checked={value === k} onChange={() => onChange(k)} aria-label={`Choice ${k}`} />
              <span><span className="font-medium">{k}.</span> {label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (type === "multi_select") {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div role="group" aria-label="Choose all that apply" className="space-y-2">
        {list.map((o, i) => (
          <label key={i} className={choice}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={chosen.includes(o)}
              aria-label={`Option ${i + 1}: ${o}`}
              onChange={(e) => {
                const next = e.target.checked ? [...chosen, o] : chosen.filter((x) => x !== o);
                onChange(next.length ? next : null);
              }}
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (type === "fill_blank") {
    const n = blankCount(item.body);
    const cur = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-2">
        {Array.from({ length: n }, (_, i) => (
          <Input
            key={i}
            aria-label={`Blank ${i + 1}`}
            placeholder={`Blank ${i + 1}`}
            value={cur[i] ?? ""}
            maxLength={500}
            onChange={(e) => {
              const next = Array.from({ length: n }, (_, j) => (j === i ? e.target.value : (cur[j] ?? "")));
              onChange(next.some((x) => x.trim() !== "") ? next : null);
            }}
          />
        ))}
      </div>
    );
  }
  if (type === "numerical") {
    return (
      <Input
        aria-label="Your answer (a number)"
        type="number"
        inputMode="decimal"
        step="any"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value))}
      />
    );
  }
  if (type === "match") {
    const o = (options ?? {}) as { left?: string[]; right?: string[] };
    const left = o.left ?? [];
    const right = o.right ?? [];
    return (
      <div className="space-y-2" role="group" aria-label="Match each item">
        {left.map((l, i) => (
          <label key={i} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-1/2">{l}</span>
            <select
              aria-label={`Match for ${l}`}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base md:h-9 md:text-sm sm:w-1/2"
              value={partial[i] ?? ""}
              onChange={(e) => {
                const next = [...partial];
                next[i] = e.target.value === "" ? "" : Number(e.target.value);
                setPartial(next);
                // Autosaved as chosen; an unmatched pair is null (marked wrong while any pair is left), none chosen is no answer.
                const pairs = left.map((_, j) => (typeof next[j] === "number" ? (next[j] as number) : null));
                onChange(pairs.some((x) => x !== null) ? pairs : null);
              }}
            >
              <option value="">Choose...</option>
              {right.map((r, j) => <option key={j} value={j}>{r}</option>)}
            </select>
          </label>
        ))}
        {left.some((_, i) => typeof partial[i] === "number") && left.some((_, i) => typeof partial[i] !== "number") && (
          <p role="status" className="text-xs text-warning" data-testid="match-incomplete">Incomplete: match every item. A partly matched question is marked wrong.</p>
        )}
      </div>
    );
  }
  // short_answer, long_answer, very_short_answer, case_based, passage, diagram
  return (
    <Textarea
      aria-label="Your answer"
      rows={type === "long_answer" || type === "case_based" || type === "passage" ? 10 : 4}
      value={typeof value === "string" ? value : ""}
      maxLength={8000}
      onChange={(e) => onChange(e.target.value.trim() === "" ? null : e.target.value)}
    />
  );
}
