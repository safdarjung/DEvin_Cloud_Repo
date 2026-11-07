"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { publishPage } from "@/modules/website/actions";

export function PublishThisVersion({
  institutionSlug,
  pageId,
  versionId,
}: {
  institutionSlug: string;
  pageId: string;
  versionId: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async () => publishPage(institutionSlug, { pageId, versionId }),
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Publishing…" : "Publish this version"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}
