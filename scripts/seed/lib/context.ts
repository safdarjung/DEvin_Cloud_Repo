import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/db/types.ts";

/** State later sections read, produced by earlier sections (09 §4, 05 §8). */
export interface SeedContext {
  rng: () => number;
  admin: SupabaseClient<Database>;
  institutionId: string;
  campusId: string;
  academicYearId: string;
  termIds: { term1: string; term2: string };
  /** Demo login key (e.g. "principal", "teacher.vi-a") -> auth user id. */
  userIdByLogin: Record<string, string>;
  /** Demo login key -> that user's staff_id/guardian_id/student_id, whichever applies. */
  linkIdByLogin: Record<string, string>;
}

export function createSeedContext(rng: () => number, admin: SupabaseClient<Database>): SeedContext {
  return {
    rng,
    admin,
    institutionId: "",
    campusId: "",
    academicYearId: "",
    termIds: { term1: "", term2: "" },
    userIdByLogin: {},
    linkIdByLogin: {},
  };
}
