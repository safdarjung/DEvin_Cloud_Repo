"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/result";
import { publishPage } from "@/modules/website/actions";
import type { VersionSummary } from "@/modules/website/queries";

interface VersionListProps {
  institutionSlug: string;
  pageId: string;
  versions: VersionSummary[];
  publishedVersionId: string | null;
  /** website.publish — admissions (website.edit only) gets no Publish button; the action would return `forbidden` anyway (defense in depth, not the only gate). */
  canPublish: boolean;
}

function PublishButton({
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
    <form action={formAction} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Publishing…" : "Publish"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}

export function VersionList({ institutionSlug, pageId, versions, publishedVersionId, canPublish }: VersionListProps) {
  if (versions.length === 0) {
    return <p className="text-muted-foreground text-sm">No versions saved yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>Saved</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((version) => {
          const isPublished = version.id === publishedVersionId;
          return (
            <TableRow key={version.id}>
              <TableCell>
                <Link
                  href={`/${institutionSlug}/website/pages/${pageId}/versions/${version.id}`}
                  className="hover:underline"
                >
                  v{version.versionNo}
                </Link>
              </TableCell>
              <TableCell>{new Date(version.createdAt).toLocaleString()}</TableCell>
              <TableCell>{isPublished && <Badge>published</Badge>}</TableCell>
              <TableCell>
                {!isPublished && canPublish && (
                  <PublishButton institutionSlug={institutionSlug} pageId={pageId} versionId={version.id} />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
