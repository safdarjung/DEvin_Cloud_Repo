"use client";

// T-027 — 06 §W4 application detail: decision buttons with confirm, plus
// the decision timeline. T-028 replaced the enrol placeholder with
// EnrolDialog, the real enrolApplicant flow.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decideApplication } from "@/modules/admissions/actions";
import { canDecide, type ApplicationDecision, type ApplicationStatus } from "@/modules/admissions/state";
import type { ApplicationDecisionRow, ApplicationRow, SectionCapacityOption } from "@/modules/admissions/queries";
import { applicationStatusVariant, DecisionTimeline } from "@/modules/admissions/components/DecisionTimeline";
import { EnrolDialog } from "@/modules/admissions/components/EnrolDialog";
import type { FeeStructureSummary } from "@/modules/finance/queries";
import { humanize } from "@/modules/finance/format";

interface ApplicationDetailProps {
  institutionSlug: string;
  application: ApplicationRow;
  decisions: ApplicationDecisionRow[];
  canDecideApplication: boolean;
  canEnrol: boolean;
  sections: SectionCapacityOption[];
  feeStructures: FeeStructureSummary[];
}

const DECISIONS: ApplicationDecision[] = ["offer", "reject", "accept", "withdraw"];

export function ApplicationDetail({
  institutionSlug,
  application,
  decisions,
  canDecideApplication,
  canEnrol,
  sections,
  feeStructures,
}: ApplicationDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ApplicationDecision | null>(null);

  const applicant = application.applicant as { firstName?: string; lastName?: string };
  const name = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "Applicant";

  function confirmDecision() {
    if (!confirming) return;
    setError(null);
    startTransition(async () => {
      const result = await decideApplication(institutionSlug, { applicationId: application.id, decision: confirming });
      setConfirming(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        description={application.applicationNo}
        back={{ href: `/${institutionSlug}/admissions/applications`, label: "Applications" }}
        actions={<Badge variant={applicationStatusVariant(application.status)}>{humanize(application.status)}</Badge>}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decisions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canDecideApplication && (
            <div className="flex flex-wrap gap-2">
              {DECISIONS.filter((d) => canDecide(application.status as ApplicationStatus, d)).map((decision) => (
                <Button key={decision} variant="outline" size="sm" disabled={pending} onClick={() => setConfirming(decision)}>
                  {humanize(decision)}
                </Button>
              ))}
            </div>
          )}

          {/* Always mounted (not gated by status here) — see EnrolDialog's own
              comment: gating the mount itself unmounts it, and its local
              success state, the instant enrolment flips the status it was
              gated on. */}
          <EnrolDialog
            institutionSlug={institutionSlug}
            applicationId={application.id}
            sections={sections}
            feeStructures={feeStructures}
            enabled={canEnrol}
          />

          <DecisionTimeline decisions={decisions} />
        </CardContent>
      </Card>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm: {confirming && humanize(confirming)}</DialogTitle>
            <DialogDescription>This records a decision and updates the application&apos;s status.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={pending} onClick={confirmDecision}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
