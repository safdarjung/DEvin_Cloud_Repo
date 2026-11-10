import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { StudyLanguageForm } from "@/modules/ai/components/StudyLanguageForm";

// DBT-160 — student-only (ai.study); requirePermission is the real floor.
export default async function StudyPreferencesPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.study");
  const { style } = await getStudentPreferences(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Study preferences"
        description="Choose the language your study helper answers in."
        back={{ href: `/${institutionSlug}/portal/study`, label: "Back to study" }}
      />
      <StudyLanguageForm institutionSlug={institutionSlug} initialLanguage={style.language} />
    </div>
  );
}
