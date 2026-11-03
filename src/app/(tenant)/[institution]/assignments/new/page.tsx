import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { AssignmentForm } from "@/modules/academics/components/AssignmentForm";
import { listSectionSubjects, listTeachableSections } from "@/modules/academics/assignments.queries";

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "assignments");
  requirePermission(ctx, "assignment.manage");

  const sections = await listTeachableSections(ctx);
  const sectionsWithSubjects = await Promise.all(
    sections.map(async (section) => ({ ...section, subjects: await listSectionSubjects(ctx, section.id) })),
  );

  return (
    <div className="space-y-4">
      <PageHeader title="New assignment" back={{ href: `/${institutionSlug}/assignments`, label: "Assignments" }} />
      {sectionsWithSubjects.length === 0 ? (
        <EmptyState title="No sections to assign to" description="You don't teach any sections yet." />
      ) : (
        <AssignmentForm institutionSlug={institutionSlug} sections={sectionsWithSubjects} />
      )}
    </div>
  );
}
