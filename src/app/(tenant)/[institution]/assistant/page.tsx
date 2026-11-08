import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { AssistantPanel } from "@/modules/ai/components/AssistantPanel";

import { assistantPromptsFor } from "@/modules/ai/prompts/dashboard-prompts";

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { institution: institutionSlug } = await params;
  const { q } = await searchParams;
  // ?q= only pre-fills the box (never auto-sends); bounded so a long link can't stuff the input.
  const initialInput = typeof q === "string" ? q.trim().slice(0, 500) : undefined;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  if (!isModuleEnabled(ctx, "ai_teacher")) {
    return <PageHeader title="Assistant" description="The AI assistant is not enabled for this school." />;
  }

  if (!roleAiConfig(ctx, ctx.membership.role).enabled) {
    return <PageHeader title="Assistant" description="Your school has switched the AI assistant off for your role." />;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Assistant" description="Ask about attendance and fees. Each answer lists the records it used." />
      <AssistantPanel
        institutionSlug={institutionSlug}
        prompts={assistantPromptsFor(ctx.membership.role)}
        placeholder="Ask about attendance or fees"
        initialInput={initialInput}
      />
    </div>
  );
}
