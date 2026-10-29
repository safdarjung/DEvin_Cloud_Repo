import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { EnquiryDetail } from "@/modules/admissions/components/EnquiryDetail";
import { getEnquiry } from "@/modules/admissions/queries";

export default async function EnquiryDetailPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "admissions.enquiry.read");

  const enquiry = await getEnquiry(ctx, id);
  if (!enquiry) notFound();

  const supabase = await createClient();
  const [{ data: staff }, { data: grades }, { data: years }] = await Promise.all([
    supabase.from("staff").select("id, full_name").eq("institution_id", ctx.institution.id).order("full_name"),
    supabase.from("grades").select("id, code, display_name").eq("institution_id", ctx.institution.id).order("sort_key"),
    supabase.from("academic_years").select("id, name").eq("institution_id", ctx.institution.id).order("starts_on", { ascending: false }),
  ]);

  return (
    <EnquiryDetail
      institutionSlug={institutionSlug}
      enquiry={enquiry}
      staffOptions={(staff ?? []).map((s) => ({ id: s.id, name: s.full_name }))}
      gradeOptions={(grades ?? []).map((g) => ({ id: g.id, label: g.display_name ?? g.code }))}
      academicYearOptions={(years ?? []).map((y) => ({ id: y.id, label: y.name }))}
    />
  );
}
