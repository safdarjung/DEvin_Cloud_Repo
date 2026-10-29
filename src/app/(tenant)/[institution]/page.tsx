import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";

export default async function TenantHome({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);

  redirect(
    ctx.permissions.has("dashboard.view")
      ? `/${institutionSlug}/dashboard`
      : `/${institutionSlug}/portal`,
  );
}
