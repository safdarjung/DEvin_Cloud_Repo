"use server";

// D30/D33 (12-decision-log.md) — the entitlements toggle. Owners/
// principals/admins hold `institution.settings.manage`; this is the only
// write path for `institutions.settings.features`. D33 generalized this
// from a single hardcoded `teacher_ai_agent` setter to any closed
// `FeatureKey` — the plan's own §7 suggestion to move toggling to
// `is_platform_admin` only was explicitly NOT taken (owner ruling,
// 2026-10-30): authority stays exactly where D30 put it.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { FEATURE_CATALOG, type FeatureKey } from "@/lib/auth/entitlements";
import type { Json } from "@/lib/db/types";
import { isModuleEnabled, MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/modules/catalog";
import { createClient } from "@/lib/supabase/server";
import { emailChannel, resendConfigured } from "@/modules/notifications/channels/resend";
import { getWebsite } from "@/modules/website/queries";
import { CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { mergeRoleConfig } from "@/modules/core/control-centre/merge";
import { catalogRow } from "@/modules/ai/tasks/catalog";
import {
  AcademicYearUpsertSchema,
  AI_ROLES,
  AiRoleConfigSchema,
  AiRoleConfigPatchSchema,
  InstitutionSettingsSchema,
  InviteMemberSchema,
  RevokeInvitationSchema,
  SetMemberRoleSchema,
  SetMemberStatusSchema,
  SetModuleEnabledSchema,
  TermUpsertSchema,
  UpdateInstitutionSettingsSchema,
  type AcademicYearUpsertInput,
  type AiRoleConfig,
  type InviteMemberInput,
  type SetMemberRoleInput,
  type SetMemberStatusInput,
  type TermUpsertInput,
  type UpdateInstitutionSettingsInput,
} from "@/modules/core/schemas";

const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as [FeatureKey, ...FeatureKey[]];

function throwMapped(error: unknown): never {
  // Duplicate year/term names (unique constraints) are a caller error, not `internal`.
  if ((error as { code?: string } | null)?.code === "23505") {
    throw new AppError("conflict", "A record with these details already exists.");
  }
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const setFeatureEnabled = defineAction({
  name: "core.feature.set",
  module: "core",
  schema: z.object({ key: z.enum(FEATURE_KEYS), enabled: z.boolean() }).strict(),
  permission: "institution.settings.manage",
  handler: async ({ key, enabled }, ctx) => {
    const existingFeatures = ctx.institution.settings.features;
    const features = {
      ...(typeof existingFeatures === "object" && existingFeatures !== null ? existingFeatures : {}),
      [key]: enabled,
    };

    // Only this sub-key is validated (same per-key pattern as
    // attendance/actions.ts's `attendanceStatusCodes`) — `settings` as a
    // whole may predate other keys this packet never touches (e.g. a bare
    // test fixture institution), so re-validating the full strict schema
    // here would wrongly block a narrow, unrelated patch.
    const parsedFeatures = InstitutionSettingsSchema.shape.features.safeParse(features);
    if (!parsedFeatures.success) {
      throw new AppError("validation_failed", "This institution's settings could not be updated safely.");
    }

    // 0144: send only this key; the row is merged as it is now, so a concurrent save is not reverted.
    const supabase = await createClient();
    const { error } = await supabase.rpc("patch_institution_settings", {
      p_institution_id: ctx.institution.id,
      p_patch: { features: { [key]: enabled } },
    });
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }

    await audit(ctx, {
      action: "core.feature.set",
      entityType: "institution",
      entityId: ctx.institution.id,
      after: { [key]: enabled },
    });

    revalidatePath(`/${ctx.institution.slug}/ai`);
    return { key, enabled };
  },
});

function isClassifiedTaskName(name: string): boolean {
  const row = catalogRow(name);
  return row !== undefined && row.excluded === undefined;
}

export const setAiRoleConfig = defineAction({
  name: "core.ai_role.set",
  module: "core",
  schema: z.object({ role: z.enum(AI_ROLES), patch: AiRoleConfigPatchSchema }).strict(),
  permission: "institution.settings.manage",
  handler: async ({ role, patch }, ctx) => {
    // Validate that all capability keys in the patch are known.
    if (patch.capabilities) {
      const unknownKeys = Object.keys(patch.capabilities).filter(
        (key) => !(CAPABILITY_KEYS as readonly string[]).includes(key)
      );
      if (unknownKeys.length > 0) {
        throw new AppError("validation_failed", "Unknown capability keys in patch.");
      }
    }
    // Task keys must be classified (not excluded, not unclassified) rows of the orb task catalog.
    if (patch.tasks && Object.keys(patch.tasks).some((name) => !isClassifiedTaskName(name))) {
      throw new AppError("validation_failed", "Unknown task names in patch.");
    }

    const existingAiRoles = ctx.institution.settings.ai_roles;
    const existingRoleConfig = (typeof existingAiRoles === "object" && existingAiRoles !== null
      ? (existingAiRoles as Record<string, AiRoleConfig>)[role]
      : undefined) || {};

    const mergedRoleConfig = mergeRoleConfig(existingRoleConfig, patch);

    // Validate the merged config against AiRoleConfigSchema.
    const parsedRoleConfig = AiRoleConfigSchema.safeParse(mergedRoleConfig);
    if (!parsedRoleConfig.success) {
      throw new AppError("validation_failed", "This institution's settings could not be updated safely.");
    }

    const aiRoles = {
      ...(typeof existingAiRoles === "object" && existingAiRoles !== null ? existingAiRoles : {}),
      [role]: parsedRoleConfig.data,
    };

    // Validate the full ai_roles object against the schema.
    const parsedAiRoles = InstitutionSettingsSchema.shape.ai_roles?.safeParse(aiRoles);
    if (parsedAiRoles && !parsedAiRoles.success) {
      throw new AppError("validation_failed", "This institution's settings could not be updated safely.");
    }

    // 0144: the patch itself (null removes an override) merged into the row as it is now.
    const supabase = await createClient();
    const { error } = await supabase.rpc("patch_institution_settings", {
      p_institution_id: ctx.institution.id,
      p_patch: { ai_roles: { [role]: patch } } as Json,
    });
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
    }

    // Audit: role + changed keys only (no instructions text).
    const changedKeys = Object.keys(patch).filter((key) => {
      if (key === "instructions") return false; // Skip instructions text
      return true;
    });

    await audit(ctx, {
      action: "core.ai_role.set",
      entityType: "institution",
      entityId: ctx.institution.id,
      after: { role, ...Object.fromEntries(changedKeys.map((k) => [k, (patch as Record<string, unknown>)[k]])) },
    });

    revalidatePath(`/${ctx.institution.slug}/settings/ai`);
    return { role, ...parsedRoleConfig.data };
  },
});

// M17-T3 (D42) — invite email text. Not exported: "use server" files may
// only export async functions. No address/token logging (rulings "Invite").
function buildInviteEmailText(schoolName: string, role: string, link: string): string {
  return `You've been invited to join ${schoolName} as a ${role} on CoolSkool.\n\nAccept your invite: ${link}`;
}

// M03-T5 — invite_member/revoke_invitation (0079) are themselves the
// authorization/escalation/audit boundary (owner/principal/admin only,
// owner/principal invites gated further); these are thin wrappers, same
// shape as attendance's submitAttendance.
export const inviteMember = defineAction({
  name: "core.member.invite",
  module: "core",
  schema: InviteMemberSchema,
  permission: "member.manage",
  handler: async ({ email, role, staffId, guardianId, studentId }: InviteMemberInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invite_member", {
      p_institution_id: ctx.institution.id,
      p_email: email,
      p_role: role,
      p_staff_id: staffId,
      p_guardian_id: guardianId,
      p_student_id: studentId,
    });
    if (error) throwMapped(error);
    const row = data?.[0];
    if (!row) throw new AppError("internal", "Invitation was not created.");

    // M17-T3 (D42, rulings "Invite") — not a notification: no
    // delivery_attempts row (notification_id is NOT NULL). Status goes only
    // in the result + audit `after`. A send failure never fails the action.
    const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
    let delivery: "sent" | "simulated" | "failed" = "simulated";
    // MOD-T11 (rulings "Channels") — `email` off falls back to simulated,
    // same as a missing Resend key.
    if (resendConfigured() && appUrl && isModuleEnabled(ctx, "email")) {
      const link = `${appUrl}/invite#token=${row.token}`;
      const result = await emailChannel().send({
        toAddress: email,
        renderedBody: buildInviteEmailText(ctx.institution.name, role, link),
        subject: `You're invited to ${ctx.institution.name}`,
        idempotencyKey: `invite:${row.invitation_id}`,
      });
      delivery = result.status;
    }

    // Email is intentionally not in the audit row (no PII, lesson 10).
    await audit(ctx, {
      action: "core.member.invite",
      entityType: "invitation",
      entityId: row.invitation_id,
      after: { role, delivery },
    });

    return { invitationId: row.invitation_id, token: row.token, delivery };
  },
});

