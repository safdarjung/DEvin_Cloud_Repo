"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { inviteMember } from "@/modules/core/actions";

/** Invites a guardian to the parent portal. If no email went out, the link is shown to copy and send by hand. */
export function GuardianInviteButton({ institutionSlug, guardianId, email }: { institutionSlug: string; guardianId: string; email: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function invite() {
    setPending(true);
    setMessage(null);
    const res = await inviteMember(institutionSlug, { email, role: "guardian", guardianId });
    setPending(false);
    if (!res.ok) return setMessage(describeActionError(res.error));
    if (res.data.delivery === "sent") return setMessage(`Invite emailed to ${email}.`);
    setMessage("No email was sent from here. Send this link to the parent:");
    setLink(`${window.location.origin}/invite#token=${res.data.token}`);
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" onClick={invite} disabled={pending}>
        {pending ? "Inviting…" : "Invite to parent portal"}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {link && <input readOnly value={link} aria-label="Invite link" className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}
