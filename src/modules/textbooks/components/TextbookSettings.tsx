"use client";

// Textbooks settings (0139): per grade and subject, the school's books —
// NCERT entries (links to ncert.nic.in, never copied) or its own books —
// with add, remove, chapter titles and "Suggest NCERT books". Teachers see
// and edit only subjects they teach; every action re-checks permission + RLS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { addTextbook, removeTextbook, setChapterTitles, suggestNcertBooks } from "@/modules/textbooks/actions";
import { canonicalSubject } from "@/modules/textbooks/ncert";
import type { ExtractionSummary } from "@/modules/content/schemas";
import type { BookView, CatalogueOption, SettingsGrade } from "@/modules/textbooks/queries";
import { BookCard } from "./BookLinks";
import { SchoolCopyEditor } from "./SchoolCopy";
import { TextbookContent } from "./TextbookContent";
import { checkTextbookPdf, MAX_TEXTBOOK_FILE_MB, uploadTextbookPdf } from "./upload-textbook-file";

const SELECT = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (task: () => Promise<ActionResult<unknown>>, done: string, after?: () => void) =>
    start(async () => {
      const res = await task();
      if (!res.ok) return void toast.error(describeActionError(res.error));
      toast.success(done);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function SuggestNcertButton({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await suggestNcertBooks(institutionSlug, {});
          if (!res.ok) return void toast.error(describeActionError(res.error));
          toast.success(res.data.added ? `Added ${res.data.added} NCERT book${res.data.added === 1 ? "" : "s"}.` : "Nothing to add: every subject with an NCERT match already has a book.");
          router.refresh();
        })
      }
    >
      {pending ? "Suggesting…" : "Suggest NCERT books"}
    </Button>
  );
}

