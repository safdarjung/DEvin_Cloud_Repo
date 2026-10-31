import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { listTeachableSections } from "@/modules/academics/assignments.queries";
import { TeacherAgentChat } from "@/modules/ai/components/TeacherAgentChat";
import { FeatureToggle } from "@/modules/core/components/FeatureToggle";

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
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-muted-foreground text-sm">Not available for your role yet.</p>
        {hasPermission(ctx, "institution.settings.manage") && (
          <div className="space-y-2">
            <FeatureToggle
              institutionSlug={institutionSlug}
              featureKey="teacher_ai_agent"
              label="Teacher AI assistant"
              initialEnabled={isFeatureEnabled(ctx, "teacher_ai_agent")}
            />
            <FeatureToggle
              institutionSlug={institutionSlug}
              featureKey="student_ai_study"
              label="Student study helper"
              initialEnabled={isFeatureEnabled(ctx, "student_ai_study")}
            />
            <FeatureToggle
              institutionSlug={institutionSlug}
              featureKey="student_ai_notebook"
              label="Student notebook"
              initialEnabled={isFeatureEnabled(ctx, "student_ai_notebook")}
            />
          </div>
        )}
      </div>
    );
  }

  if (!isFeatureEnabled(ctx, "teacher_ai_agent")) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-muted-foreground text-sm">The AI assistant is not included in this school&apos;s plan.</p>
      </div>
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
