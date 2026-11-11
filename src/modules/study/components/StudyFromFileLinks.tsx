// "Make study material" for each readable file (0140): links into the study
// studio with the file picked as the source. The studio re-checks that the
// person may read it; NCERT books are links, not files, and never appear here.
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { FILE_READ_MAX_BYTES } from "@/lib/ai/file-input";

export function StudyFromFileLinks({ files, hrefBase }: { files: { id: string; title: string; sizeBytes: number }[]; hrefBase: string }) {
  const readable = files.filter((f) => f.sizeBytes <= FILE_READ_MAX_BYTES);
  if (readable.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Make study material from a file (the file is sent to the school&apos;s AI provider to be read):</p>
      <ul className="flex flex-wrap gap-2">
        {readable.map((f) => (
          <li key={f.id}>
            <Link
              href={`${hrefBase}${f.id}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Make study material from ${f.title}`}
            >
              <Sparkles className="size-3.5" aria-hidden /> {f.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
