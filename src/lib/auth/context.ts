import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { createClient, getClaims } from "@/lib/supabase/server";

/**
 * 04 §4 — resolves once per request (React cache()) from the session and the
 * route slug. Never trust the slug beyond this membership lookup; everything
 * downstream reads `ctx.institution.id`, not the client-supplied slug.
 */
export const getTenantContext = cache(async (institutionSlug: string): Promise<TenantContext> => {
  const claims = await getClaims();
  if (!claims) {
    redirect(`/login?next=/${institutionSlug}`);
  }

  const supabase = await createClient();

  const [{ data: institution }, { data: profile }] = await Promise.all([
    supabase
      .from("institutions")
      .select("id, slug, name, settings, ai_policy, is_demo")
      .eq("slug", institutionSlug)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, phone, avatar_path, is_platform_admin")
      .eq("id", claims.sub)
      .maybeSingle(),
  ]);

  // Institution not found, or RLS hid it because the caller isn't a member —
  // 404 either way (04 §4 step 3: never reveal that the institution exists).
  if (!institution || !profile) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, staff_id, guardian_id, student_id")
    .eq("user_id", claims.sub)
    .eq("institution_id", institution.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    notFound();
  }

  const role = membership.role as Role;

  return {
    institution: {
      id: institution.id,
      slug: institution.slug,
      name: institution.name,
      settings: (institution.settings ?? {}) as Record<string, unknown>,
      ai_policy: institution.ai_policy as TenantContext["institution"]["ai_policy"],
      is_demo: institution.is_demo,
    },
    user: {
      id: claims.sub as string,
      profile: {
        fullName: profile.full_name,
        phone: profile.phone,
        avatarPath: profile.avatar_path,
        isPlatformAdmin: profile.is_platform_admin,
      },
    },
    membership: {
      role,
      staffId: membership.staff_id,
      guardianId: membership.guardian_id,
      studentId: membership.student_id,
    },
    permissions: new Set(permissionsFor(role)),
  };
});
