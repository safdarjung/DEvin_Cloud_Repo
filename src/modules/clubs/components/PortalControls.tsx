"use client";

import { Button } from "@/components/ui/button";
import { cancelClubEventSignup, joinClub, leaveClub, signUpClubEvent } from "@/modules/clubs/actions";
import { useRun } from "./use-run";

export function MembershipButton({ institutionSlug, clubId, studentId, isMember, name }: { institutionSlug: string; clubId: string; studentId: string; isMember: boolean; name: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant={isMember ? "outline" : "default"}
      disabled={pending}
      aria-label={`${isMember ? "Leave" : "Join"} ${name}`}
      onClick={() =>
        isMember
          ? run(() => leaveClub(institutionSlug, { clubId, studentId }), "Left the club")
          : run(() => joinClub(institutionSlug, { clubId, studentId }), "Joined the club")
      }
    >
      {pending ? "Saving…" : isMember ? "Leave" : "Join"}
    </Button>
  );
}

export function SignupButton({ institutionSlug, eventId, studentId, signedUp, title }: { institutionSlug: string; eventId: string; studentId: string; signedUp: boolean; title: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant={signedUp ? "outline" : "default"}
      disabled={pending}
      aria-label={`${signedUp ? "Cancel sign-up for" : "Sign up for"} ${title}`}
      onClick={() =>
        signedUp
          ? run(() => cancelClubEventSignup(institutionSlug, { eventId, studentId }), "Sign-up cancelled")
          : run(() => signUpClubEvent(institutionSlug, { eventId, studentId }), "Signed up")
      }
    >
      {pending ? "Saving…" : signedUp ? "Cancel sign-up" : "Sign up"}
    </Button>
  );
}
