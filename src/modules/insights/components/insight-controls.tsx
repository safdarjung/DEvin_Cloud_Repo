"use client";

// Insight buttons. Hiding them is UX only: every action re-checks
// insight.review / insight.read + ai.generate server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Eye, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import { dismissInsight, recordInsightAction, resolveInsight, reviewInsight } from "@/modules/insights/actions";
import { explainInsight } from "@/modules/insights/explain.actions";

type FieldErrors = Record<string, string[]> | undefined;

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-destructive">
      {errors.join(" ")}
    </p>
  );
}

export function InsightControls({
  institutionSlug,
  insightId,
  status,
  canReview,
  canExplain,
}: {
  institutionSlug: string;
  insightId: string;
  status: string;
  canReview: boolean;
  canExplain: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [closing, setClosing] = useState<"resolve" | "dismiss" | null>(null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ action: "", owner: "", rationale: "", expectedOutcome: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [formError, setFormError] = useState<string | null>(null);

  const open = status === "new" || status === "reviewing" || status === "actioned";
  // Stay mounted while a dialog is closing so Radix can restore focus after the status flips.
  if (!open && closing === null && !recording) return null;

  function run<T>(call: () => Promise<ActionResult<T>>, success: string, onOk?: () => void) {
    start(async () => {
      setFormError(null);
      setFieldErrors(undefined);
      const res = await call();
      if (res.ok) {
        toast.success(success);
        onOk?.();
        router.refresh();
      } else {
        setFieldErrors(res.error.fieldErrors);
        setFormError(res.error.message);
        toast.error(res.error.message);
      }
    });
  }

  function closeDialogs() {
    setClosing(null);
    setRecording(false);
    setNote("");
    setFormError(null);
    setFieldErrors(undefined);
  }

  return (
    <div className="flex flex-wrap gap-2" aria-busy={pending}>
      {canReview && status === "new" && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => reviewInsight(institutionSlug, { insightId }), "Marked as reviewing")}
        >
          <Eye aria-hidden /> Start review
        </Button>
      )}
      {open && canReview && (
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setRecording(true)}>
            <ClipboardList aria-hidden /> Record action
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setClosing("resolve")}>
            <CheckCircle2 aria-hidden /> Resolve
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setClosing("dismiss")}>
            <XCircle aria-hidden /> Dismiss
          </Button>
        </>
      )}
      {open && canExplain && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            toast.info("Generating AI explanation…");
            run(() => explainInsight(institutionSlug, { insightId }), "AI explanation saved");
          }}
        >
          <Sparkles aria-hidden /> {pending ? "Working…" : "Explain with AI"}
        </Button>
      )}

      <Dialog open={closing !== null} onOpenChange={(o) => !o && closeDialogs()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closing === "dismiss" ? "Dismiss insight" : "Resolve insight"}</DialogTitle>
            <DialogDescription>A note is required (5 to 500 characters) and is kept in the audit trail.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fn = closing === "dismiss" ? dismissInsight : resolveInsight;
              run(() => fn(institutionSlug, { insightId, note }), closing === "dismiss" ? "Insight dismissed" : "Insight resolved", closeDialogs);
            }}
          >
            <div>
              <Label htmlFor="insight-note">Note</Label>
              <Textarea
                id="insight-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={500}
                required
                aria-invalid={!!fieldErrors?.note}
                aria-describedby={fieldErrors?.note ? "insight-note-err" : undefined}
              />
              <FieldError id="insight-note-err" errors={fieldErrors?.note} />
            </div>
            {formError && !(fieldErrors && Object.keys(fieldErrors).length > 0) && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialogs}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : closing === "dismiss" ? "Dismiss" : "Resolve"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={recording} onOpenChange={(o) => !o && closeDialogs()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record action</DialogTitle>
            <DialogDescription>What will be done about this insight, by whom, and what outcome you expect.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => recordInsightAction(institutionSlug, { insightId, ...form, status: "planned" }),
                "Action recorded",
                () => {
                  setForm({ action: "", owner: "", rationale: "", expectedOutcome: "" });
                  closeDialogs();
                },
              );
            }}
          >
            {(
              [
                ["action", "Action", 200],
                ["owner", "Owner", 80],
                ["rationale", "Rationale", 500],
                ["expectedOutcome", "Expected outcome", 300],
              ] as const
            ).map(([key, label, max]) => (
              <div key={key}>
                <Label htmlFor={`ia-${key}`}>{label}</Label>
                <Input
                  id={`ia-${key}`}
                  value={form[key]}
                  maxLength={max}
                  required
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  aria-invalid={!!fieldErrors?.[key]}
                  aria-describedby={fieldErrors?.[key] ? `ia-${key}-err` : undefined}
                />
                <FieldError id={`ia-${key}-err`} errors={fieldErrors?.[key]} />
              </div>
            ))}
            {formError && !(fieldErrors && Object.keys(fieldErrors).length > 0) && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialogs}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
