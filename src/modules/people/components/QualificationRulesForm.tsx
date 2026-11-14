"use client";

// 0155: the school's rule for the highest class each qualification level may teach.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveQualificationRules } from "@/modules/people/actions";
import { DEFAULT_MAX_GRADE, LEVEL_SHORT, QUAL_LEVELS, type QualLevel, type QualRules } from "@/modules/people/qualifications";
import type { ClassOption } from "@/modules/people/queries";

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function QualificationRulesForm({ institutionSlug, rules, grades }: { institutionSlug: string; rules: QualRules; grades: ClassOption[] }) {
  const router = useRouter();
  const codes = new Set(grades.map((g) => g.code));
  // A default naming a class this school does not have shows as its last class.
  const initial = (l: QualLevel) => rules[l] ?? (codes.has(DEFAULT_MAX_GRADE[l]) ? DEFAULT_MAX_GRADE[l] : (grades.at(-1)?.code ?? ""));
  const [value, setValue] = useState<Record<QualLevel, string>>(() => Object.fromEntries(QUAL_LEVELS.map((l) => [l, initial(l)])) as Record<QualLevel, string>);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const result = await saveQualificationRules(institutionSlug, { maxGradeByLevel: value });
          if (!result.ok) return setMessage({ ok: false, text: result.error.message });
          setMessage({ ok: true, text: "Rule saved. The lists below now follow it." });
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUAL_LEVELS.map((l) => (
          <div key={l} className="grid gap-1">
            <Label htmlFor={`rule-${l}`}>{LEVEL_SHORT[l]}: up to</Label>
            <select id={`rule-${l}`} className={SELECT} value={value[l]} onChange={(e) => setValue((v) => ({ ...v, [l]: e.target.value }))}>
              {grades.map((g) => (
                <option key={g.id} value={g.code}>
                  {g.displayName}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending || grades.length === 0}>
        {pending ? "Saving…" : "Save rule"}
      </Button>
    </form>
  );
}
