"use client";

// F18 §H step 4: paste emails + role → core.member.invite (invite_member, 0079) per
// address. Delivery is reported per result: "simulated" means no email went out,
// so the copyable invite link is the only way the person receives it.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SimulatedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { inviteMember } from "@/modules/core/actions";
import { setProgress } from "@/modules/core/setup/actions";
import { MAX_INVITES_PER_BATCH, parseEmailList } from "@/modules/core/setup/email-list";
import type { SetupStepState } from "@/modules/core/setup/queries";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const ROLES = [
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "admissions", label: "Admissions" },
  { value: "exam_controller", label: "Exam controller" },
] as const;
type Role = (typeof ROLES)[number]["value"];

type Outcome =
  | { email: string; ok: true; delivery: "sent" | "simulated" | "failed"; link: string }
  | { email: string; ok: false; message: string };

interface StepInviteProps {
  institutionSlug: string;
  state: SetupStepState;
  invitationCount: number;
}

export function StepInvite({ institutionSlug, state, invitationCount }: StepInviteProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [role, setRole] = useState<Role>("teacher");
  const [pending, setPending] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { valid, invalid, duplicates } = parseEmailList(text);
  const tooMany = valid.length > MAX_INVITES_PER_BATCH;

  async function send() {
    setPending(true);
    setError(null);
    const results: Outcome[] = [];
    for (const email of valid) {
      const res = await inviteMember(institutionSlug, { email, role });
      results.push(
        res.ok
          ? { email, ok: true, delivery: res.data.delivery, link: `${window.location.origin}/invite#token=${res.data.token}` }
          : { email, ok: false, message: describeActionError(res.error) },
      );
    }
    setOutcomes(results);
    if (results.some((r) => r.ok)) {
      const mark = await setProgress(institutionSlug, { step: "invite", state: "done" });
      if (!mark.ok) setError(describeActionError(mark.error));
      setText("");
      router.refresh();
    }
    setPending(false);
  }

  async function skip() {
    setPending(true);
    const res = await setProgress(institutionSlug, { step: "invite", state: state === "dismissed" ? "todo" : "dismissed" });
    setPending(false);
    if (!res.ok) return setError(describeActionError(res.error));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {invitationCount > 0 && <p className="text-sm text-muted-foreground">{invitationCount} invitations have been created so far.</p>}
      <p className="text-sm text-muted-foreground">
        Whether an email is sent depends on the school&apos;s email channel. Each result below says what happened. If no email was sent, copy the link and share it yourself.
      </p>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-emails">Email addresses (one per line or separated by commas)</Label>
          <textarea
            id="invite-emails"
            rows={5}
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select id="invite-role" className={SELECT_CLASS} value={role} disabled={pending} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {invalid.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Not valid email addresses, fix before sending: {invalid.join(", ")}
        </p>
      )}
      {tooMany && (
        <p role="alert" className="text-sm text-destructive">
          Send at most {MAX_INVITES_PER_BATCH} at a time.
        </p>
      )}
      {valid.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {valid.length} valid{duplicates > 0 ? `, ${duplicates} duplicate ignored` : ""}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {outcomes.length > 0 && (
        <ul className="space-y-2 text-sm" aria-label="Invitation results">
          {outcomes.map((o) => (
            <li key={o.email} className="rounded-md border border-border p-2">
              <span className="font-medium">{o.email}</span>:{" "}
              {o.ok ? (
                <>
                  {o.delivery === "sent" && "invited, email sent."}
                  {o.delivery === "failed" && "invited, but the email failed. Share the link."}
                  {o.delivery === "simulated" && (
                    <>
                      invited, no email sent <SimulatedBadge />. Share the link.
                    </>
                  )}
                  {o.delivery !== "sent" && (
                    <input
                      readOnly
                      aria-label={`Invite link for ${o.email}`}
                      value={o.link}
                      onFocus={(e) => e.currentTarget.select()}
                      className="mt-1 block w-full rounded border border-input bg-transparent px-2 py-1 text-xs"
                    />
                  )}
                </>
              ) : (
                <span className="text-destructive">{o.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={send} disabled={pending || valid.length === 0 || invalid.length > 0 || tooMany}>
          {pending ? "Sending…" : `Invite ${valid.length || ""} ${valid.length === 1 ? "person" : "people"}`.replace("  ", " ")}
        </Button>
        <Button variant="ghost" onClick={skip} disabled={pending}>
          {state === "dismissed" ? "Resume this step" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
