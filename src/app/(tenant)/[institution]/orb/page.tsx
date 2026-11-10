import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { navItemsFor } from "@/lib/nav";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listMyChildren } from "@/modules/people/queries";
import { CAPABILITIES } from "@/modules/ai/capabilities/catalog";
import { enabledCapabilities, roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { OrbView, type OrbChat } from "@/modules/ai/components/orb/OrbView";
import { orbIconKey } from "@/modules/ai/components/orb/orb-icons";

const MAX_CHIPS = 8;

export default async function OrbPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  const role = ctx.membership.role;

  // Icons go across as keys; lucide components are not serialisable.
  const apps = navItemsFor(ctx.permissions, ctx.institution.settings, ctx.institution.is_demo, role)
    .filter((item) => item.href !== "/orb")
    .map((item) => ({ href: `/${slug}${item.href}`, label: item.label, icon: orbIconKey(item.icon) }));

  // Same endpoint choice as the existing pages: /ai (teacher), study (student), assistant (everyone else).
  // Student: gated like portal/study/page.tsx (ai.study + role switch). Others like the assistant pages.
  const aiOn =
    role === "student"
      ? hasPermission(ctx, "ai.study") && roleAiConfig(ctx, role).enabled
      : hasPermission(ctx, "ai.chat") && isModuleEnabled(ctx, "ai_teacher") && roleAiConfig(ctx, role).enabled;
  let chat: OrbChat | null = null;
  if (aiOn) {
    if (role === "guardian") {
      // Guardian chat is child-scoped; the kernel re-checks this id belongs to them.
      const child = (await listMyChildren(ctx))[0];
      if (child) chat = { endpoint: "/api/ai/agent/assistant", studentId: child.id };
    } else {
      chat = { endpoint: `/api/ai/agent/${role === "teacher" ? "teacher" : role === "student" ? "student" : "assistant"}` };
    }
  }

  const chips = chat
    ? enabledCapabilities(ctx)
        .filter((key) => CAPABILITIES[key].kind === "chat_tool")
        .slice(0, MAX_CHIPS)
        .map((key) => ({ key, label: CAPABILITIES[key].label, prompt: `Help me with: ${CAPABILITIES[key].label}.` }))
    : [];

  return <OrbView institutionSlug={slug} apps={apps} chat={chat} chips={chips} />;
}
