"use client";

// F18 §H step 1 "Set up for me": board, grade range, sections per grade →
// preview of what will be created → confirm → core.setup.applyTemplate.
// The preview runs the same pure builder the server action uses.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/result";
import { applyTemplate, setProgress } from "@/modules/core/setup/actions";
import type { SetupStepState } from "@/modules/core/setup/queries";
import { BOARDS, buildSchoolTemplate, GRADE_LADDER, MAX_SECTIONS_PER_GRADE, type Board, type GradeCode } from "@/modules/core/setup/templates";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const SECTION_COUNTS = Array.from({ length: MAX_SECTIONS_PER_GRADE }, (_, i) => i + 1);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

interface StepStructureProps {
  institutionSlug: string;
  state: SetupStepState;
  gradeCount: number;
  /** YYYY-MM-DD start of the school's current academic year, used for the preview. */
  yearStart: string;
}

export function StepStructure({ institutionSlug, state, gradeCount, yearStart }: StepStructureProps) {
  const router = useRouter();
  const [board, setBoard] = useState<Board>("CBSE");
  const [fromGrade, setFromGrade] = useState<GradeCode>("I");
  const [toGrade, setToGrade] = useState<GradeCode>("X");
  const [sectionsPerGrade, setSectionsPerGrade] = useState(2);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return <p className="text-sm text-muted-foreground">Done: {gradeCount} grades are set up. Edit them under Academics.</p>;
  }

  const rangeOk = GRADE_LADDER.indexOf(fromGrade) <= GRADE_LADDER.indexOf(toGrade);
  const preview = rangeOk ? buildSchoolTemplate({ board, fromGrade, toGrade, sectionsPerGrade, yearStart }) : null;
  const subjectCount = preview ? new Set(preview.grades.flatMap((g) => g.subjects.map((s) => s.code))).size : 0;

  async function run(call: () => Promise<ActionResult<unknown>>) {
    setPending(true);
    setError(null);
    const result = await call();
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  const apply = () => run(() => applyTemplate(institutionSlug, { board, fromGrade, toGrade, sectionsPerGrade, yearStart }));
  const skip = () => run(() => setProgress(institutionSlug, { step: "structure", state: state === "dismissed" ? "todo" : "dismissed" }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-board">Board</Label>
          <select id="setup-board" className={SELECT_CLASS} value={board} onChange={(e) => setBoard(e.target.value as Board)}>
            {BOARDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-from">First grade</Label>
          <select id="setup-from" className={SELECT_CLASS} value={fromGrade} onChange={(e) => setFromGrade(e.target.value as GradeCode)}>
            {GRADE_LADDER.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-to">Last grade</Label>
          <select id="setup-to" className={SELECT_CLASS} value={toGrade} onChange={(e) => setToGrade(e.target.value as GradeCode)}>
            {GRADE_LADDER.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-sections">Sections per grade</Label>
          <select
            id="setup-sections"
            className={SELECT_CLASS}
            value={sectionsPerGrade}
            onChange={(e) => setSectionsPerGrade(Number(e.target.value))}
          >
            {SECTION_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!preview && <p className="text-sm text-destructive">The last grade must come after the first grade.</p>}
      {preview && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">This will create</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              Academic year {preview.academic_year.name} ({preview.academic_year.starts_on} to {preview.academic_year.ends_on}) with{" "}
              {preview.terms.length} terms
            </li>
            <li>
              {preview.grades.length} grades ({fromGrade} to {toGrade}), {preview.grades.length * sectionsPerGrade} sections
            </li>
            <li>{subjectCount} subjects for the {board} board</li>
            <li>A bell schedule of {preview.periods.filter((p) => !p.is_break).length} periods with 2 breaks</li>
            <li>
              A draft fee structure per grade with placeholder amounts (
              {preview.fee_structure.components.map((c) => `${c.head.replace("_", " ")} ${inr(c.amount_paise)}`).join(", ")}). Edit
              them before assigning fees.
            </li>
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <Button onClick={apply} disabled={pending || !preview}>
              {pending ? "Setting up…" : "Yes, create all of this"}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)} disabled={pending || !preview}>
            Set up for me
          </Button>
        )}
        <Button variant="ghost" onClick={skip} disabled={pending}>
          {state === "dismissed" ? "Resume this step" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