export const revokeInvite = defineAction({
  name: "core.member.revokeInvite",
  module: "core",
  schema: RevokeInvitationSchema,
  permission: "member.manage",
  handler: async ({ invitationId }, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId });
    if (error) throwMapped(error);

    await audit(ctx, { action: "core.member.revoke_invite", entityType: "invitation", entityId: invitationId });
    return { invitationId };
  },
});

// M03-T7 — setRole/setStatus are direct RLS writes (0002's memberships_update
// policy already scopes to owner/principal/admin); app.guard_membership_write
// (0033/0038) is the self-edit/owner/principal-escalation boundary. `.maybeSingle()`
// (not `.single()`): an update matching zero rows (wrong tenant, blocked by the
// guard trigger surfacing as a SQL error already, or a forged id) must reach the
// explicit not_found check below — `.single()` raises PGRST116 on zero rows, which
// `throwMapped` has no `code:` prefix to map, turning it into `internal` (same
// fix-round-1 lesson as website.notice.upsert/website.event.upsert).
export const setMemberRole = defineAction({
  name: "core.member.setRole",
  module: "core",
  schema: SetMemberRoleSchema,
  permission: "member.manage",
  handler: async ({ membershipId, role }: SetMemberRoleInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("memberships")
      .update({ role })
      .eq("id", membershipId)
      .eq("institution_id", ctx.institution.id)
      .select("id, role")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Membership not found.");

    await audit(ctx, { action: "core.member.role_set", entityType: "membership", entityId: data.id, after: { role: data.role } });
    return { membershipId: data.id, role: data.role };
  },
});

