"use client";

// T-027 — 06 §W4 application detail: decision buttons with confirm, plus
// the decision timeline. The enrol button on an `accepted` application is a
// placeholder here (packet assumption) — T-028 replaces it with the real
// enrolApplicant flow.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import type { ApplicationDecisionRow, ApplicationRow } from "@/modules/admissions/queries";
import { DecisionTimeline } from "@/modules/admissions/components/DecisionTimeline";

interface ApplicationDetailProps {
  institutionSlug: string;
  application: ApplicationRow;
  decisions: ApplicationDecisionRow[];
  canDecideApplication: boolean;
}

const DECISIONS: ApplicationDecision[] = ["offer", "reject", "accept", "withdraw"];

export function ApplicationDetail({ institutionSlug, application, decisions, canDecideApplication }: ApplicationDetailProps) {
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
      <div>
        <h1 className="text-xl font-semibold">{name}</h1>
        <p className="text-muted-foreground text-sm">
          {application.applicationNo} · status: {application.status}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canDecideApplication && (
        <div className="flex flex-wrap gap-2">
          {DECISIONS.filter((d) => canDecide(application.status as ApplicationStatus, d)).map((decision) => (
            <Button key={decision} variant="outline" size="sm" disabled={pending} onClick={() => setConfirming(decision)}>
              {decision}
            </Button>
          ))}
          {application.status === "accepted" && (
            <Button variant="secondary" size="sm" disabled title="Enrolment lands with T-028">
              Enrol (coming soon)
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm: {confirming}</DialogTitle>
            <DialogDescription>This records a decision and updates the application&apos;s status.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={pending} onClick={confirmDecision}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Decisions</h2>
        <DecisionTimeline decisions={decisions} />
      </div>
    </div>
  );
}
