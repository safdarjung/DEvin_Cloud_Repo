import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/motion";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { StudentProfile } from "@/modules/people/components/StudentProfile";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Student" };

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ institution: string; studentId: string }>;
}) {
  const { institution: institutionSlug, studentId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") notFound();

  const student = await getStudentProfile(ctx, studentId);
  if (!student) notFound();

  const termId = student.enrolment ? await getCurrentTermId(ctx, student.enrolment.academicYearId) : null;
  const invoices = await listInvoicesForStudent(ctx, studentId);

  return (
    <FadeIn>
      <StudentProfile ctx={ctx} student={student} invoices={invoices} termId={termId} />
    </FadeIn>
  );
}
