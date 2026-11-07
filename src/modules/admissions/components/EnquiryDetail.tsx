"use client";

// T-027 — 06 §W4 enquiry detail: notes timeline, assign, convert. Dialogs
// instead of inline forms per CLAUDE.md/UI precedent (CorrectionDialog).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addEnquiryNote, assignEnquiry, convertEnquiryToApplication } from "@/modules/admissions/actions";
import { enquiryStatusVariant } from "@/modules/admissions/status";
import type { EnquiryRow } from "@/modules/admissions/queries";
import { EnquiryReplyDraft } from "@/modules/ai/components/EnquiryReplyDraft";
import { humanize } from "@/lib/format";

interface StaffOption {
  id: string;
  name: string;
}

interface GradeOption {
  id: string;
  label: string;
}

interface AcademicYearOption {
  id: string;
  label: string;
}

interface EnquiryDetailProps {
  institutionSlug: string;
  enquiry: EnquiryRow;
  staffOptions: StaffOption[];
  gradeOptions: GradeOption[];
  academicYearOptions: AcademicYearOption[];
  aiPolicy: string;
}

export function EnquiryDetail({
  institutionSlug,
  enquiry,
  staffOptions,
  gradeOptions,
  academicYearOptions,
  aiPolicy,
}: EnquiryDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState({
    firstName: enquiry.childName.split(" ")[0] ?? "",
    lastName: enquiry.childName.split(" ").slice(1).join(" "),
    dob: "",
    gender: "",
    guardianFullName: enquiry.guardianName,
    guardianPhone: enquiry.phone,
    relationship: "father" as "father" | "mother" | "legal_guardian" | "grandparent" | "other",
    gradeId: gradeOptions[0]?.id ?? "",
    academicYearId: academicYearOptions[0]?.id ?? "",
  });

  const isConverted = enquiry.status === "converted";

  function handleAssign(staffId: string) {
    setError(null);
    startTransition(async () => {
      const result = await assignEnquiry(institutionSlug, { enquiryId: enquiry.id, staffId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function handleAddNote() {
    if (!noteText.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await addEnquiryNote(institutionSlug, { enquiryId: enquiry.id, text: noteText });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNoteText("");
      router.refresh();
    });
  }

  function handleConvert() {
    setError(null);
    startTransition(async () => {
      const result = await convertEnquiryToApplication(institutionSlug, {
        enquiryId: enquiry.id,
        applicant: {
          firstName: convertForm.firstName,
          lastName: convertForm.lastName || undefined,
          dob: convertForm.dob,
          gender: convertForm.gender,
        },
        guardian: {
          fullName: convertForm.guardianFullName,
          phone: convertForm.guardianPhone,
          relationship: convertForm.relationship,
        },
        gradeId: convertForm.gradeId,
        academicYearId: convertForm.academicYearId,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setConvertOpen(false);
      router.push(`/${institutionSlug}/admissions/applications/${result.data.applicationId}`);
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={enquiry.childName}
        description={`${enquiry.guardianName} · ${enquiry.phone}`}
        back={{ href: `/${institutionSlug}/admissions`, label: "Pipeline" }}
        actions={<Badge variant={enquiryStatusVariant(enquiry.status)}>{humanize(enquiry.status)}</Badge>}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select disabled={pending || isConverted} value={enquiry.assignedTo ?? undefined} onValueChange={handleAssign}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              {staffOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
            <DialogTrigger asChild>
              <Button disabled={isConverted} variant="default" size="sm">
                {isConverted ? "Converted" : "Convert to application"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Convert to application</DialogTitle>
                <DialogDescription>Creates an application and marks this enquiry converted.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Input
                  placeholder="First name"
                  value={convertForm.firstName}
                  onChange={(e) => setConvertForm((f) => ({ ...f, firstName: e.target.value }))}
                />
                <Input
                  placeholder="Last name (optional)"
                  value={convertForm.lastName}
                  onChange={(e) => setConvertForm((f) => ({ ...f, lastName: e.target.value }))}
                />
                <Input
                  type="date"
                  placeholder="Date of birth"
                  value={convertForm.dob}
                  onChange={(e) => setConvertForm((f) => ({ ...f, dob: e.target.value }))}
                />
                <Input
                  placeholder="Gender"
                  value={convertForm.gender}
                  onChange={(e) => setConvertForm((f) => ({ ...f, gender: e.target.value }))}
                />
                <Input
                  placeholder="Guardian full name"
                  value={convertForm.guardianFullName}
                  onChange={(e) => setConvertForm((f) => ({ ...f, guardianFullName: e.target.value }))}
                />
                <Input
                  placeholder="Guardian phone"
                  value={convertForm.guardianPhone}
                  onChange={(e) => setConvertForm((f) => ({ ...f, guardianPhone: e.target.value }))}
                />
                <Select
                  value={convertForm.relationship}
                  onValueChange={(v) => setConvertForm((f) => ({ ...f, relationship: v as typeof f.relationship }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Guardian relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {["father", "mother", "legal_guardian", "grandparent", "other"].map((r) => (
                      <SelectItem key={r} value={r}>
                        {humanize(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={convertForm.gradeId} onValueChange={(v) => setConvertForm((f) => ({ ...f, gradeId: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Grade applied for" />
                  </SelectTrigger>
                  <SelectContent>
                    {gradeOptions.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={convertForm.academicYearId} onValueChange={(v) => setConvertForm((f) => ({ ...f, academicYearId: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Academic year" />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYearOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button disabled={pending} onClick={handleConvert}>
                  Convert
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <EnquiryReplyDraft institutionSlug={institutionSlug} enquiryId={enquiry.id} aiPolicy={aiPolicy} />
      </div>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {enquiry.notes.length === 0 ? (
            <EmptyState title="No notes yet" />
          ) : (
            <ul className="ml-1.5 space-y-3 border-l-2 border-border">
              {enquiry.notes.map((note, i) => (
                <li key={i} className="relative pl-4 text-sm">
                  <span aria-hidden className="absolute top-1 -left-[6px] size-2.5 rounded-full border-2 border-ring bg-card" />
                  <p>{note.text}</p>
                  <p className="text-xs text-muted-foreground italic">{note.at ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note..." />
            <Button variant="outline" disabled={pending || !noteText.trim()} onClick={handleAddNote}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
