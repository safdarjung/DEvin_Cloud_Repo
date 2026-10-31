import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FeeAssignmentDialog } from "@/modules/finance/components/FeeAssignmentDialog";
import { FeeStructureForm } from "@/modules/finance/components/FeeStructureForm";
import { getFeeStructure, listAcademicYears, listFeeStructures, listGradeOptions } from "@/modules/finance/queries";

export default async function FeeStructureDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.structure.manage");

  const structure = await getFeeStructure(ctx, id);
  if (!structure) notFound();

  const [academicYears, grades, allStructures] = await Promise.all([
    listAcademicYears(ctx),
    listGradeOptions(ctx),
    listFeeStructures(ctx, { academicYearId: structure.academicYearId }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={structure.name} back={{ href: `/${institutionSlug}/finance/structures`, label: "Fee structures" }} />
      <FeeStructureForm institutionSlug={institutionSlug} academicYears={academicYears} grades={grades} initial={structure} />

      <Card>
        <CardHeader>
          <CardTitle>Assign to a student</CardTitle>
          <CardDescription>Assigns this student&apos;s fee structure for this academic year, with optional concessions.</CardDescription>
        </CardHeader>
        <CardContent>
        <FeeAssignmentDialog
          institutionSlug={institutionSlug}
          academicYearId={structure.academicYearId}
          feeStructures={allStructures.map((s) => ({ id: s.id, label: s.name }))}
        />
        </CardContent>
      </Card>
    </div>
  );
}
