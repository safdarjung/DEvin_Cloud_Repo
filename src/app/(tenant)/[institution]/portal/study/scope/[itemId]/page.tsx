import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { UIMessage } from "ai";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { uuid } from "@/lib/schemas/common";
import { ScopedTutor } from "@/modules/study/components/ScopedTutor";
import { getScopeSession, resolveScope } from "@/modules/study/scope.queries";

export const metadata: Metadata = { title: "Study session" };

// 0140 item 8 — a saved scoped study session (own study_items row only).
export default async function StudyScopeSessionPage({ params }: { params: Promise<{ institution: string; itemId: string }> }) {
  const { institution: slug, itemId } = await params;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "ai.study");
  if (!isModuleEnabled(ctx, "ai_student")) notFound();
  if (!ctx.membership.studentId) redirect(`/${slug}/portal`);
  if (!uuid.safeParse(itemId).success) notFound();
  const session = await getScopeSession(ctx, itemId);
  if (!session) notFound();
  const { context } = await resolveScope(ctx, session.scope);
  return (
    <>
      <PageHeader title="Study with AI" back={{ href: `/${slug}/portal/study/scope`, label: "Study sessions" }} compact />
      <ScopedTutor
        institutionSlug={slug}
        itemId={session.id}
        title={session.title}
        scopeLines={context.lines}
        initialMessages={session.messages as UIMessage[]}
        aiMode={process.env.ZAI_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY ? "cloud" : "local"}
      />
    </>
  );
}
