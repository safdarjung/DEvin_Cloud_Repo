"use client";

// Library controls. Hiding them is UX only: every action re-checks `library.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { addCopies, upsertBook } from "@/modules/library/actions";
import { issueLoan, renewLoan, returnLoan } from "@/modules/library/circulation.actions";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  function run<T>(call: () => Promise<ActionResult<T>>, success: string, onOk?: () => void) {
    start(async () => {
      const res = await call();
      if (res.ok) {
        setErrors({});
        toast.success(success);
        onOk?.();
        router.refresh();
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(describeActionError(res.error));
      }
    });
  }
  return { pending, errors, run };
}

export function AddBookForm({ institutionSlug }: { institutionSlug: string }) {
  const { pending, errors, run } = useRun();
  const [f, setF] = useState({ title: "", author: "", isbn: "", accessions: "" });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const nos = f.accessions.split(/[\s,]+/).filter(Boolean);
        // Book first, then its copies; a copy error leaves the book in place and is reported.
        run(
          async () => {
            const book = await upsertBook(institutionSlug, { title: f.title, author: f.author, isbn: f.isbn.trim() || null });
            if (!book.ok || nos.length === 0) return book;
            const copies = await addCopies(institutionSlug, { bookId: (book.data as { id: string }).id, accessionNos: nos });
            return copies.ok ? book : copies;
          },
          "Book added",
          () => setF({ title: "", author: "", isbn: "", accessions: "" }),
        );
      }}
    >
      <div>
        <Label htmlFor="book-title">Title</Label>
        <Input id="book-title" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={Boolean(errors.title)} />
        <FieldError errors={errors.title} />
      </div>
      <div>
        <Label htmlFor="book-author">Author</Label>
        <Input id="book-author" value={f.author} maxLength={120} onChange={(e) => setF({ ...f, author: e.target.value })} aria-invalid={Boolean(errors.author)} />
        <FieldError errors={errors.author} />
      </div>
      <div>
        <Label htmlFor="book-isbn">ISBN (optional)</Label>
        <Input id="book-isbn" value={f.isbn} onChange={(e) => setF({ ...f, isbn: e.target.value })} aria-invalid={Boolean(errors.isbn)} />
        <FieldError errors={errors.isbn} />
      </div>
      <div>
        <Label htmlFor="book-acc">Accession numbers (comma or space separated)</Label>
        <Input id="book-acc" value={f.accessions} placeholder="B-0101, B-0102" onChange={(e) => setF({ ...f, accessions: e.target.value })} aria-invalid={Boolean(errors.accessionNos)} />
        <FieldError errors={errors.accessionNos} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add book"}
        </Button>
      </div>
    </form>
  );
}

export function AddCopyForm({ institutionSlug, bookId, title }: { institutionSlug: string; bookId: string; title: string }) {
  const { pending, errors, run } = useRun();
  const [no, setNo] = useState("");
  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addCopies(institutionSlug, { bookId, accessionNos: [no] }), "Copy added", () => setNo(""));
      }}
    >
      <div>
        <Label htmlFor={`copy-${bookId}`} className="sr-only">
          New accession number for {title}
        </Label>
        <Input id={`copy-${bookId}`} className="h-9 w-32" value={no} placeholder="Accession no." onChange={(e) => setNo(e.target.value)} aria-invalid={Boolean(errors.accessionNos)} />
        <FieldError errors={errors.accessionNos} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !no.trim()}>
        Add copy
      </Button>
    </form>
  );
}

export function IssueLoanForm({ institutionSlug, students }: { institutionSlug: string; students: { id: string; label: string }[] }) {
  const { pending, errors, run } = useRun();
  const [accessionNo, setAccessionNo] = useState("");
  const [studentId, setStudentId] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => issueLoan(institutionSlug, { accessionNo, studentId }), "Book issued", () => setAccessionNo(""));
      }}
    >
      <div>
        <Label htmlFor="issue-acc">Accession number</Label>
        <Input id="issue-acc" value={accessionNo} onChange={(e) => setAccessionNo(e.target.value)} aria-invalid={Boolean(errors.accessionNo)} />
        <FieldError errors={errors.accessionNo} />
      </div>
      <div>
        <Label htmlFor="issue-student">Student</Label>
        <select id="issue-student" className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)} aria-invalid={Boolean(errors.studentId)}>
          <option value="">{students.length ? "Choose a student" : "Search a student first"}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <FieldError errors={errors.studentId} />
      </div>
      <Button type="submit" disabled={pending || !accessionNo.trim() || !studentId}>
        Issue
      </Button>
    </form>
  );
}

/** Renew or return by accession number (row button when `accessionNo` is known, else typed). */
export function LoanRowActions({ institutionSlug, accessionNo }: { institutionSlug: string; accessionNo: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => renewLoan(institutionSlug, { accessionNo }), "Loan renewed")}>
        Renew
      </Button>
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => returnLoan(institutionSlug, { accessionNo, waiveFine: false }), "Book returned")}>
        Return
      </Button>
    </div>
  );
}

export function ReturnByNumberForm({ institutionSlug }: { institutionSlug: string }) {
  const { pending, errors, run } = useRun();
  const [accessionNo, setAccessionNo] = useState("");
  const [waiveFine, setWaiveFine] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => returnLoan(institutionSlug, { accessionNo, waiveFine }), "Book returned", () => setAccessionNo(""));
      }}
    >
      <div>
        <Label htmlFor="return-acc">Accession number</Label>
        <Input id="return-acc" value={accessionNo} onChange={(e) => setAccessionNo(e.target.value)} aria-invalid={Boolean(errors.accessionNo)} />
        <FieldError errors={errors.accessionNo} />
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={waiveFine} onChange={(e) => setWaiveFine(e.target.checked)} />
        Waive fine
      </label>
      <Button type="submit" variant="outline" disabled={pending || !accessionNo.trim()}>
        Return
      </Button>
    </form>
  );
}
