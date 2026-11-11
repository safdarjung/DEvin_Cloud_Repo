import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FeeAssignmentDialog } from "@/modules/finance/components/FeeAssignmentDialog";
import { FeeStructureForm } from "@/modules/finance/components/FeeStructureForm";
import { getFeeStructure, listAcademicYears, listFeeStructures, listGradeOptions } from "@/modules/finance/queries";

export const metadata: Metadata = { title: "Fee structure" };

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
      <FadeIn className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <FeeStructureForm institutionSlug={institutionSlug} academicYears={academicYears} grades={grades} initial={structure} />
      </div>

      <Card className="min-w-0 self-start">
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
      </FadeIn>
    </div>
  );
}
