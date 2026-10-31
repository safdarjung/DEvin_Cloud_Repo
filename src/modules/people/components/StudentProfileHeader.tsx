// T-028 — student profile header (pure rendering, server component).
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import type { StudentProfile } from "@/modules/people/queries";

export function studentStatusVariant(status: string) {
  return status === "active" ? "success" : status === "alumni" ? "info" : status === "withdrawn" ? "warning" : "outline";
}

export function StudentProfileHeader({ student, institutionSlug }: { student: StudentProfile; institutionSlug: string }) {
  const name = [student.firstName, student.lastName].filter(Boolean).join(" ");

  return (
    <PageHeader
      title={name}
      description={[
        student.admissionNo,
        student.enrolment && `${student.enrolment.gradeName}-${student.enrolment.sectionName}`,
        student.enrolment?.rollNo && `Roll ${student.enrolment.rollNo}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      back={{ href: `/${institutionSlug}/students`, label: "Students" }}
      actions={<Badge variant={studentStatusVariant(student.status)}>{student.status}</Badge>}
    />
  );
}
