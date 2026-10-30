import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { TeacherAgentChat } from "@/modules/ai/components/TeacherAgentChat";

// T-0NN — first real page at `/ai` (the nav's `/ai/usage` link already
// existed). D28 scopes the tool-calling agent to the teacher role only;
// other `ai.generate` roles (owner/principal/admin) still see this nav
// entry — correct, since their own tool sets aren't built yet — but get a
// plain "not available yet" message here instead of a silent 403, per the
// packet's own call on how to gate this.
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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-muted-foreground text-sm">Not available for your role yet.</p>
      </div>
    );
  }

  return <TeacherAgentChat institutionSlug={institutionSlug} />;
}
