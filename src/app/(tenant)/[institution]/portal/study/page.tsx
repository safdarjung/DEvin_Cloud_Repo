import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { StudyChat } from "@/modules/ai/components/StudyChat";

// GU-08 — student-only (ai.study, 07 §2.2); not part of the shared
// guardian/student PortalNav tabs — a guardian never holds this
// permission (D32), so this page is reached only via the conditional
// "Study helper" tile on /portal (requirePermission below is still the
// real floor, not the tile's conditional rendering).
export default async function PortalStudyPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.study");

  const basePath = `/${institutionSlug}/portal`;

  if (!isFeatureEnabled(ctx, "student_ai_study")) {
    return (
      <div className="space-y-2">
        <Link href={basePath} className="text-muted-foreground text-sm underline">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Study helper</h1>
        <p className="text-muted-foreground text-sm">The study assistant is not included in this school&apos;s plan.</p>
      </div>
    );
  }

  if (ctx.institution.ai_policy !== "local_only") {
    return (
      <div className="space-y-2">
        <Link href={basePath} className="text-muted-foreground text-sm underline">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">Study helper</h1>
        <p className="text-muted-foreground text-sm">
          Not available yet for this school — the study assistant currently only works for schools running AI
          locally.
        </p>
      </div>
    );
  }

  const preferences = await getStudentPreferences(ctx);

  return (
    <div className="space-y-2">
      <Link href={basePath} className="text-muted-foreground text-sm underline">
        ← Back
      </Link>
      <StudyChat institutionSlug={institutionSlug} skills={preferences.skills} />
    </div>
  );
}
