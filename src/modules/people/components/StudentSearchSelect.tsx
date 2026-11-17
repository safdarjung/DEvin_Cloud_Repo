"use client";

// Search-as-you-type student picker (replaces a flat <select> capped at ~1000 rows).
// Server-side search via people.student.search; `name` adds a hidden input for plain <form> posts.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchStudentOptions } from "@/modules/people/actions";

type Option = { id: string; label: string };
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

export function StudentSearchSelect({
  institutionSlug,
  id,
  name,
  value,
  onChange,
  invalid,
}: {
  institutionSlug: string;
  id: string;
  name?: string;
  value: Option | null;
  onChange: (next: Option | null) => void;
  invalid?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const q = term.trim();
    if (q.length < MIN_CHARS) return;
    let stale = false;
    const t = setTimeout(async () => {
      setState("loading");
      const res = await searchStudentOptions(institutionSlug, { q });
      if (stale) return;
      if (res.ok) {
        setResults(res.data);
        setState("idle");
      } else {
        setResults([]);
        setState("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [term, institutionSlug]);

  const active = term.trim().length >= MIN_CHARS;
  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-input px-3 text-sm">
        <span className="truncate">{value.label}</span>
        {name && <input type="hidden" name={name} value={value.id} />}
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input id={id} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type a name or admission number…" autoComplete="off" aria-invalid={invalid} />
      {state === "loading" && <p className="text-xs text-muted-foreground">Searching…</p>}
      {state === "error" && <p className="text-xs text-destructive">Could not search students. Try again.</p>}
      {active && state === "idle" && results.length === 0 && <p className="text-xs text-muted-foreground">No matching active student.</p>}
      {active && results.length > 0 && (
        <ul className="max-h-56 divide-y divide-border overflow-auto rounded-md border border-border" aria-label="Matching students">
          {results.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="min-h-10 w-full px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => {
                  onChange(o);
                  setTerm("");
                  setResults([]);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
