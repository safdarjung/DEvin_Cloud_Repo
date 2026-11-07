import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { AssistantPanel } from "@/modules/ai/components/AssistantPanel";

const PROMPTS = [
  "Give me today's attendance summary and list the sections that need attention",
  "Which sections have the lowest attendance this week?",
  "Summarise fee collection this term",
];

export default async function AssistantPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
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
      <AssistantPanel institutionSlug={institutionSlug} prompts={PROMPTS} placeholder="Ask about attendance or fees" />
    </div>
  );
}
