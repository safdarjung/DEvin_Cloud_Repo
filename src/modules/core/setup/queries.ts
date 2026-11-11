// F18 §H — setup checklist state. A step is "done" from real data (grades,
// logo, students, invitations), else whatever the owner marked under
// institutions.settings.setup. "modules" has no data signal, so only the mark
// (core.setup.setProgress) completes it.
import type { TenantContext } from "@/lib/auth/types";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import { SETUP_STEPS, type SetupStep } from "@/modules/core/schemas";

export type SetupStepState = "done" | "dismissed" | "todo";

export interface SetupStatus {
  steps: { key: SetupStep; state: SetupStepState }[];
  completed: number;
  total: number;
  complete: boolean;
  counts: { grades: number; students: number; invitations: number };
  branding: { logoPath: string | null; primaryColor: string | null };
  /** starts_on of the current academic year (null when none), for the template preview. */
  currentYearStart: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function countOrThrow({ count, error }: { count: number | null; error: unknown }): number {
  if (error) {
    const mapped = mapSqlError(error);
    throw new AppError(mapped.ok ? "internal" : mapped.error.code, mapped.ok ? "Unexpected error." : mapped.error.message);
  }
  return count ?? 0;
}

export async function getSetupStatus(ctx: TenantContext): Promise<SetupStatus> {
  const supabase = await createClient();
  const id = ctx.institution.id;
  const [grades, students, invitations, year] = await Promise.all([
    supabase.from("grades").select("id", { count: "exact", head: true }).eq("institution_id", id).then(countOrThrow),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("institution_id", id).then(countOrThrow),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("institution_id", id).then(countOrThrow),
    supabase.from("academic_years").select("starts_on").eq("institution_id", id).eq("is_current", true).maybeSingle(),
  ]);
  if (year.error) countOrThrow({ count: null, error: year.error });

  const marks = asObject(ctx.institution.settings.setup);
  const branding = asObject(ctx.institution.settings.branding);
  const logoPath = typeof branding.logo_path === "string" ? branding.logo_path : null;
  const fromData: Record<SetupStep, boolean> = {
    structure: grades > 0,
    branding: logoPath !== null,
    people: students > 0,
    invite: invitations > 0,
    modules: marks.modules === "done",
  };

  const steps = SETUP_STEPS.map((key) => {
    const mark = marks[key];
    const state: SetupStepState = fromData[key] ? "done" : mark === "done" || mark === "dismissed" ? mark : "todo";
    return { key, state };
  });
  const completed = steps.filter((s) => s.state !== "todo").length;

  return {
    steps,
    completed,
    total: steps.length,
    complete: completed === steps.length,
    counts: { grades, students, invitations },
    branding: {
      logoPath,
      primaryColor: typeof branding.primary_color === "string" ? branding.primary_color : null,
    },
    currentYearStart: year.data?.starts_on ?? null,
  };
}
