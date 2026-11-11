import type { Metadata } from "next";
import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { MODULES } from "@/lib/modules/catalog";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { capabilityState, roleAiConfig, type CapabilityLock } from "@/modules/ai/capabilities/resolve";
import { usageByRole } from "@/modules/ai/queries";
import { AiRoleSettings, type RoleTabData } from "@/modules/ai/components/AiRoleSettings";

export const metadata: Metadata = { title: "AI roles" };

// T6 (ai-roles) — per-role AI settings. Server component resolves every
// role's config and capability state (capabilityState/roleAiConfig already
// enforce the role/permission/module/role_off ceiling — this page never
// re-derives that logic); the client half (AiRoleSettings) only renders and
// saves. `.superpowers/sdd/ai-roles/tasks.md` T6.
function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function lockReason(locked: CapabilityLock, moduleKey: keyof typeof MODULES): string | null {
  switch (locked) {
    case null:
      return null;
    case "role":
      return null; // hidden, not greyed — see hideRow below
    case "permission":
      return "This role's permissions don't allow it.";
    case "module":
      return `The ${MODULES[moduleKey].label} module is off.`;
    case "role_off":
      return "Turn on this role's AI chat above to use this.";
    case "mode_off":
    case "group_off":
      return "Switched off in the control centre for this role.";
  }
}

export default async function AiRoleSettingsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "institution.settings.manage");

  const usage = await usageByRole(ctx);
  const usageByRoleKey = new Map(usage.map((u) => [u.role, u]));

  const roles: RoleTabData[] = AI_ROLES.map((role) => {
    const config = roleAiConfig(ctx, role);
    const capabilities = CAPABILITY_KEYS.map((key) => {
      const cap = CAPABILITIES[key];
      const state = capabilityState(ctx, role, key);
      return {
        key,
        label: cap.label,
        description: cap.description,
        kind: cap.kind,
        data: cap.data,
        on: state.on,
        lockReason: lockReason(state.locked, cap.module),
        hideRow: state.locked === "role",
      };
    });
    const u = usageByRoleKey.get(role);

    return {
      role,
      label: roleLabel(role),
      config: {
        enabled: config.enabled,
        cloud: config.cloud,
        instructions: config.instructions,
        dailyTokenQuota: config.dailyTokenQuota,
      },
      usage: { tokens: u?.tokens ?? 0, costPaise: u?.cost_paise ?? 0 },
      capabilities,
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader title="AI roles" description="Configure what each role's AI can do, on the cloud, and its usage limit." />
      <p className="text-sm text-muted-foreground">
        Want everything in one place, with search and presets? Open the <Link href={`/${institutionSlug}/settings/control-centre`} className="font-medium text-foreground underline underline-offset-2">Control centre</Link>.
      </p>
      <FadeIn>
        <AiRoleSettings institutionSlug={institutionSlug} roles={roles} />
      </FadeIn>
    </div>
  );
}
