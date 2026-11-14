import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { SchoolNameForm } from "@/modules/core/setup/components/SchoolNameForm";
import { StepBranding } from "@/modules/core/setup/components/StepBranding";

export const metadata: Metadata = { title: "School profile" };

// The school's name, logo and colour, any time after setup. The app shell, dashboards, report cards
// and the public website read them from the institution row and its settings.branding.
export default async function SchoolProfilePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "institution.settings.manage");
  const branding = InstitutionSettingsSchema.shape.branding.safeParse(ctx.institution.settings.branding);
  const logoPath = branding.success ? (branding.data?.logo_path ?? null) : null;
  const primaryColor = branding.success ? (branding.data?.primary_color ?? null) : null;

  return (
    <div className="space-y-4">
      <PageHeader title="School profile" description="Your school's name, logo and colour, as people see them across the app." />
      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>Shown in the sidebar, on dashboards, report cards, receipts and the school website.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchoolNameForm institutionSlug={institutionSlug} name={ctx.institution.name} locked={ctx.institution.is_demo} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Logo and colour</CardTitle>
          <CardDescription>The logo appears in the sidebar and on documents; the colour tints buttons and highlights.</CardDescription>
        </CardHeader>
        <CardContent>
          <StepBranding institutionSlug={institutionSlug} institutionId={ctx.institution.id} state="done" logoPath={logoPath} primaryColor={primaryColor} hideSkip />
        </CardContent>
      </Card>
    </div>
  );
}
