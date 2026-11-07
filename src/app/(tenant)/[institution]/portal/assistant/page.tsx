import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { AssistantPanel } from "@/modules/ai/components/AssistantPanel";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

const PROMPTS = [
  "How many days was my child absent this month?",
  "What exams are coming up?",
  "Show pending assignments",
];

export default async function PortalAssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/assistant`);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/assistant"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {isModuleEnabled(ctx, ctx.membership.role === "student" ? "ai_student" : "ai_teacher") &&
      roleAiConfig(ctx, ctx.membership.role).enabled ? (
        <div className="max-w-2xl space-y-2">
          <p className="text-sm text-muted-foreground">Ask about {selection.studentName}. Each answer lists the records it used.</p>
          <AssistantPanel
            key={selection.studentId}
            institutionSlug={institutionSlug}
            studentId={selection.studentId}
            prompts={PROMPTS}
            placeholder={`Ask about ${selection.studentName}`}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Your school has not switched this assistant on.</p>
      )}
    </>
  );
}