export const setMemberStatus = defineAction({
  name: "core.member.setStatus",
  module: "core",
  schema: SetMemberStatusSchema,
  permission: "member.manage",
  handler: async ({ membershipId, status }: SetMemberStatusInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("memberships")
      .update({ status })
      .eq("id", membershipId)
      .eq("institution_id", ctx.institution.id)
      .select("id, status")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Membership not found.");

    await audit(ctx, { action: "core.member.status_set", entityType: "membership", entityId: data.id, after: { status: data.status } });
    return { membershipId: data.id, status: data.status };
  },
});

// M03-T8 — academic year / term / institution settings setup. Upsert =
// update when `id` is given (hidden/foreign row -> not_found), else insert.
// No deletes (YAGNI; FK history, brief).
export const upsertAcademicYear = defineAction({
  name: "core.academicYear.upsert",
  module: "core",
  schema: AcademicYearUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, name, startsOn, endsOn, isCurrent }: AcademicYearUpsertInput, ctx) => {
    const supabase = await createClient();

    if (isCurrent) {
      // The partial unique index (academic_years_one_current_idx) allows only
      // one current year per institution — clear the old one first so this
      // insert/update doesn't collide with it.
      const { error: clearError } = await supabase
        .from("academic_years")
        .update({ is_current: false })
        .eq("institution_id", ctx.institution.id)
        .eq("is_current", true);
      if (clearError) throwMapped(clearError);
    }

    const row = {
      institution_id: ctx.institution.id,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      ...(isCurrent !== undefined ? { is_current: isCurrent } : {}),
    };
    const query = id
      ? supabase.from("academic_years").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("academic_years").insert(row);
    const { data, error } = await query.select("id, name, starts_on, ends_on, is_current").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Academic year not found.");

    await audit(ctx, { action: "core.academic_year.upsert", entityType: "academic_year", entityId: data.id });

    return { id: data.id, name: data.name, startsOn: data.starts_on, endsOn: data.ends_on, isCurrent: data.is_current };
  },
});

export const upsertTerm = defineAction({
  name: "core.term.upsert",
  module: "core",
  schema: TermUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, academicYearId, name, startsOn, endsOn }: TermUpsertInput, ctx) => {
    const supabase = await createClient();
    const baseRow = {
      institution_id: ctx.institution.id,
      academic_year_id: academicYearId,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
    };

    let query;
    if (id) {
      query = supabase.from("terms").update(baseRow).eq("id", id).eq("institution_id", ctx.institution.id);
    } else {
      // `sequence` is not client input (brief) — next in this year's own order.
      const { count, error: countError } = await supabase
        .from("terms")
        .select("id", { count: "exact", head: true })
        .eq("academic_year_id", academicYearId);
      if (countError) throwMapped(countError);
      query = supabase.from("terms").insert({ ...baseRow, sequence: (count ?? 0) + 1 });
    }

    const { data, error } = await query.select("id, academic_year_id, name, starts_on, ends_on").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Term not found.");

    await audit(ctx, { action: "core.term.upsert", entityType: "term", entityId: data.id });

    return { id: data.id, academicYearId: data.academic_year_id, name: data.name, startsOn: data.starts_on, endsOn: data.ends_on };
  },
});