function ChapterTitles({ institutionSlug, book }: { institutionSlug: string; book: BookView }) {
  const { pending, run } = useRun();
  const [titles, setTitles] = useState<Record<string, string>>(() => Object.fromEntries(book.chapters.map((c) => [String(c.no), c.title ?? ""])));
  if (book.chapters.length === 0) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="min-h-8 cursor-pointer py-1 text-muted-foreground">Chapter titles for your school</summary>
      <form
        className="mt-2 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setChapterTitles(institutionSlug, { textbookId: book.id, titles }), "Chapter titles saved");
        }}
      >
        {book.chapters.map((c) => (
          <div key={c.no}>
            <Label htmlFor={`${book.id}-ch-${c.no}`} className="text-xs">
              Chapter {c.no}
            </Label>
            <Input
              id={`${book.id}-ch-${c.no}`}
              value={titles[String(c.no)] ?? ""}
              maxLength={120}
              onChange={(e) => setTitles((t) => ({ ...t, [String(c.no)]: e.target.value }))}
              disabled={pending}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            Save titles
          </Button>
        </div>
      </form>
    </details>
  );
}

/** Add form helper: add the book, then upload the chosen PDF to it; the book stays even when the PDF fails. */
function useAddWithPdf(institutionSlug: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const add = (input: Parameters<typeof addTextbook>[1], file: File | undefined, done: string, after: () => void) => {
    const bad = file ? checkTextbookPdf(file) : null;
    if (bad) return void toast.error(bad);
    start(async () => {
      const res = await addTextbook(institutionSlug, input);
      if (!res.ok) return void toast.error(describeActionError(res.error));
      after();
      if (file) {
        const up = await uploadTextbookPdf(institutionSlug, res.data.id, file, setProgress);
        setProgress(null);
        if (!up.ok) toast.error(`${done}, but the PDF was not saved: ${up.error} Add it from the book below.`);
        else toast.success(`${done} with its PDF`);
      } else toast.success(done);
      router.refresh();
    });
  };
  return { pending, progress, add };
}

function PdfField({ id, file, onChange, disabled }: { id: string; file: File | undefined; onChange: (f: File | undefined) => void; disabled: boolean }) {
  return (
    <div>
      <Label htmlFor={id}>PDF (optional, up to {MAX_TEXTBOOK_FILE_MB} MB)</Label>
      <Input id={id} type="file" accept="application/pdf" disabled={disabled} onChange={(e) => onChange(e.target.files?.[0])} key={file ? "set" : "empty"} />
    </div>
  );
}

function AddBook({ institutionSlug, gradeId, subjectId, subjectName, options }: { institutionSlug: string; gradeId: string; subjectId: string; subjectName: string; options: CatalogueOption[] }) {
  const { pending, progress, add } = useAddWithPdf(institutionSlug);
  const key = canonicalSubject(subjectName);
  const sorted = [...options].sort((a, b) => Number(canonicalSubject(b.subject) === key) - Number(canonicalSubject(a.subject) === key) || a.subject.localeCompare(b.subject));
  const [code, setCode] = useState(sorted[0]?.code ?? "");
  const [custom, setCustom] = useState({ title: "", publisher: "", url: "", chapters: "" });
  const [ncertLink, setNcertLink] = useState("");
  const [ncertPdf, setNcertPdf] = useState<File>();
  const [customPdf, setCustomPdf] = useState<File>();
  const id = `${gradeId}-${subjectId}`;
  return (
    <details className="text-sm">
      <summary className="min-h-8 cursor-pointer py-1 text-primary">Add a book</summary>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {sorted.length > 0 && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              add(
                { gradeId, subjectId, book: { source: "ncert", code, ...(ncertLink.trim() ? { schoolUrl: ncertLink } : {}) } },
                ncertPdf,
                "NCERT book added",
                () => {
                  setNcertLink("");
                  setNcertPdf(undefined);
                },
              );
            }}
          >
            <Label htmlFor={`${id}-ncert`}>NCERT book (link to the official site)</Label>
            <select id={`${id}-ncert`} className={SELECT} value={code} onChange={(e) => setCode(e.target.value)} disabled={pending}>
              {sorted.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.subject}: {o.title} ({o.medium}){o.verified ? "" : " — chapter PDFs not checked"}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">The official NCERT link always shows first. Add your own link or PDF too if the school has one.</p>
            <div>
              <Label htmlFor={`${id}-ncert-link`}>School link (https, optional)</Label>
              <Input id={`${id}-ncert-link`} type="url" inputMode="url" placeholder="https://" maxLength={2000} value={ncertLink} onChange={(e) => setNcertLink(e.target.value)} disabled={pending} />
            </div>
            <PdfField id={`${id}-ncert-pdf`} file={ncertPdf} onChange={setNcertPdf} disabled={pending} />
            <Button type="submit" size="sm" disabled={pending || !code}>
              {progress !== null ? `Uploading ${progress}%` : "Add NCERT book"}
            </Button>
          </form>
        )}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(
              {
                gradeId,
                subjectId,
                book: {
                  source: "custom",
                  title: custom.title,
                  ...(custom.publisher.trim() ? { publisher: custom.publisher } : {}),
                  ...(custom.url.trim() ? { url: custom.url } : {}),
                  ...(custom.chapters ? { chapters: Number(custom.chapters) } : {}),
                },
              },
              customPdf,
              "Book added",
              () => {
                setCustom({ title: "", publisher: "", url: "", chapters: "" });
                setCustomPdf(undefined);
              },
            );
          }}
        >
          <p className="font-medium">Or your school&apos;s own book</p>
          <div>
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input id={`${id}-title`} required maxLength={160} value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} disabled={pending} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-pub`}>Publisher</Label>
              <Input id={`${id}-pub`} maxLength={120} value={custom.publisher} onChange={(e) => setCustom({ ...custom, publisher: e.target.value })} disabled={pending} />
            </div>
            <div>
              <Label htmlFor={`${id}-chapters`}>Chapters</Label>
              <Input id={`${id}-chapters`} type="number" min={1} max={99} value={custom.chapters} onChange={(e) => setCustom({ ...custom, chapters: e.target.value })} disabled={pending} />
            </div>
          </div>
          <div>
            <Label htmlFor={`${id}-url`}>Link (https, optional)</Label>
            <Input id={`${id}-url`} type="url" placeholder="https://" maxLength={2000} value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} disabled={pending} />
          </div>
          <PdfField id={`${id}-pdf`} file={customPdf} onChange={setCustomPdf} disabled={pending} />
          <Button type="submit" size="sm" disabled={pending || !custom.title.trim()}>
            {progress !== null ? `Uploading ${progress}%` : "Add book"}
          </Button>
        </form>
      </div>
    </details>
  );
}

export function TextbookSettings({ institutionSlug, grades, catalogue, states }: { institutionSlug: string; grades: SettingsGrade[]; catalogue: Record<string, CatalogueOption[]>; states: Record<string, ExtractionSummary> }) {
  const { pending, run } = useRun();
  return (
    <div className="space-y-4">
      {grades.map((g) => (
        <Card key={g.gradeId}>
          <CardHeader>
            <CardTitle>
              {g.gradeName}
              {g.classLevel === null && <span className="ml-2 text-xs font-normal text-muted-foreground">(no NCERT class number)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {g.subjects.map((s) => (
              <div key={s.subjectId} className="space-y-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{s.subjectName}</h3>
                  {s.books.length === 0 && <Badge variant="outline">No book</Badge>}
                </div>
                {s.books.map((b) => (
                  <div key={b.id} data-testid="book-row">
                    <BookCard book={b} />
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Remove "${b.title}" from ${s.subjectName}? Units linked to its chapters lose the link.${b.file ? " Its school PDF is removed too." : ""}`)) run(() => removeTextbook(institutionSlug, { textbookId: b.id }), "Book removed");
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <SchoolCopyEditor institutionSlug={institutionSlug} book={b} />
                    <TextbookContent institutionSlug={institutionSlug} book={b} state={states[b.id] ?? null} />
                    <ChapterTitles institutionSlug={institutionSlug} book={b} />
                  </div>
                ))}
                <AddBook institutionSlug={institutionSlug} gradeId={g.gradeId} subjectId={s.subjectId} subjectName={s.subjectName} options={g.classLevel ? (catalogue[String(g.classLevel)] ?? []) : []} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
