"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { setWebsiteLive } from "@/modules/website/actions";

/** website.publish only (page.tsx gates on hasPermission before rendering this). */
export function WebsiteLiveToggle({ institutionSlug, isLive }: { institutionSlug: string; isLive: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ isLive: boolean }> | null, FormData>(
    async () => setWebsiteLive(institutionSlug, { isLive: !isLive }),
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant={isLive ? "outline" : "default"} disabled={pending}>
        {pending ? "Saving…" : isLive ? "Take site offline" : "Make site live"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}
