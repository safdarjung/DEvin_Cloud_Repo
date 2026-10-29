import Link from "next/link";
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
      <div>
        <h1 className="text-xl font-semibold">Fee structures</h1>
        <p className="text-muted-foreground text-sm">Per-grade components; assign to students from a structure&apos;s page.</p>
      </div>

      {academicYears.length === 0 || grades.length === 0 ? (
        <p className="text-muted-foreground text-sm">Create an academic year and a grade first.</p>
      ) : (
        <FeeStructureForm institutionSlug={institutionSlug} academicYears={academicYears} grades={grades} />
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {structures.map((s) => (
          <li key={s.id} className="flex items-center justify-between p-3">
            <span>
              {s.name} ({s.componentCount} components)
            </span>
            <Link
              href={`/${institutionSlug}/finance/structures/${s.id}`}
              className="text-primary text-sm underline-offset-2 hover:underline"
            >
              Open
            </Link>
          </li>
        ))}
        {structures.length === 0 && <li className="text-muted-foreground p-3 text-sm">No fee structures yet.</li>}
      </ul>
    </div>
  );
}
