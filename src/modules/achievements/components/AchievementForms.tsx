"use client";

// Hiding these is UX only: actions re-check achievement.write / achievement.verify, Zod and RLS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { recordAchievement, verifyAchievement, voidAchievement } from "@/modules/achievements/actions";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LEVELS, AchievementRecordSchema } from "@/modules/achievements/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export function RecordAchievementForm({ institutionSlug, students }: { institutionSlug: string; students: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = AchievementRecordSchema.safeParse({
      studentId: fd.get("studentId"),
      title: fd.get("title"),
      category: fd.get("category"),
      level: fd.get("level"),
      position: String(fd.get("position") ?? "") || undefined,
      eventDate: fd.get("eventDate"),
      description: String(fd.get("description") ?? "") || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await recordAchievement(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Achievement recorded");
        form.reset();
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div className="sm:col-span-2">
        <Label htmlFor="ac-student">Student</Label>
        <select id="ac-student" name="studentId" required className={SELECT_CLASS} defaultValue="">
          <option value="" disabled>
            Select a student
          </option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="ac-title">Title</Label>
        <Input id="ac-title" name="title" required maxLength={200} placeholder="e.g. District chess championship" />
      </div>
      <div>
        <Label htmlFor="ac-category">Category</Label>
        <select id="ac-category" name="category" className={SELECT_CLASS} defaultValue="academic">
          {ACHIEVEMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="ac-level">Level</Label>
        <select id="ac-level" name="level" className={SELECT_CLASS} defaultValue="school">
          {ACHIEVEMENT_LEVELS.map((l) => (
            <option key={l} value={l}>
              {humanize(l)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="ac-position">Position (optional)</Label>
        <Input id="ac-position" name="position" maxLength={60} placeholder="e.g. 1st, Runner-up" />
      </div>
      <div>
        <Label htmlFor="ac-date">Date</Label>
        <Input id="ac-date" name="eventDate" type="date" required />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="ac-description">Description (optional)</Label>
        <Input id="ac-description" name="description" maxLength={1000} />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record achievement"}
        </Button>
      </div>
    </form>
  );
}

export function VerifyAchievementButton({ institutionSlug, achievementId }: { institutionSlug: string; achievementId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await verifyAchievement(institutionSlug, { achievementId });
          if (res.ok) {
            toast.success("Achievement verified");
            router.refresh();
          } else {
            toast.error(describeActionError(res.error));
          }
        })
      }
    >
      {pending ? "Verifying…" : "Verify"}
    </Button>
  );
}

export function VoidAchievementButton({ institutionSlug, achievementId }: { institutionSlug: string; achievementId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Void
      </Button>
    );
  }
  const run = () =>
    start(async () => {
      const res = await voidAchievement(institutionSlug, { achievementId, reason });
      if (res.ok) {
        toast.success("Achievement voided");
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Input aria-label="Void reason" value={reason} maxLength={200} placeholder="Reason" onChange={(e) => setReason(e.target.value)} className="h-8 w-48" />
      <span className="flex gap-1">
        <Button type="button" size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={run}>
          {pending ? "Voiding…" : "Confirm void"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}

export function PrintButton({ label = "Print portfolio" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
