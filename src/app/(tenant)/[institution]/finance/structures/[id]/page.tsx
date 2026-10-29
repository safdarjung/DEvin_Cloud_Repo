import { notFound } from "next/navigation";
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
      <h1 className="text-xl font-semibold">{structure.name}</h1>
      <FeeStructureForm institutionSlug={institutionSlug} academicYears={academicYears} grades={grades} initial={structure} />

      <div>
        <h2 className="text-sm font-medium">Assign to a student</h2>
        <p className="text-muted-foreground mb-2 text-sm">
          Assigns this student&apos;s fee structure for this academic year, with optional concessions.
        </p>
        <FeeAssignmentDialog
          institutionSlug={institutionSlug}
          academicYearId={structure.academicYearId}
          feeStructures={allStructures.map((s) => ({ id: s.id, label: s.name }))}
        />
      </div>
    </div>
  );
}
