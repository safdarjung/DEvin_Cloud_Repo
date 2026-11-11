import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { isAiCapabilityEnabled, roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { getStudyItem } from "@/modules/ai/student-study.queries";
import { StudyChat } from "@/modules/ai/components/StudyChat";

export const metadata: Metadata = { title: "Study" };

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

  const notebookEnabled = isAiCapabilityEnabled(ctx, "study_notebook");
  // Where the chat runs (local or cloud) is the role's cloud switch on /settings/ai, checked by the chat route.
  const unavailable = !roleAiConfig(ctx, ctx.membership.role).enabled
    ? "Your school has switched the study helper off, so chat is not available."
    : null;

  if (unavailable) {
    return (
      <div className="space-y-4">
        <PageHeader title="Study" description={unavailable} back={{ href: basePath, label: "Back" }} />
        <p className="text-sm text-muted-foreground">What you can do instead:</p>
        <FadeIn className="flex flex-wrap gap-2">
          {notebookEnabled && (
            <Link href={`${basePath}/study/notebook`} className={buttonVariants({ variant: "outline" })}>
              Open notebook
            </Link>
          )}
          <Link href={`${basePath}/assignments`} className={buttonVariants({ variant: "outline" })}>
            View assignments
          </Link>
          <Link href={`${basePath}/subjects`} className={buttonVariants({ variant: "outline" })}>
            See subjects and units
          </Link>
        </FadeIn>
      </div>
    );
  }

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
    <div className="flex min-h-[60dvh] flex-col">
      <StudyChat
        institutionSlug={institutionSlug}
        skills={preferences.skills}
        notebookEnabled={notebookEnabled}
        initialMessages={initialMessages}
        resumedChatId={resumedChatId}
        backHref={basePath}
        aiMode={process.env.ZAI_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY ? "cloud" : "local"}
      />
    </div>
  );
}
