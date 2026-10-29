import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { AssignmentForm } from "@/modules/academics/components/AssignmentForm";
import { listSectionSubjects, listTeachableSections } from "@/modules/academics/assignments.queries";

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "assignment.manage");

  const sections = await listTeachableSections(ctx);
  const sectionsWithSubjects = await Promise.all(
    sections.map(async (section) => ({ ...section, subjects: await listSectionSubjects(ctx, section.id) })),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New assignment</h1>
      {sectionsWithSubjects.length === 0 ? (
        <p className="text-muted-foreground text-sm">You don&apos;t teach any sections yet.</p>
      ) : (
        <AssignmentForm institutionSlug={institutionSlug} sections={sectionsWithSubjects} />
      )}
    </div>
  );
}
