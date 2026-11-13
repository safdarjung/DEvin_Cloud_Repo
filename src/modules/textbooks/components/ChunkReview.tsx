"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeActionError } from "@/lib/action-error";
import { updateChunk } from "@/modules/content/actions";
import type { ReviewChunk } from "@/modules/textbooks/queries";

function Chunk({ institutionSlug, chunk }: { institutionSlug: string; chunk: ReviewChunk }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(chunk.body);
  const [heading, setHeading] = useState(chunk.heading ?? "");
  const pages = chunk.pageFrom === chunk.pageTo ? `Page ${chunk.pageFrom}` : `Pages ${chunk.pageFrom}-${chunk.pageTo}`;
  return (
    <li data-testid="chunk" className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{pages}</span>
        {chunk.chapterNo !== null && <span>Chapter {chunk.chapterNo}</span>}
        {chunk.editedAt && <Badge variant="info">Edited</Badge>}
      </div>
      {editing ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateChunk(institutionSlug, { chunkId: chunk.id, body, heading: heading.trim() ? heading : null });
              if (!res.ok) return void toast.error(describeActionError(res.error));
              toast.success("Text saved");
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <Input aria-label="Heading (optional)" placeholder="Heading (optional)" maxLength={200} value={heading} onChange={(e) => setHeading(e.target.value)} disabled={pending} />
          <Textarea aria-label="Text" required rows={8} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} disabled={pending} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>Save</Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setBody(chunk.body); setHeading(chunk.heading ?? ""); setEditing(false); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          {chunk.heading && <p className="mt-1 text-sm font-semibold">{chunk.heading}</p>}
          <p className="mt-1 whitespace-pre-line text-sm">{chunk.body}</p>
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </>
      )}
    </li>
  );
}

export function ChunkReview({ institutionSlug, chunks }: { institutionSlug: string; chunks: ReviewChunk[] }) {
  return (
    <ul className="space-y-2" aria-label="Passages">
      {chunks.map((c) => <Chunk key={`${c.id}:${c.editedAt ?? ""}`} institutionSlug={institutionSlug} chunk={c} />)}
    </ul>
  );
}
