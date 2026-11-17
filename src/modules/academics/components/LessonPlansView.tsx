"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { deleteLessonPlan, markCovered, upsertLessonPlan } from "@/modules/academics/curriculum.actions";
import type { LessonPlanRow, SectionUnitRow } from "@/modules/academics/curriculum.queries";
import { AnimatedList, ProgressBar } from "@/components/widgets/viz";
import { LessonPlanAiDraft } from "@/modules/ai/components/LessonPlanAiDraft";

export interface SubjectUnits {
  subjectId: string;
  subjectName: string;
  units: SectionUnitRow[];
}

interface Props {
  institutionSlug: string;
  classSectionId: string;
  /** Every section subject id -> name, so plans in subjects this member does not teach still show their subject. */
  subjectNames?: Readonly<Record<string, string>>;
  /** Institution-local date (YYYY-MM-DD) used as the default plan date and the covered-on date. */
  today: string;
  subjects: SubjectUnits[];
  plans: LessonPlanRow[];
  canManage: boolean;
  /** features-18 §C: lesson_plan_writer capability on for this role. */
  canDraftWithAi?: boolean;
  /** 0139: unit id -> "Chapter 4 of Ganita Prakash". */
  unitChapterLabels?: Record<string, string>;
}

const NO_UNIT = "none";
const dateLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

interface Draft {
  id?: string;
  subjectId: string;
  curriculumUnitId: string;
  plannedOn: string;
  title: string;
  objectives: string;
  resources: string;
}

