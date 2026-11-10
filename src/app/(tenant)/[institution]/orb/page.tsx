import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { navItemsFor } from "@/lib/nav";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listMyChildren } from "@/modules/people/queries";
import { enabledCapabilities, roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { OrbView, type OrbChat } from "@/modules/ai/components/orb/OrbView";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { orbIconKey } from "@/modules/ai/components/orb/orb-icons";
import { starterPromptsFor } from "@/modules/ai/page-starters";

export default async function OrbPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { institution: slug } = await params;
  const { from } = await searchParams;
  const ctx = await getTenantContext(slug);
  const role = ctx.membership.role;

  // Icons go across as keys; lucide components are not serialisable.
  const apps = navItemsFor(ctx.permissions, ctx.institution.settings, ctx.institution.is_demo, role)
    .filter((item) => item.href !== "/orb")
    .map((item) => ({ href: `/${slug}${item.href}`, label: item.label, icon: orbIconKey(item.icon), group: item.group }));

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

  // Every enabled capability: chat ones send a starter prompt, page tasks link to their page.
  const chips = orbChips(enabledCapabilities(ctx), { slug, appHrefs: apps.map((a) => a.href), chatOn: chat !== null });

  // `from` is untrusted: only an in-app absolute path (not "//host") is used, minus the school prefix.
  const prefix = `/${slug}`;
  const fromPath = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
  const page = fromPath?.startsWith(`${prefix}/`) ? fromPath.slice(prefix.length) : null;
  const starters = chat && page ? starterPromptsFor(page, role) : undefined;

  return <OrbView institutionSlug={slug} role={role} apps={apps} chat={chat} chips={chips} starters={starters} />;
}
