"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startAttempt } from "@/modules/online-tests/actions";
import type { MyTest } from "@/modules/online-tests/queries";
import { fmtDateTime, run } from "./test-ui";

export function StartPanel({ slug, test }: { slug: string; test: MyTest }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const resuming = test.openAttemptId !== null;
  const exhausted = !resuming && test.attemptsUsed >= test.maxAttempts;

  async function start() {
    setBusy(true);
    const r = await run(startAttempt(slug, { testId: test.testId, clientInfo: { userAgent: navigator.userAgent.slice(0, 300), tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
    if (r) router.push(`/${slug}/portal/tests/attempt/${r.attemptId}`);
    else setBusy(false);
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">Before you begin</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>You have {test.durationMinutes} minutes once you start. The clock runs on the school&apos;s server, so reloading or closing the page does not pause it.</li>
        <li>Open until {fmtDateTime(test.closesAt)}. Attempts used: {test.attemptsUsed} of {test.maxAttempts}.</li>
        <li>Answers save automatically. If your connection drops they are kept on this device and sent when it returns.</li>
        <li>When time runs out, your test is submitted for you.</li>
        <li>Leaving this tab is noted for your teacher.</li>
      </ul>
      {exhausted ? <p className="text-sm text-destructive">You have used all your attempts.</p> : <Button onClick={start} disabled={busy} data-testid="start-test">{busy ? "Starting..." : resuming ? "Resume test" : "Start test"}</Button>}
    </div>
  );
}
