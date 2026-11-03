import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { homePathFor } from "@/lib/nav";

export default async function TenantHome({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);

  redirect(`/${institutionSlug}${homePathFor(ctx.permissions, ctx.institution.settings)}`);
}
