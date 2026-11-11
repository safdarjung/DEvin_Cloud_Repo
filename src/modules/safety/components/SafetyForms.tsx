"use client";

// Hiding these is UX only: the actions re-check permission and Zod, and the
// definers re-check role, audience, alert state and the hourly cap.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { describeActionError } from "@/lib/action-error";
import type { ErrorCode } from "@/lib/actions/result";
import {
  acknowledgeSafetyAlert,
  closeSafetyAlert,
  markSafetyHeadcount,
  previewSafetyAudience,
  sendSafetyAlert,
  type AudiencePreview,
} from "@/modules/safety/actions";
import { AlertSendSchema, HeadcountSchema, SAFETY_AUDIENCES, SAFETY_KINDS, type AlertSendInput } from "@/modules/safety/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const KIND_TEXT = { emergency: "Emergency", drill: "Drill (practice)", closure: "School closure" } as const;
const AUDIENCE_TEXT = { all: "Everyone in the school", staff: "Staff only", sections: "Selected sections (their students and guardians, plus all staff)" } as const;

function errorText(error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> }): string {
  if (error.code === "rate_limited") return "At most 10 safety alerts can be sent per hour. Reach staff by phone or the PA system.";
  return describeActionError(error);
}

export function SendAlertForm({ institutionSlug, sections }: { institutionSlug: string; sections: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [audience, setAudience] = useState<(typeof SAFETY_AUDIENCES)[number]>("all");
  const [messageLength, setMessageLength] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [queuedWarning, setQueuedWarning] = useState(false);
  const [review, setReview] = useState<{ input: AlertSendInput; preview: AudiencePreview; form: HTMLFormElement } | null>(null);

  function onReview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQueuedWarning(false);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = AlertSendSchema.safeParse({
      kind: fd.get("kind"),
      title: fd.get("title"),
      message: fd.get("message"),
      audience: fd.get("audience"),
      sectionIds: audience === "sections" ? fd.getAll("sectionIds").map(String) : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await previewSafetyAudience(institutionSlug, { audience: parsed.data.audience, sectionIds: parsed.data.sectionIds });
      if (res.ok) setReview({ input: parsed.data, preview: res.data, form });
      else setError(errorText(res.error));
    });
  }

  function onConfirm() {
    if (!review) return;
    start(async () => {
      const res = await sendSafetyAlert(institutionSlug, review.input);
      if (res.ok) {
        if (res.data.delivery === "sent") toast.success("Alert sent. In-app notifications are delivered.");
        else setQueuedWarning(true);
        review.form.reset();
        setAudience("all");
        setMessageLength(0);
        setReview(null);
        router.refresh();
      } else {
        setReview(null);
        setError(errorText(res.error));
      }
    });
  }

  const p = review?.preview;
  return (
    <>
      <form onSubmit={onReview} className="grid gap-4" aria-busy={pending}>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Kind</legend>
          <div className="flex flex-wrap gap-4">
            {SAFETY_KINDS.map((k) => (
              <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="kind" value={k} defaultChecked={k === "drill"} required />
                {KIND_TEXT[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Label htmlFor="sa-title">Title</Label>
          <Input id="sa-title" name="title" required maxLength={200} placeholder="e.g. Fire drill at 11:00" />
        </div>
        <div>
          <Label htmlFor="sa-message">Message</Label>
          <Textarea
            id="sa-message"
            name="message"
            required
            maxLength={1000}
            rows={4}
            aria-describedby="sa-message-count"
            onChange={(e) => setMessageLength(e.currentTarget.value.length)}
            placeholder="What is happening and what people must do."
          />
          <p id="sa-message-count" className="text-muted-foreground mt-1 text-xs tabular-nums">
            {messageLength} / 1000 characters
          </p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Audience</legend>
          {SAFETY_AUDIENCES.map((a) => (
            <label key={a} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} />
              {AUDIENCE_TEXT[a]}
            </label>
          ))}
        </fieldset>
        {audience === "sections" && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Sections</legend>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-sm">No sections in the current academic year.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {sections.map((s) => (
                  <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" name="sectionIds" value={s.id} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {queuedWarning && (
          <p role="alert" className="text-destructive text-sm font-medium">
            Alert saved. Notifications are queued and not yet sent — run the job runner or check the Jobs page.
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending && !review ? "Counting the audience…" : "Review and send"}
          </Button>
        </div>
      </form>

      <Dialog open={review !== null} onOpenChange={(open) => !open && !pending && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Send {review ? KIND_TEXT[review.input.kind].toLowerCase() : ""} alert?
            </DialogTitle>
            <DialogDescription>
              {p && p.total > 0
                ? `This will notify ${p.total} ${p.total === 1 ? "person" : "people"}: ${p.staff} staff, ${p.guardians} guardians, ${p.students} students.`
                : "No one with an active account is in this audience. Pick another audience."}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{review.input.title}</p>
              <p className="whitespace-pre-line">{review.input.message}</p>
              <p className="text-muted-foreground text-xs">{AUDIENCE_TEXT[review.input.audience]}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReview(null)} disabled={pending}>
              Back
            </Button>
            <Button
              type="button"
              variant={review?.input.kind === "emergency" ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={pending || !p || p.total === 0}
            >
              {pending ? "Sending…" : `Send to ${p?.total ?? 0} ${p?.total === 1 ? "person" : "people"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AcknowledgeButton({ institutionSlug, alertId }: { institutionSlug: string; alertId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acknowledgeSafetyAlert(institutionSlug, { alertId });
            // conflict = already acknowledged (another tab): the refresh shows it.
            if (res.ok || res.error.code === "conflict") {
              toast.success("Acknowledged");
              router.refresh();
            } else setError(errorText(res.error));
          })
        }
      >
        {pending ? "Acknowledging…" : "I have seen this alert"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function HeadcountForm({
  institutionSlug,
  alertId,
  sections,
  initial,
}: {
  institutionSlug: string;
  alertId: string;
  /** One entry: the section is fixed (teacher view). Several: a picker (manager recording a phoned-in count). */
  sections: { id: string; label: string }[];
  initial?: { presentCount: number; missingCount: number; note: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const idBase = `hc-${alertId.slice(0, 8)}-${sections.length === 1 ? sections[0]!.id.slice(0, 8) : "pick"}`;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = HeadcountSchema.safeParse({
      alertId,
      classSectionId: sections.length === 1 ? sections[0]!.id : fd.get("classSectionId"),
      presentCount: Number(fd.get("presentCount")),
      missingCount: Number(fd.get("missingCount")),
      note: String(fd.get("note") ?? "") || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await markSafetyHeadcount(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Headcount saved");
        router.refresh();
      } else setError(errorText(res.error));
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4" aria-busy={pending}>
      {sections.length > 1 && (
        <div className="sm:col-span-4">
          <Label htmlFor={`${idBase}-section`}>Section</Label>
          <select id={`${idBase}-section`} name="classSectionId" required className={SELECT_CLASS} defaultValue="">
            <option value="" disabled>
              Select a section
            </option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor={`${idBase}-present`}>Present</Label>
        <Input id={`${idBase}-present`} name="presentCount" type="number" inputMode="numeric" min={0} max={1000} required defaultValue={initial?.presentCount} />
      </div>
      <div>
        <Label htmlFor={`${idBase}-missing`}>Missing</Label>
        <Input id={`${idBase}-missing`} name="missingCount" type="number" inputMode="numeric" min={0} max={1000} required defaultValue={initial?.missingCount ?? 0} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idBase}-note`}>Note (optional)</Label>
        <Input id={`${idBase}-note`} name="note" maxLength={200} defaultValue={initial?.note ?? ""} placeholder="e.g. 1 at the nurse's room" />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-4">
          {error}
        </p>
      )}
      <div className="sm:col-span-4">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : initial ? "Update headcount" : "Save headcount"}
        </Button>
      </div>
    </form>
  );
}

export function CloseAlertButton({ institutionSlug, alertId, title }: { institutionSlug: string; alertId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Close alert
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close “{title}”?</DialogTitle>
            <DialogDescription>
              Closing marks the situation as over. Nobody can acknowledge it or record headcounts after this, and it cannot be reopened.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep open
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await closeSafetyAlert(institutionSlug, { alertId });
                  if (res.ok) {
                    toast.success("Alert closed");
                    setOpen(false);
                    router.refresh();
                  } else setError(errorText(res.error));
                })
              }
            >
              {pending ? "Closing…" : "Close alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Re-renders the server page every `seconds` while it is visible, plus an on-demand refresh. No new dependency. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setUpdatedAt(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(() => {
            router.refresh();
            setUpdatedAt(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
          })
        }
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Refresh now
      </Button>
      <span className="text-muted-foreground">
        Counts update every {seconds} seconds{updatedAt ? ` · last ${updatedAt}` : ""}.
      </span>
    </div>
  );
}
