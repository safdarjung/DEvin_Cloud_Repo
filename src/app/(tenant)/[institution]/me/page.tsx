import { EmptyState } from "@/components/states";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { FadeIn } from "@/components/motion";
import { MyPayslips } from "@/modules/payroll/components/MyPayslips";

export default async function PersonalAIPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  const canAi = hasPermission(ctx, "ai.generate");
  // Features-18 #3: every staff role reads its own payslips here (RLS: own, finalized months only).
  const canPayslips = hasPermission(ctx, "payslip.read") && isModuleEnabled(ctx, "payroll");
  if (!canAi && !canPayslips) throw new AppError("forbidden", "You do not have permission to perform this action.");

  // Unlinked placeholder: a settled empty state instead of an endless skeleton.
  return (
    <FabricPage title={canAi ? "Personal AI" : "Me"} ws="me">
      {canPayslips && <MyPayslips ctx={ctx} />}
      {canAi && (
        <FadeIn>
          <EmptyState title="Personal AI is not available yet" description="This workspace arrives in packet F-UI-13." />
        </FadeIn>
      )}
    </FabricPage>
  );
}
