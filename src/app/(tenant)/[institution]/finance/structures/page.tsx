import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { FeeStructureForm } from "@/modules/finance/components/FeeStructureForm";
import { listAcademicYears, listFeeStructures, listGradeOptions } from "@/modules/finance/queries";

export default async function FeeStructuresPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.structure.manage");

  const [academicYears, grades, structures] = await Promise.all([
    listAcademicYears(ctx),
    listGradeOptions(ctx),
    listFeeStructures(ctx),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fee structures" description="Per-grade components; assign to students from a structure's page." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {academicYears.length === 0 || grades.length === 0 ? (
            <EmptyState title="Set up first" description="Create an academic year and a grade first." />
          ) : (
            <FeeStructureForm institutionSlug={institutionSlug} academicYears={academicYears} grades={grades} />
          )}
        </div>

        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Existing structures</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
            {structures.length === 0 ? (
              <EmptyState title="No fee structures yet" />
            ) : (
              <ul className="divide-y divide-border">
                {structures.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      {s.name} <span className="text-muted-foreground">({s.componentCount} components)</span>
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/${institutionSlug}/finance/structures/${s.id}`}>Open</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
