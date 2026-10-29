// T-028 — student profile header (pure rendering, server component).
import { Badge } from "@/components/ui/badge";
import type { StudentProfile } from "@/modules/people/queries";

export function StudentProfileHeader({ student }: { student: StudentProfile }) {
  const name = [student.firstName, student.lastName].filter(Boolean).join(" ");

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold">{name}</h1>
        <p className="text-muted-foreground text-sm">
          {student.admissionNo}
          {student.enrolment ? ` · ${student.enrolment.gradeName}-${student.enrolment.sectionName}` : ""}
          {student.enrolment?.rollNo ? ` · Roll ${student.enrolment.rollNo}` : ""}
        </p>
      </div>
      <Badge variant={student.status === "active" ? "default" : "outline"}>{student.status}</Badge>
    </div>
  );
}
