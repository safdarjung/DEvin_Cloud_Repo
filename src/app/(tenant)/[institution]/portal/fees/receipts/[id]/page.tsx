import { FadeIn } from "@/components/motion";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { ReceiptView } from "@/modules/finance/components/ReceiptView";
import { getReceipt } from "@/modules/finance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

// T-034 packet security rule 5: the receipt must belong to the selected
// child — RLS (`receipts_select`) already keeps a guardian/student from
// fetching another family's receipt at all, but this still re-checks the
// receipt's own `snapshot.studentId` against the selection so a guardian
// can't view *a different one of their own children's* receipts through
// the wrong child's URL slot.
export default async function PortalReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; id: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/fees/receipts/${id}`, allParams);
  const receipt = await getReceipt(ctx, id);
  if (!receipt || receipt.snapshot.studentId !== selection.studentId) notFound();

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/fees"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn>
        <ReceiptView receipt={receipt} />
      </FadeIn>
    </>
  );
}
