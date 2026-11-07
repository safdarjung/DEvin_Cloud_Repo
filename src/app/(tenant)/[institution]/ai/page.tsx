import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { listTeachableSections } from "@/modules/academics/assignments.queries";
import { TeacherAgentChat } from "@/modules/ai/components/TeacherAgentChat";

// T-0NN — first real page at `/ai` (the nav's `/ai/usage` link already
// existed). D28 scopes the tool-calling agent to the teacher role only;
// other `ai.generate` roles (owner/principal/admin) still see this nav
// entry — correct, since their own tool sets aren't built yet — but get a
// plain "not available yet" message here instead of a silent 403, per the
// packet's own call on how to gate this.
// T6 (ai-roles) — the teacher_ai_agent/student_ai_study/student_ai_notebook
// toggles that used to live here moved to /settings/ai's per-role switches.
export default async function AiAssistantPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.generate");

  if (ctx.membership.role !== "teacher") {
    return (
      <div className="space-y-4">
        <PageHeader title="AI Assistant" description="Not available for your role yet." />
        {hasPermission(ctx, "institution.settings.manage") && (
          <Button asChild variant="outline">
            <Link href={`/${institutionSlug}/settings/ai`}>Manage AI settings for each role</Link>
          </Button>
        )}
      </div>
    );
  }

  if (!roleAiConfig(ctx, ctx.membership.role).enabled) {
    return (
      <PageHeader title="AI Assistant" description="Your school has switched the AI assistant off for your role." />
    );
  }

  const teachableSections = await listTeachableSections(ctx);

  return (
    <TeacherAgentChat
      institutionSlug={institutionSlug}
      aiPolicy={ctx.institution.ai_policy}
      teachableSections={teachableSections}
    />
  );
}