export const updateInstitutionSettings = defineAction({
  name: "core.institution.updateSettings",
  module: "core",
  schema: UpdateInstitutionSettingsSchema,
  permission: "institution.settings.manage",
  handler: async ({ name, timezone, settings }: UpdateInstitutionSettingsInput, ctx) => {
    const existingSettings = ctx.institution.settings;

    let patchedLocale: { timezone: string; currency: string } | undefined;
    if (timezone !== undefined) {
      const existingLocale = existingSettings.locale as { currency?: unknown } | undefined;
      const currency = typeof existingLocale?.currency === "string" ? existingLocale.currency : "INR";
      patchedLocale = { timezone, currency };
      const parsedLocale = InstitutionSettingsSchema.shape.locale.safeParse(patchedLocale);
      if (!parsedLocale.success) {
        throw new AppError("validation_failed", "Timezone could not be applied.");
      }
    }

    const newSettings =
      timezone !== undefined || settings !== undefined
        ? {
            ...existingSettings,
            ...(settings ?? {}),
            ...(patchedLocale !== undefined ? { locale: patchedLocale } : {}),
          }
        : undefined;

    if (name === undefined && newSettings === undefined) {
      throw new AppError("validation_failed", "Nothing to update.");
    }

    const update = {
      ...(name !== undefined ? { name } : {}),
      ...(newSettings !== undefined ? { settings: newSettings } : {}),
    };

    const supabase = await createClient();
    const { error } = await supabase.from("institutions").update(update).eq("id", ctx.institution.id);
    if (error) throwMapped(error);

    await audit(ctx, { action: "core.institution.update_settings", entityType: "institution", entityId: ctx.institution.id });

    return {
      name: name ?? ctx.institution.name,
      settings: newSettings ?? existingSettings,
    };
  },
});

// MOD-T4 — the only write path for `institutions.settings.modules` (mirrors
// setFeatureEnabled's narrow-patch shape above; `core.institution.updateSettings`
// omits `modules` from its own schema so this stays the sole writer).
export const setModuleEnabled = defineAction({
  name: "core.module.set",
  module: "core",
  schema: SetModuleEnabledSchema,
  permission: "institution.settings.manage",
  handler: async ({ key, enabled }, ctx) => {
    // MODULES is a `satisfies Record<string, ModuleEntry>` const — one entry per
    // key, so a union member narrows to object, not a shared shape; read
    // `core`/`requires` the same defensive way catalog.ts's own isModuleEnabled does.
    const entry = MODULES[key] as Record<string, unknown>;
    if (entry.core === true) {
      throw new AppError("invalid_state", "Core modules are always on.");
    }

    if (enabled) {
      const requires = (entry.requires ?? []) as ModuleKey[];
      const unmet = requires.filter((reqKey) => !isModuleEnabled(ctx, reqKey));
      if (unmet.length > 0) {
        const labels = unmet.map((reqKey) => MODULES[reqKey].label).join(", ");
        throw new AppError("conflict", `Turn on ${labels} first.`);
      }
    } else {
      const dependents = MODULE_KEYS.filter((otherKey) => {
        const otherRequires = (MODULES[otherKey] as Record<string, unknown>).requires as ModuleKey[] | undefined;
        return otherRequires?.includes(key) && isModuleEnabled(ctx, otherKey);
      });
      if (dependents.length > 0) {
        const labels = dependents.map((otherKey) => MODULES[otherKey].label).join(", ");
        throw new AppError("conflict", `Turn off ${labels} first.`);
      }

      if (key === "website") {
        const website = await getWebsite(ctx);
        if (website?.isLive) {
          throw new AppError("conflict", "Take the public website offline first.");
        }
      }
    }

    const existingModules = ctx.institution.settings.modules;
    const modulesPatch = {
      ...(typeof existingModules === "object" && existingModules !== null ? existingModules : {}),
      [key]: enabled,
    };
    const parsedModules = InstitutionSettingsSchema.shape.modules.safeParse(modulesPatch);
    if (!parsedModules.success) {
      throw new AppError("validation_failed", "This institution's settings could not be updated safely.");
    }
    // 0144: send only this key; the row is merged as it is now, so a concurrent save is not reverted.
    const supabase = await createClient();
    const { error } = await supabase.rpc("patch_institution_settings", {
      p_institution_id: ctx.institution.id,
      p_patch: { modules: { [key]: enabled } },
    });
    if (error) throwMapped(error);

    await audit(ctx, {
      action: "core.module.set",
      entityType: "institution",
      entityId: ctx.institution.id,
      after: { key, enabled },
    });

    revalidatePath(`/${ctx.institution.slug}`, "layout");
    return { key, enabled };
  },
});
