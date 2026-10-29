"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/result";
import { createPage } from "@/modules/website/actions";
import type { PageSummary } from "@/modules/website/queries";

interface PageListProps {
  institutionSlug: string;
  pages: PageSummary[];
  canEdit: boolean;
}

export function PageList({ institutionSlug, pages, canEdit }: PageListProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) => {
      const slug = String(formData.get("slug") ?? "").trim();
      const title = String(formData.get("title") ?? "").trim();
      return createPage(institutionSlug, { slug, title });
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="space-y-4">
      {pages.length === 0 ? (
        <p className="text-muted-foreground text-sm">No pages yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page) => (
              <TableRow key={page.id}>
                <TableCell>
                  <Link href={`/${institutionSlug}/website/pages/${page.id}`} className="hover:underline">
                    {page.title}
                  </Link>
                </TableCell>
                <TableCell>{page.slug}</TableCell>
                <TableCell>
                  <Badge variant={page.publishedVersionId ? "default" : "secondary"}>
                    {page.publishedVersionId ? "published" : "no published version"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canEdit && (
        <form action={formAction} className="flex items-end gap-2 border-t pt-4">
          <div>
            <label className="text-sm font-medium" htmlFor="slug">
              Slug
            </label>
            <Input id="slug" name="slug" placeholder="e.g. gallery" required maxLength={100} />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="title">
              Title
            </label>
            <Input id="title" name="title" placeholder="e.g. Gallery" required maxLength={200} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "New page"}
          </Button>
          {state && !state.ok && (
            <span role="alert" className="text-destructive text-sm">
              {state.error.message}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
