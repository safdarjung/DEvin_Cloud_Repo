"use client";

// 0141 timetable control forms. Hiding them is UX only: every action
// re-checks timetable.manage server-side and every write is logged with its reason.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { createVersion, publishVersion } from "@/modules/timetable/actions";
import {
  applyTimetableChanges,
  createTimetableSnapshot,
  restoreTimetableSnapshot,
  rollbackTimetableChange,
} from "@/modules/timetable/control.actions";
import { ruleLabel, type TimetableSuggestion } from "@/modules/timetable/suggest";
import { CONFIRM_ABOVE, GROUP_PAGE, groupSuggestions, visibleCount } from "@/modules/timetable/suggestion-groups";

export const SELECT_CLASS =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";

export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  function run<T>(call: () => Promise<ActionResult<T>>, success: string | ((data: T) => string), onOk?: () => void) {
    start(async () => {
      const res = await call();
      if (res.ok) {
        setErrors({});
        toast.success(typeof success === "string" ? success : success(res.data));
        onOk?.();
        router.refresh();
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(describeActionError(res.error));
      }
    });
  }
  return { pending, errors, run };
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

/** Undo one logged change (compensating change "Rollback of …"; refused with a message if it would clash). */
export function UndoButton({ slug, changeId, label = "Undo" }: { slug: string; changeId: string; label?: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="min-h-9"
      disabled={pending}
      onClick={() => run(() => rollbackTimetableChange(slug, { changeId }), "Change undone — the undo is in the log")}
    >
      {pending ? "Undoing…" : label}
    </Button>
  );
}

interface Option {
  id: string;
  name: string;
}

/** Set or clear one period. A published timetable needs a note (the database refuses without one). */
export function CellEditForm({
  slug,
  versionId,
  cell,
  label,
  current,
  subjects,
  teachers,
  rooms,
  published,
}: {
  slug: string;
  versionId: string;
  cell: { classSectionId: string; weekday: number; periodId: string };
  label: string;
  current: { subjectId: string; teacherId: string; roomId: string | null } | null;
  subjects: Option[];
  teachers: Option[];
  rooms: Option[];
  published: boolean;
}) {
  const { pending, errors, run } = useRun();
  const [subjectId, setSubjectId] = useState(current?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState(current?.teacherId ?? "");
  const [roomId, setRoomId] = useState(current?.roomId ?? "");
  const [note, setNote] = useState("");
  const save = (after: { subjectId: string; teacherId: string; roomId: string | null } | null) =>
    run(
      () => applyTimetableChanges(slug, { versionId, kind: "manual", changes: [{ ...cell, after }], ...(note.trim() ? { note: note.trim() } : {}) }),
      after ? "Period saved — reason logged" : "Period cleared — reason logged",
      () => setNote(""),
    );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        save({ subjectId, teacherId, roomId: roomId || null });
      }}
    >
      <p className="text-sm font-medium sm:col-span-2 lg:col-span-4">Edit {label}</p>
      <div className="grid gap-1">
        <Label htmlFor="edit-subject">Subject</Label>
        <select id="edit-subject" className={SELECT_CLASS} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
          <option value="">Choose…</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="edit-teacher">Teacher</Label>
        <select id="edit-teacher" className={SELECT_CLASS} value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required>
          <option value="">Choose…</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="edit-room">Room</Label>
        <select id="edit-room" className={SELECT_CLASS} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="edit-note">Why {published ? "(required)" : "(optional)"}</Label>
        <Input id="edit-note" className="h-11 sm:h-9" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} required={published} aria-invalid={Boolean(errors.note)} placeholder="e.g. Lab is free on Tuesdays" />
        <FieldError errors={errors.note} />
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !subjectId || !teacherId || (published && !note.trim())}>
          {pending ? "Saving…" : "Save period"}
        </Button>
        {current && (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending || (published && !note.trim())} onClick={() => save(null)}>
            Make it a free period
          </Button>
        )}
      </div>
    </form>
  );
}


