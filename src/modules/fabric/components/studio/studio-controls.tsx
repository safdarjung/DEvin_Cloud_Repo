"use client";

// F-UI-12 (live-fabric studio lane) — Propose/Approve/Reject buttons.
// Hiding "Approve"/"Reject" for a non-owner/principal is UX only: the
// studio.approve permission gate and decide_studio_request's own
// owner/principal check re-enforce it server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import { decideStudioRequest, proposeStudioRequest } from "@/modules/fabric/studio.actions";
import type { StudioRequestStatus } from "@/modules/fabric/studio.queries";

export function StudioControls({
  institutionSlug,
  requestId,
  status,
  canApprove,
}: {
  institutionSlug: string;
  requestId: string;
  status: StudioRequestStatus;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  function run<T>(call: () => Promise<ActionResult<T>>, success: string, onOk?: () => void) {
    start(async () => {
      const res = await call();
      if (res.ok) {
        toast.success(success);
        onOk?.();
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  if (status === "submitted") {
    return (
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          toast.info("Drafting a proposal with AI…");
          run(() => proposeStudioRequest(institutionSlug, { requestId }), "Proposal ready for review");
        }}
      >
        <Sparkles aria-hidden /> {pending ? "Drafting…" : "Generate proposal with AI"}
      </Button>
    );
  }

  if (status === "proposed") {
    if (!canApprove) {
      return <p className="text-sm text-muted-foreground">Needs principal or owner approval.</p>;
    }
    return (
      <div className="flex flex-wrap gap-2" aria-busy={pending}>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setDeciding("approve")}>
          <CheckCircle2 aria-hidden /> Approve
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setDeciding("reject")}>
          <XCircle aria-hidden /> Reject
        </Button>
        <Dialog
          open={deciding !== null}
          onOpenChange={(o) => {
            if (!o) {
              setDeciding(null);
              setNote("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{deciding === "reject" ? "Reject proposal" : "Approve proposal"}</DialogTitle>
              <DialogDescription>An optional note is kept with this request.</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const decision = deciding;
                if (!decision) return;
                run(
                  () => decideStudioRequest(institutionSlug, { requestId, decision, ...(note.trim() ? { note: note.trim() } : {}) }),
                  decision === "reject" ? "Request rejected" : "Request approved",
                  () => {
                    setDeciding(null);
                    setNote("");
                  },
                );
              }}
            >
              <div>
                <Label htmlFor="studio-decide-note">Note (optional)</Label>
                <Textarea id="studio-decide-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDeciding(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : deciding === "reject" ? "Reject" : "Approve"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return null;
}
