import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { StudentInvoices } from "@/modules/finance/components/StudentInvoices";
import { listReceiptsForStudent } from "@/modules/finance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export default async function PortalFeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/fees`);
  const receipts = await listReceiptsForStudent(ctx, selection.studentId);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/fees"
      />

      <div className="space-y-4">
        <StudentInvoices ctx={ctx} institutionSlug={institutionSlug} studentId={selection.studentId} />

        {receipts.length > 0 && (
          <div>
            <h2 className="text-sm font-medium">Receipts</h2>
            <ul className="divide-y divide-border">
              {receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <Link
                    href={`/${institutionSlug}/portal/fees/receipts/${r.id}?student=${selection.studentId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {r.receiptNo}
                  </Link>
                  <span className="text-muted-foreground">{r.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
