import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";

export default async function FinancePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const canManageStructures = hasPermission(ctx, "finance.structure.manage");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Finance</h1>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {canManageStructures && (
          <li className="p-3">
            <Link href={`/${institutionSlug}/finance/structures`} className="text-primary underline-offset-2 hover:underline">
              Fee structures &amp; assignments
            </Link>
          </li>
        )}
        <li className="p-3">
          <Link href={`/${institutionSlug}/finance/invoices`} className="text-primary underline-offset-2 hover:underline">
            Invoices
          </Link>
        </li>
      </ul>
    </div>
  );
}
