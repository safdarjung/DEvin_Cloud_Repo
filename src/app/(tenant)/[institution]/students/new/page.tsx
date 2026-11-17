import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { addStudentHref } from "@/modules/people/add-student";

// No direct create form: send the user to the admission or import path (else back to the list).
export default async function NewStudentPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "student.read");
  redirect(addStudentHref(ctx, slug)?.href ?? `/${slug}/students`);
}
