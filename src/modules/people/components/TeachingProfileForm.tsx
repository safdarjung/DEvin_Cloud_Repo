"use client";

// 0155: the teaching profile a staff member fills in on first sign-in and can edit later:
// qualifications, the subjects and classes they can teach, and years of experience.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveOwnTeacherProfile } from "@/modules/people/actions";
import { LEVEL_LABEL, QUAL_LEVELS, type QualLevel } from "@/modules/people/qualifications";
import type { ClassOption, MyTeacherProfile } from "@/modules/people/queries";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAX_ROWS = 10;

interface Row {
  level: QualLevel;
  degree: string;
  subject: string;
  year: string;
}

interface Props {
  institutionSlug: string;
  profile: MyTeacherProfile;
  grades: ClassOption[];
  subjects: { id: string; name: string }[];
}

function Picks({ legend, options, picked, onToggle }: { legend: string; options: { id: string; label: string }[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
    <fieldset className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.id} className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={picked.has(o.id)} onChange={() => onToggle(o.id)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function TeachingProfileForm({ institutionSlug, profile, grades, subjects }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    profile.qualifications.length
      ? profile.qualifications.map((q) => ({ level: q.level, degree: q.degree, subject: q.subject ?? "", year: q.year ? String(q.year) : "" }))
      : [{ level: "bachelors", degree: "", subject: "", year: "" }],
  );
  const [subjectIds, setSubjectIds] = useState(() => new Set(profile.subjectIds));
  const [gradeIds, setGradeIds] = useState(() => new Set(profile.gradeIds));
  const [experience, setExperience] = useState(profile.experienceYears === null ? "" : String(profile.experienceYears));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const firstTime = profile.onboardedAt === null;

  const toggle = (set: Set<string>, update: (s: Set<string>) => void) => (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const edit = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const result = await saveOwnTeacherProfile(institutionSlug, {
        qualifications: rows
          .filter((r) => r.degree.trim())
          .map((r) => ({ level: r.level, degree: r.degree.trim(), ...(r.subject.trim() ? { subject: r.subject.trim() } : {}), ...(r.year ? { year: Number(r.year) } : {}) })),
        subjectIds: [...subjectIds],
        gradeIds: [...gradeIds],
        experienceYears: experience === "" ? null : Number(experience),
      });
      if (!result.ok) {
        const field = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
        return setMessage({ ok: false, text: field ?? result.error.message });
      }
      setMessage({ ok: true, text: firstTime ? "Thank you. Your profile is saved and the office can now see it." : "Profile saved." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Qualifications</CardTitle>
          <CardDescription>Every degree or diploma you hold, for example B.A. English, B.Ed., M.Sc. Physics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_auto] sm:items-end">
              <div className="grid gap-1">
                <Label htmlFor={`q-level-${i}`}>Level</Label>
                <select id={`q-level-${i}`} className={SELECT} value={r.level} onChange={(e) => edit(i, { level: e.target.value as QualLevel })}>
                  {QUAL_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`q-degree-${i}`}>Degree</Label>
                <Input id={`q-degree-${i}`} value={r.degree} maxLength={80} placeholder="e.g. B.Ed." onChange={(e) => edit(i, { degree: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`q-subject-${i}`}>Subject (optional)</Label>
                <Input id={`q-subject-${i}`} value={r.subject} maxLength={80} placeholder="e.g. Physics" onChange={(e) => edit(i, { subject: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`q-year-${i}`}>Year</Label>
                <Input id={`q-year-${i}`} type="number" inputMode="numeric" min={1950} max={2100} value={r.year} onChange={(e) => edit(i, { year: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove qualification ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_ROWS} onClick={() => setRows((prev) => [...prev, { level: "bachelors", degree: "", subject: "", year: "" }])}>
            <Plus aria-hidden />
            Add another
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subjects you can teach</CardTitle>
        </CardHeader>
        <CardContent>
          {subjects.length ? <Picks legend="Subjects you can teach" options={subjects.map((s) => ({ id: s.id, label: s.name }))} picked={subjectIds} onToggle={toggle(subjectIds, setSubjectIds)} /> : <p className="text-sm text-muted-foreground">The school has not added subjects yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Classes you can teach</CardTitle>
          <CardDescription>The office matches these with your qualifications when it shares classes out.</CardDescription>
        </CardHeader>
        <CardContent>
          {grades.length ? <Picks legend="Classes you can teach" options={grades.map((g) => ({ id: g.id, label: g.displayName }))} picked={gradeIds} onToggle={toggle(gradeIds, setGradeIds)} /> : <p className="text-sm text-muted-foreground">The school has not added classes yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="grid max-w-xs gap-1">
            <Label htmlFor="experience">Years of teaching experience</Label>
            <Input id="experience" type="number" inputMode="numeric" min={0} max={60} value={experience} onChange={(e) => setExperience(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {message.text}{" "}
          {message.ok && firstTime && (
            <Link href={`/${institutionSlug}/dashboard`} className="font-medium text-foreground underline underline-offset-2">
              Go to your dashboard
            </Link>
          )}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : firstTime ? "Save and finish" : "Save profile"}
      </Button>
    </form>
  );
}
