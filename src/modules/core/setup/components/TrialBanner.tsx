import Link from "next/link";
import { trialStatus } from "@/modules/core/setup/trial";

/** Owner-only reminder of the 15-day free trial. Display only; the school keeps working after it ends. */
export function TrialBanner({ createdAt }: { createdAt?: string }) {
  const trial = trialStatus(createdAt);
  if (trial.state === "none") return null;
  const text =
    trial.state === "ended"
      ? "Your 15-day free trial has ended."
      : `Free trial: ${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left.`;
  return (
    <p role="status" className="mb-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
      {text}{" "}
      <Link href="/contact" className="font-medium underline underline-offset-2">
        Talk to us about continuing
      </Link>
    </p>
  );
}