export function LessonPlansView({ institutionSlug, classSectionId, today, subjects, plans, canManage, canDraftWithAi = false, unitChapterLabels = {}, subjectNames = {} }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LessonPlanRow | null>(null);
  const subjectName = (id: string) => subjects.find((s) => s.subjectId === id)?.subjectName ?? subjectNames[id] ?? "Subject";

  function openNew() {
    setFormError(null);
    setDraft({ subjectId: subjects[0]?.subjectId ?? "", curriculumUnitId: NO_UNIT, plannedOn: today, title: "", objectives: "", resources: "" });
  }

  function openEdit(p: LessonPlanRow) {
    setFormError(null);
    setDraft({
      id: p.id,
      subjectId: p.subjectId,
      curriculumUnitId: p.curriculumUnitId ?? NO_UNIT,
      plannedOn: p.plannedOn,
      title: p.title,
      objectives: p.objectives,
      resources: p.resources ?? "",
    });
  }

  function save() {
    if (!draft) return;
    setFormError(null);
    start(async () => {
      const result = await upsertLessonPlan(institutionSlug, {
        ...(draft.id ? { id: draft.id } : {}),
        classSectionId,
        subjectId: draft.subjectId,
        curriculumUnitId: draft.curriculumUnitId === NO_UNIT ? null : draft.curriculumUnitId,
        plannedOn: draft.plannedOn,
        title: draft.title,
        objectives: draft.objectives,
        ...(draft.resources.trim() ? { resources: draft.resources } : {}),
      });
      if (!result.ok) {
        const message = actionErrorMessage(result.error);
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(draft.id ? "Lesson plan updated" : "Lesson plan added");
      setDraft(null);
      router.refresh();
    });
  }

  function remove() {
    if (!toDelete) return;
    const target = toDelete;
    start(async () => {
      const result = await deleteLessonPlan(institutionSlug, { id: target.id });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success("Lesson plan deleted");
      setToDelete(null);
      router.refresh();
    });
  }

  function toggleCovered(unitId: string, covered: boolean) {
    start(async () => {
      const result = await markCovered(institutionSlug, {
        classSectionId,
        curriculumUnitId: unitId,
        covered,
        ...(covered ? { coveredOn: today } : {}),
      });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success(covered ? "Marked covered" : "Coverage removed");
      router.refresh();
    });
  }

  const draftUnits = subjects.find((s) => s.subjectId === draft?.subjectId)?.units ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Lesson plans</CardTitle>
          {canManage && subjects.length > 0 && (
            <Button onClick={openNew} disabled={pending}>
              New lesson plan
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <EmptyState
              title="No lesson plans for this section"
              description={subjects.length === 0 ? "You have no subjects assigned in this section." : "Add the first plan for an upcoming class."}
              action={canManage && subjects.length > 0 ? <Button onClick={openNew}>New lesson plan</Button> : undefined}
            />
          ) : (
            <AnimatedList className="space-y-0 divide-y" ariaLabel="Lesson plans">
              {plans.map((p) => (
                <div key={p.id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.title}</span>
                      <Badge variant="outline">{subjectName(p.subjectId)}</Badge>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{dateLabel.format(new Date(`${p.plannedOn}T00:00:00Z`))}</span>
                  </div>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">{p.objectives}</p>
                  {canManage && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)} disabled={pending}>
                        Edit
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setToDelete(p)} disabled={pending}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </AnimatedList>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Syllabus coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {subjects.every((s) => s.units.length === 0) ? (
            <EmptyState title="No curriculum units yet" description="Units appear once the school adds them for this grade and subject." />
          ) : (
            subjects
              .filter((s) => s.units.length > 0)
              .map((s) => {
                const done = s.units.filter((u) => u.coveredOn).length;
                return (
                  <div key={s.subjectId}>
                    <p className="mb-1 text-sm font-medium">
                      {s.subjectName} <span className="text-xs tabular-nums text-muted-foreground">{done}/{s.units.length} covered</span>
                    </p>
                    <ProgressBar
                      className="mb-2"
                      label={`${s.subjectName} coverage`}
                      value={done}
                      max={s.units.length}
                      showValue={false}
                      tone={done === s.units.length ? "success" : "default"}
                    />
                    <ul className="divide-y">
                      {s.units.map((u) => (
                        <li key={u.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0">
                            <Link href={`/${institutionSlug}/assignments/units/${u.id}`} className="block truncate underline-offset-4 hover:underline">
                              {u.title}
                            </Link>
                            <span className="block truncate text-xs text-muted-foreground">{unitChapterLabels[u.id] ?? "Book & files"}</span>
                          </span>
                          {u.coveredOn ? (
                            <span className="flex shrink-0 items-center gap-2">
                              <Badge variant="success">Covered</Badge>
                              {canManage && (
                                <Button size="sm" variant="ghost" onClick={() => toggleCovered(u.id, false)} disabled={pending}>
                                  Undo
                                </Button>
                              )}
                            </span>
                          ) : (
                            canManage && (
                              <Button size="sm" variant="outline" onClick={() => toggleCovered(u.id, true)} disabled={pending}>
                                Mark covered
                              </Button>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
          )}
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit lesson plan" : "New lesson plan"}</DialogTitle>
            <DialogDescription>Planned lessons are visible to staff who teach this section.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  Subject
                  <Select
                    value={draft.subjectId}
                    onValueChange={(v) => setDraft({ ...draft, subjectId: v, curriculumUnitId: NO_UNIT })}
                    disabled={Boolean(draft.id)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.subjectId} value={s.subjectId}>
                          {s.subjectName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  Planned for
                  <Input type="date" required value={draft.plannedOn} onChange={(e) => setDraft({ ...draft, plannedOn: e.target.value })} />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                Unit
                <Select value={draft.curriculumUnitId} onValueChange={(v) => setDraft({ ...draft, curriculumUnitId: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT}>No unit</SelectItem>
                    {draftUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {canDraftWithAi && draft.curriculumUnitId !== NO_UNIT && (
                <LessonPlanAiDraft
                  key={draft.curriculumUnitId}
                  institutionSlug={institutionSlug}
                  classSectionId={classSectionId}
                  subjectId={draft.subjectId}
                  curriculumUnitId={draft.curriculumUnitId}
                  onDraft={(form) => setDraft((d) => (d ? { ...d, ...form, title: d.title || form.title } : d))}
                />
              )}
              <label className="block space-y-1 text-sm">
                Title
                <Input required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="block space-y-1 text-sm">
                Objectives
                <Textarea required rows={3} maxLength={2000} value={draft.objectives} onChange={(e) => setDraft({ ...draft, objectives: e.target.value })} />
              </label>
              <label className="block space-y-1 text-sm">
                Resources (optional)
                <Textarea rows={2} maxLength={2000} value={draft.resources} onChange={(e) => setDraft({ ...draft, resources: e.target.value })} />
              </label>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !draft.subjectId}>
                  {pending ? "Saving…" : "Save plan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this lesson plan?</DialogTitle>
            <DialogDescription>{toDelete?.title} will be removed. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "Deleting…" : "Delete plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
