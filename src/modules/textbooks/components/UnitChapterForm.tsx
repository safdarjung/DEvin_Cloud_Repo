"use client";

// Teacher/leader: link a curriculum unit to one chapter of a mapped book and
// give that chapter the school's own title (NCERT publishes none as text).
// The actions re-check permission and RLS (subject teacher or leader only).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { setChapterTitles, setUnitChapter } from "@/modules/textbooks/actions";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";

interface BookOption {
  id: string;
  title: string;
  chapters: { no: number; title: string | null }[];
}

export function UnitChapterForm({
  institutionSlug,
  unitId,
  books,
  current,
}: {
  institutionSlug: string;
  unitId: string;
  books: BookOption[];
  current: { textbookId: string; chapterNo: number } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bookId, setBookId] = useState(current?.textbookId ?? books[0]?.id ?? "");
  const [chapterNo, setChapterNo] = useState(String(current?.chapterNo ?? ""));
  const book = books.find((b) => b.id === bookId);
  const chapter = book?.chapters.find((c) => String(c.no) === chapterNo);
  const [title, setTitle] = useState(chapter?.title ?? "");
  const [error, setError] = useState<string | null>(null);

  if (books.length === 0) {
    return <p className="text-sm text-muted-foreground">No textbook is set for this grade and subject yet. Add one on the Textbooks page.</p>;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const no = chapterNo ? Number(chapterNo) : null;
      const link = await setUnitChapter(institutionSlug, { unitId, textbookId: bookId || undefined, chapterNo: no });
      if (!link.ok) return setError(describeActionError(link.error));
      if (no !== null && title.trim() !== (chapter?.title ?? "")) {
        const named = await setChapterTitles(institutionSlug, { textbookId: bookId, titles: { [String(no)]: title.trim() } });
        if (!named.ok) return setError(describeActionError(named.error));
      }
      toast.success(no === null ? "Chapter link removed" : "Chapter linked");
      router.refresh();
    });
  }

  return (
    <form className="grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={save} aria-busy={pending}>
      <div>
        <Label htmlFor="unit-book">Book</Label>
        <select
          id="unit-book"
          className={SELECT}
          value={bookId}
          onChange={(e) => {
            setBookId(e.target.value);
            setChapterNo("");
            setTitle("");
          }}
          disabled={pending}
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="unit-chapter">Chapter</Label>
        <select
          id="unit-chapter"
          className={SELECT}
          value={chapterNo}
          onChange={(e) => {
            setChapterNo(e.target.value);
            setTitle(book?.chapters.find((c) => String(c.no) === e.target.value)?.title ?? "");
          }}
          disabled={pending}
        >
          <option value="">No chapter</option>
          {book?.chapters.map((c) => (
            <option key={c.no} value={c.no}>
              {c.title ? `${c.no}. ${c.title}` : `Chapter ${c.no}`}
            </option>
          ))}
        </select>
      </div>
      {chapterNo && (
        <div className="sm:col-span-2">
          <Label htmlFor="unit-chapter-title">Chapter title for your school (optional)</Label>
          <Input id="unit-chapter-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={pending} placeholder="e.g. Patterns in Mathematics" />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save chapter link"}
        </Button>
      </div>
    </form>
  );
}
