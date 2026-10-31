"use client";

// T-028 — 06 §W4 step 5: turn an `accepted` application into an enrolled
// student. enrolApplicant (the real boundary) validates every id and does
// all the writing in one DB transaction; this dialog only offers the
// section/fee-structure/roll-no picker and shows the result.
import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LimitedBadge } from "@/components/honesty";
import type { ActionResult } from "@/lib/actions/result";
import { enrolApplicant } from "@/modules/admissions/actions";
import type { SectionCapacityOption } from "@/modules/admissions/queries";
import type { FeeStructureSummary } from "@/modules/finance/queries";

interface EnrolResult {
  studentId: string;
  admissionNo: string;
  invoiceId: string | null;
  alreadyEnrolled: boolean;
}

interface EnrolDialogProps {
  institutionSlug: string;
  applicationId: string;
  sections: SectionCapacityOption[];
  feeStructures: FeeStructureSummary[];
  /** application.status === "accepted" (and canEnrol) — the dialog is offered only then. */
  enabled: boolean;
}

export function EnrolDialog({ institutionSlug, applicationId, sections, feeStructures, enabled }: EnrolDialogProps) {
  const [open, setOpen] = useState(false);
  const [classSectionId, setClassSectionId] = useState(sections[0]?.id ?? "");
  const [feeStructureId, setFeeStructureId] = useState(
    feeStructures.find((f) => f.isDefault)?.id ?? feeStructures[0]?.id ?? "",
  );
  const [rollNo, setRollNo] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult<EnrolResult> | null, FormData>(async () => {
    return enrolApplicant(institutionSlug, {
      applicationId,
      classSectionId,
      feeStructureId,
      rollNo: rollNo.trim() ? Number(rollNo) : undefined,
    });
  }, null);

  const success = state && state.ok ? state.data : null;

  // Bug found via e2e (T-028 phase 2): enrolApplicant's revalidatePath
  // triggers an automatic refetch of this same page once the action
  // resolves; the application's status flips accepted -> enrolled in that
  // refetch. ApplicationDetail used to gate *mounting* this component on
  // status === "accepted", which unmounted it (and threw away its local
  // `success` state — the admission no / links the user just got) the
  // instant enrolment succeeded. Fix: ApplicationDetail now always mounts
  // this component and only this early-return depends on status, so
  // `success` (set by the same click that caused the refetch) survives it.
  if (!enabled && !success) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Enrol
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enrol this applicant</DialogTitle>
          <DialogDescription>
            Creates the student, links the guardian, assigns a seat and generates the first invoice.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-3">
            <p className="text-sm">
              {success.alreadyEnrolled ? "Already enrolled — admission " : "Enrolled — admission "}
              <span className="font-medium">{success.admissionNo}</span>.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <LimitedBadge />
              <span className="text-muted-foreground">Guardian login invite not yet available.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/${institutionSlug}/students/${success.studentId}`}>View student profile</Link>
              </Button>
              {success.invoiceId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${institutionSlug}/finance/invoices/${success.invoiceId}`}>View invoice</Link>
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : feeStructures.length === 0 ? (
          // fee_structures_select RLS (20261028000008) is owner/principal/
          // admin/accountant only — an "admissions" caller (who does hold
          // admissions.enrol, 07 §2.2) sees none here even when structures
          // exist. Surfaced instead of a silently-empty, disabled form.
          <p className="text-muted-foreground text-sm">
            No fee structure is visible for your role. Ask an owner, admin or accountant to enrol this applicant, or to
            set up a fee structure for this grade first.
          </p>
        ) : (
          <form action={formAction} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="classSectionId">
                Section
              </label>
              <Select value={classSectionId} onValueChange={setClassSectionId}>
                <SelectTrigger id="classSectionId" className="w-full">
                  <SelectValue placeholder="Choose a section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => {
                    const full = s.capacity !== null && s.active >= s.capacity;
                    return (
                      <SelectItem key={s.id} value={s.id} disabled={full}>
                        {s.name} ({s.active}/{s.capacity ?? "∞"}){full ? " — full" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="feeStructureId">
                Fee structure
              </label>
              <Select value={feeStructureId} onValueChange={setFeeStructureId}>
                <SelectTrigger id="feeStructureId" className="w-full">
                  <SelectValue placeholder="Choose a fee structure" />
                </SelectTrigger>
                <SelectContent>
                  {feeStructures.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="rollNo">
                Roll no (optional)
              </label>
              <Input id="rollNo" type="number" min="1" step="1" value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
            </div>

            {state && !state.ok && (
              <p role="alert" className="text-destructive text-sm">
                {state.error.message}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending || !classSectionId || !feeStructureId}>
                {pending ? "Enrolling…" : "Enrol"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
