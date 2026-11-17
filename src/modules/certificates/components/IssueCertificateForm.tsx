"use client";

// Certificates are append-only: this form only issues. Hiding it is UX only; the action
// re-checks `certificate.manage` and the definer enforces the rest.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { issueCertificate } from "@/modules/certificates/actions";
import { IssueCertificateSchema } from "@/modules/certificates/schemas";
import { StudentSearchSelect } from "@/modules/people/components/StudentSearchSelect";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const KINDS = [
  { value: "bonafide", label: "Bonafide certificate" },
  { value: "character", label: "Character certificate" },
  { value: "transfer", label: "Transfer certificate (TC)" },
] as const;

// Plain-language replacements for raw Zod text, keyed by field.
const FRIENDLY: Record<string, string> = {
  studentId: "Search for a student and pick one.",
  purpose: "Enter a purpose of at least 3 characters, for example Passport application.",
  conduct: "Enter the student's conduct, for example Good.",
};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

export function IssueCertificateForm({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [form, setForm] = useState({ kind: "bonafide", purpose: "", conduct: "" });
  const studentId = student?.id ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input =
      form.kind === "bonafide"
        ? { kind: "bonafide", studentId, purpose: form.purpose }
        : form.kind === "character"
          ? { kind: "character", studentId, conduct: form.conduct, ...(form.purpose ? { purpose: form.purpose } : {}) }
          : { kind: "transfer", studentId };
    const parsed = IssueCertificateSchema.safeParse(input);
    if (!parsed.success) {
      const flat: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        flat[field] = [FRIENDLY[field] ?? "Check this field."];
      }
      setErrors(flat);
      return;
    }
    setErrors({});
    start(async () => {
      const res = await issueCertificate(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success(res.data.created ? `Issued ${res.data.serialNo}` : `Already issued: ${res.data.serialNo}`);
        setForm({ ...form, purpose: "", conduct: "" });
        router.refresh();
      } else {
        if (res.error.code === "validation_failed" && res.error.fieldErrors) {
          setErrors(Object.fromEntries(Object.keys(res.error.fieldErrors).map((f) => [f, [FRIENDLY[f] ?? "Check this field."]])));
          toast.error("Check the highlighted fields and try again.");
        } else {
          toast.error(describeActionError(res.error));
        }
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor="c-student">Student</Label>
        <StudentSearchSelect institutionSlug={institutionSlug} id="c-student" value={student} onChange={setStudent} invalid={Boolean(errors.studentId)} />
        <FieldError errors={errors.studentId} />
      </div>
      <div>
        <Label htmlFor="c-kind">Certificate</Label>
        <select id="c-kind" className={SELECT_CLASS} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      {form.kind !== "transfer" && (
        <div>
          <Label htmlFor="c-purpose">Purpose{form.kind === "character" ? " (optional)" : ""}</Label>
          <Input id="c-purpose" value={form.purpose} maxLength={200} onChange={(e) => setForm({ ...form, purpose: e.target.value })} aria-invalid={Boolean(errors.purpose)} />
          <FieldError errors={errors.purpose} />
        </div>
      )}
      {form.kind === "character" && (
        <div>
          <Label htmlFor="c-conduct">Conduct</Label>
          <Input id="c-conduct" value={form.conduct} maxLength={100} placeholder="Good" onChange={(e) => setForm({ ...form, conduct: e.target.value })} aria-invalid={Boolean(errors.conduct)} />
          <FieldError errors={errors.conduct} />
        </div>
      )}
      {form.kind === "transfer" && <p className="text-sm text-muted-foreground sm:col-span-2">A TC needs the student to have exited through the lifecycle flow; it prints that exit snapshot.</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Issuing…" : "Issue certificate"}
        </Button>
      </div>
    </form>
  );
}
