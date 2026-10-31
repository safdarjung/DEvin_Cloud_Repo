import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { getStudyItem } from "@/modules/ai/student-study.queries";
import { StudyChat } from "@/modules/ai/components/StudyChat";

// GU-08/GU-09 — student-only (ai.study, 07 §2.2); not part of the shared
// guardian/student PortalNav tabs — a guardian never holds this
// permission (D32), so this page is reached only via the conditional
// "Study helper" tile on /portal (requirePermission below is still the
// real floor, not the tile's conditional rendering).
export default async function PortalStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ resume?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { resume } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.study");

  const basePath = `/${institutionSlug}/portal`;

  if (!isFeatureEnabled(ctx, "student_ai_study")) {
    return (
      <PageHeader
        title="Study helper"
        description="The study assistant is not included in this school's plan."
        back={{ href: basePath, label: "Back" }}
      />
    );
  }

  if (ctx.institution.ai_policy !== "local_only") {
    return (
      <PageHeader
        title="Study helper"
        description="Not available yet for this school — the study assistant currently only works for schools running AI locally."
        back={{ href: basePath, label: "Back" }}
      />
    );
  }

  const notebookEnabled = isFeatureEnabled(ctx, "student_ai_notebook");
  // Security review (L4) — a non-UUID `resume` value would otherwise reach
  // Postgres as a malformed uuid literal (22P02), surfacing as a 500
  // instead of just starting a fresh chat.
  const resumeId = resume && uuid.safeParse(resume).success ? resume : undefined;
  const [preferences, resumedItem] = await Promise.all([
    getStudentPreferences(ctx),
    // `getStudyItem` is own-rows-only via RLS regardless of this check —
    // notebookEnabled only decides whether resuming is offered, not
    // whether it would otherwise be safe.
    resumeId && notebookEnabled ? getStudyItem(ctx, resumeId) : Promise.resolve(null),
  ]);
  const initialMessages = resumedItem?.kind === "chat" ? resumedItem.messages : undefined;
  const resumedChatId = resumedItem?.kind === "chat" ? resumedItem.id : undefined;

  return (
    <div>
      <StudyChat
        institutionSlug={institutionSlug}
        skills={preferences.skills}
        notebookEnabled={notebookEnabled}
        initialMessages={initialMessages}
        resumedChatId={resumedChatId}
        backHref={basePath}
      />
    </div>
  );
}