/** Suggestions with their reasons, grouped by section (collapsed, paged); apply one, several, a section or all — each lands in the change log with its rationale. */
export function SuggestionsApply({
  slug,
  versionId,
  suggestions,
  sectionLabels,
}: {
  slug: string;
  versionId: string;
  suggestions: TimetableSuggestion[];
  sectionLabels: Record<string, string>;
}) {
  const { pending, run } = useRun();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [section, setSection] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<number[] | null>(null);
  const allGroups = useMemo(() => groupSuggestions(suggestions, sectionLabels), [suggestions, sectionLabels]);
  const groups = useMemo(() => groupSuggestions(suggestions, sectionLabels, { section, text }), [suggestions, sectionLabels, section, text]);
  const apply = (indexes: number[]) => {
    setConfirming(null);
    run(
      () =>
        applyTimetableChanges(slug, {
          versionId,
          kind: "suggestion",
          changes: indexes.map((i) => {
            const s = suggestions[i];
            return {
              classSectionId: s.slot.classSectionId,
              weekday: s.slot.weekday,
              periodId: s.slot.periodId,
              after: { subjectId: s.slot.subjectId, teacherId: s.slot.teacherId, roomId: s.slot.roomId ?? null },
              reason: s.rationale,
              rules: s.rules,
            };
          }),
        }),
      (d) => `Applied ${d.applied} suggestion${d.applied === 1 ? "" : "s"} — each is in the change log`,
      () => setPicked(new Set()),
    );
  };
  const request = (indexes: number[]) => (indexes.length > CONFIRM_ABOVE ? setConfirming(indexes) : apply(indexes));
  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = suggestions.map((_, i) => i).slice(0, 200);
  const alone = allGroups.length === 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="min-h-11 sm:min-h-9" disabled={pending || picked.size === 0} onClick={() => request([...picked].sort((a, b) => a - b))}>
          Apply selected ({picked.size})
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => request(all)}>
          Apply all {all.length}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {picked.size} selected
        </span>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Confirm applying suggestions" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary p-3 text-sm">
          <span>
            Apply {confirming.length} suggestions to this draft? Each is logged and can be undone.
          </span>
          <Button type="button" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => apply(confirming)}>
            Yes, apply {confirming.length}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {allGroups.length > 1 && (
          <label className="grid gap-1 text-sm">
            Section
            <select value={section} onChange={(e) => setSection(e.target.value)} className={SELECT_CLASS}>
              <option value="">All sections</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          Find teacher or subject
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Maths or Rao" className="h-11 sm:h-9" />
        </label>
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">No suggestion matches this filter.</p>}
      <ul className="space-y-2">
        {groups.map((g) => {
          const isOpen = open.has(g.id) || alone || text.trim() !== "";
          const shown = visibleCount(g.items.length, pages[g.id] ?? 1);
          const panelId = `sugg-group-${g.id}`;
          const full = allGroups.find((x) => x.id === g.id) ?? g;
          return (
            <li key={g.id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleOpen(g.id)}
                  className="min-h-11 text-left text-sm font-medium sm:min-h-9"
                >
                  {isOpen ? "▾" : "▸"} {g.label} · {g.items.length} suggestion{g.items.length === 1 ? "" : "s"}
                </button>
                <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => request(full.items.map((i) => i.index))}>
                  Apply all in this section ({full.items.length})
                </Button>
              </div>
              {isOpen && (
                <div id={panelId}>
                  <ul className="divide-y divide-border border-t border-border">
                    {g.items.slice(0, shown).map(({ index: i, suggestion: s }) => (
                      <li key={`${s.slot.classSectionId}-${s.slot.weekday}-${s.slot.periodId}`} className="flex gap-3 p-3">
                        <input
                          id={`sugg-${i}`}
                          type="checkbox"
                          className="mt-1 size-5 shrink-0 accent-primary"
                          checked={picked.has(i)}
                          onChange={() => toggle(i)}
                          aria-describedby={`sugg-why-${i}`}
                        />
                        <div className="min-w-0 space-y-1">
                          <label htmlFor={`sugg-${i}`} className="block text-sm font-medium">
                            {s.action}
                          </label>
                          <p id={`sugg-why-${i}`} className="text-sm text-muted-foreground">
                            {s.rationale}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {s.rules.map((r) => (
                              <Badge key={r} variant="secondary">
                                {ruleLabel(r)}
                              </Badge>
                            ))}
                          </div>
                          {s.alternatives.length > 0 && (
                            <details className="text-sm">
                              <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">Why not someone else? ({s.alternatives.length})</summary>
                              <ul className="mt-1 space-y-1 text-muted-foreground">
                                {s.alternatives.map((a) => (
                                  <li key={`${a.teacherId}-${a.subject}`}>
                                    <span className="font-medium text-foreground">
                                      {a.subject} with {a.teacher}:
                                    </span>{" "}
                                    {a.reason} <Badge variant="outline">{ruleLabel(a.rule)}</Badge>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {shown < g.items.length && (
                    <div className="border-t border-border p-2">
                      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setPages((p) => ({ ...p, [g.id]: (p[g.id] ?? 1) + 1 }))}>
                        Show {Math.min(GROUP_PAGE, g.items.length - shown)} more ({g.items.length - shown} left)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Publish a draft; while it breaks a rule the note is required (the action refuses without it). */
export function PublishForm({ slug, versionId, violations }: { slug: string; versionId: string; violations: number }) {
  const { pending, errors, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => publishVersion(slug, { versionId, ...(note.trim() ? { note: note.trim() } : {}) }), "Published — the previous version is archived, not deleted");
      }}
    >
      <div className="grid flex-1 gap-1">
        <Label htmlFor="publish-note">{violations > 0 ? `Why publish with ${violations} rule issue${violations === 1 ? "" : "s"}? (required)` : "Note (optional)"}</Label>
        <Input id="publish-note" className="h-11 sm:h-9" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} required={violations > 0} aria-invalid={Boolean(errors.note)} />
        <FieldError errors={errors.note} />
      </div>
      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || (violations > 0 && !note.trim())}>
        {pending ? "Publishing…" : "Publish this version"}
      </Button>
    </form>
  );
}

/** Re-publish an archived version as the current timetable (the current one is archived, never deleted). */
export function RestoreVersionForm({ slug, versionId, name }: { slug: string; versionId: string; name: string }) {
  const { pending, errors, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => publishVersion(slug, { versionId, note: note.trim() }), `Restored "${name}" as the published timetable`);
      }}
    >
      <div className="grid flex-1 gap-1">
        <Label htmlFor={`restore-note-${versionId}`}>Why restore &ldquo;{name}&rdquo;? (required)</Label>
        <Input id={`restore-note-${versionId}`} className="h-11 sm:h-9" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} required aria-invalid={Boolean(errors.note)} />
        <FieldError errors={errors.note} />
      </div>
      <Button type="submit" className="min-h-11 sm:min-h-9" disabled={pending || !note.trim()}>
        {pending ? "Restoring…" : "Restore this version"}
      </Button>
    </form>
  );
}

export function SnapshotCreateForm({ slug, versionId }: { slug: string; versionId: string }) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createTimetableSnapshot(slug, { versionId, name: name.trim() }), (d) => `Snapshot saved (${d.slotCount} periods)`, () => setName(""));
      }}
    >
      <div className="grid flex-1 gap-1">
        <Label htmlFor="snapshot-name">Snapshot name</Label>
        <Input id="snapshot-name" className="h-11 sm:h-9" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="before exam week" required />
      </div>
      <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending || !name.trim()}>
        Save snapshot
      </Button>
    </form>
  );
}

export function SnapshotRestoreButton({ slug, snapshotId, name, published }: { slug: string; snapshotId: string; name: string; published: boolean }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-2">
      {published && (
        <Input aria-label={`Why restore ${name}`} className="h-9 w-48" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (required)" />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-9"
        disabled={pending || (published && !note.trim())}
        onClick={() => run(() => restoreTimetableSnapshot(slug, { snapshotId, ...(note.trim() ? { note: note.trim() } : {}) }), (d) => `Restored "${name}" — ${d.applied} period change${d.applied === 1 ? "" : "s"} logged`)}
      >
        Restore
      </Button>
    </span>
  );
}

/** A new draft copied from a version (usually the published one) — where suggestions and edits are tried before publishing. */
export function NewDraftForm({ slug, academicYearId, copyFromVersionId }: { slug: string; academicYearId: string; copyFromVersionId?: string }) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createVersion(slug, { academicYearId, name: name.trim(), ...(copyFromVersionId ? { copyFromVersionId } : {}) }), "Draft created", () => setName(""));
      }}
    >
      <div className="grid flex-1 gap-1">
        <Label htmlFor="draft-name">New draft {copyFromVersionId ? "(copy of the published timetable)" : ""}</Label>
        <Input id="draft-name" className="h-11 sm:h-9" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Term 2 draft" required />
      </div>
      <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending || !name.trim()}>
        Create draft
      </Button>
    </form>
  );
}
